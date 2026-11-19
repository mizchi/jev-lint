// Parse guide text only. Never compile or run the snippets under review.
package main

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"strconv"
)

type request struct {
	Packages map[string]string // consumer import path -> declared package name
	Guides   [][]string
}

type reference struct {
	Path, Qualifier, Name string
	Inferred              bool
}

func parseExample(code string) *ast.File {
	fs := token.NewFileSet()
	if _, err := parser.ParseFile(fs, "", code, parser.PackageClauseOnly); err != nil {
		code = "package example\n" + code
	}
	if file, err := parser.ParseFile(fs, "", code, 0); err == nil {
		return file
	}
	// README snippets commonly mix imports with statements shown outside a function.
	header, err := parser.ParseFile(fs, "", code, parser.ImportsOnly)
	if err != nil {
		return nil
	}
	end := header.Name.End()
	if n := len(header.Decls); n > 0 {
		end = header.Decls[n-1].End()
	}
	i := fs.Position(end).Offset
	file, err := parser.ParseFile(fs, "", code[:i]+"\nfunc exampleBody() {\n"+code[i:]+"\n}", 0)
	if err != nil {
		return nil
	}
	return file
}

// Empty paths mark ambiguous names. An explicit import list supersedes inference.
func bind(names map[string]string, name, path string) {
	if previous, ok := names[name]; ok && previous != path {
		names[name] = ""
	} else {
		names[name] = path
	}
}

func references(code string, packages, inferred map[string]string) []reference {
	file := parseExample(code)
	if file == nil {
		return nil
	}
	names := inferred
	if len(file.Imports) > 0 {
		names = make(map[string]string)
		for _, spec := range file.Imports {
			path, err := strconv.Unquote(spec.Path.Value)
			if err != nil {
				continue
			}
			name := packages[path]
			if spec.Name != nil {
				name = spec.Name.Name
			}
			bind(names, name, path)
		}
	}
	var refs []reference
	ast.Inspect(file, func(node ast.Node) bool {
		sel, ok := node.(*ast.SelectorExpr)
		if !ok || !sel.Sel.IsExported() {
			return true
		}
		id, ok := sel.X.(*ast.Ident)
		if !ok || id.Obj != nil { // a locally bound variable, type, or parameter
			return true
		}
		path := names[id.Name]
		if _, reviewed := packages[path]; reviewed {
			refs = append(refs, reference{path, id.Name, sel.Sel.Name, len(file.Imports) == 0})
		}
		return true
	})
	return refs
}

func main() {
	var input request
	if err := json.NewDecoder(os.Stdin).Decode(&input); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	inferred := make(map[string]string)
	for path, name := range input.Packages {
		bind(inferred, name, path)
	}
	result := make([][]reference, len(input.Guides))
	for i, examples := range input.Guides {
		result[i] = []reference{}
		for _, code := range examples {
			result[i] = append(result[i], references(code, input.Packages, inferred)...)
		}
	}
	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
