/** Unfenced lines have a null language. A fence without a language has an empty string. */
export function* guideBlocks(markdown: string) {
  let fence: { marker: string; language: string } | undefined;
  let lines: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!fence) {
      if (marker) fence = { marker: marker[1], language: marker[2].trim().split(/\s+/)[0].toLowerCase() };
      else yield { language: null, text: line };
    } else if (marker && marker[1].startsWith(fence.marker) && !marker[2].trim()) {
      yield { language: fence.language, text: lines.join("\n") };
      fence = undefined;
      lines = [];
    } else {
      lines.push(line);
    }
  }
  if (fence) yield { language: fence.language, text: lines.join("\n") };
}
