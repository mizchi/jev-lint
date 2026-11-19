"""Read one module from stable rustdoc HTML, without building the inspected crate."""
from html.parser import HTMLParser
import json
from pathlib import Path
import sys
from xml.etree.ElementTree import Element, SubElement


class Page(HTMLParser):
    """Keep the main content, including inline text inside links in signatures."""
    block = set("div p br pre li h1 h2 h3 h4".split())
    void = set("area base br col embed hr img input link meta param source track wbr".split())

    def __init__(self, path):
        super().__init__(convert_charrefs=True)
        self.content = Element("root")
        self.stack = []
        self.rustdoc = False
        self.feed(path.read_text(encoding="utf8"))
        self.close()
        if not self.rustdoc or not len(self.content):
            raise ValueError(f"expected a rustdoc HTML page: {path}")

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "meta" and attrs.get("name") == "generator":
            self.rustdoc = attrs.get("content") == "rustdoc"
        if not self.stack and attrs.get("id") != "main-content":
            return
        if tag in self.block:
            self.handle_data(" ")
        parent = self.stack[-1] if self.stack else self.content
        elem = SubElement(parent, tag, attrs)
        if tag not in self.void:
            self.stack.append(elem)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                if tag in self.block:
                    self.handle_data(" ")
                return

    def handle_data(self, data):
        if self.stack:
            parent = self.stack[-1]
            if len(parent):
                parent[-1].tail = (parent[-1].tail or "") + data
            else:
                parent.text = (parent.text or "") + data


def text(element):
    return " ".join("".join(element.itertext()).split()) if element is not None else ""


def top_doc(content):
    for details in content.findall("details"):
        if "top-doc" in details.get("class", "").split():
            return text(details.find("div[@class='docblock']"))
    return ""


def declaration(path):
    content = Page(path).content[0]
    signature = next((text(pre) for pre in content.findall("pre")
                      if "item-decl" in pre.get("class", "").split()), "")
    if not signature:
        raise ValueError(f"missing rustdoc declaration: {path}")
    methods = content.findall(".//div[@id='implementations-list']//section[@class='method']/h4")
    return " ".join([signature] + [text(method) for method in methods]), top_doc(content)


def collect(index, names_only):
    content = Page(index).content[0]
    heading = content.find("./div[@class='main-heading']/h1")
    if not text(heading).startswith(("Crate ", "Module ")):
        raise ValueError(f"expected a rustdoc module index: {index}")
    bindings = []
    for table in content.findall("dl"):
        if "item-table" not in table.get("class", "").split():
            continue
        reexports = "reexports" in table.get("class", "").split()
        for dt in table.findall("dt"):
            if dt.find(".//span[@title='Restricted Visibility']") is not None:
                raise ValueError("regenerate public rustdoc without --document-private-items")
            alias = None
            if reexports:
                prefix, _, name = dt.get("id", "").partition(".")
                if prefix != "reexport" or not name:
                    raise ValueError(f"cannot enumerate this rustdoc re-export: {text(dt)}")
                signature = text(dt)
                target_path, separator, _ = signature.removeprefix("pub use ").removesuffix(";").rpartition(" as ")
                if separator:
                    alias = target_path
                doc = ""
                link = dt.find("code/a")
                if not names_only and link is not None:
                    href = link.get("href", "")
                    target = (index.parent / href).resolve()
                    if "://" not in href and target.is_relative_to(index.parent.resolve()) and target.is_file() and target != index:
                        if target.name == "index.html":
                            doc = top_doc(Page(target).content[0])
                        else:
                            definition, doc = declaration(target)
                            signature += " Target: " + definition
            else:
                link = dt.find("a")
                if link is None or not text(link):
                    raise ValueError(f"unrecognized rustdoc entry: {text(dt)}")
                name = text(link)
                signature = "pub mod " + name
                doc = ""
                if not names_only:
                    kind = link.get("class", "")
                    target = (index.parent / link.get("href", "")).resolve()
                    if not target.is_relative_to(index.parent.resolve()) or target == index:
                        raise ValueError(f"unexpected rustdoc item link: {link.get('href')}")
                    if kind == "mod":
                        doc = top_doc(Page(target).content[0])
                    else:
                        signature, doc = declaration(target)
            entry = {"name": name}
            if alias:
                entry["alias"] = alias
            if not names_only:
                summary = signature if len(signature) <= 340 else signature[:339] + "…"
                entry.update(signature=signature, doc=doc, row=summary + (" — " + doc[:160] if doc else ""))
            bindings.append(entry)
    return {"label": "Rust module " + text(heading.find("span")), "bindings": bindings, "packageDoc": top_doc(content)}


if __name__ == "__main__":
    try:
        print(json.dumps(collect(Path(sys.argv[1]), sys.argv[2] == "names")))
    except (OSError, ValueError) as error:
        sys.exit(str(error))
