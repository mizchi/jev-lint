---
description: Judge a Markdown document's writing — the nine JevSlop signals and the five "does the text talk about itself" checks — and run the mechanical leakage test
argument-hint: "<paths...>"
---

Run jev-lint's `markdown/` rules on the documents given and report what
they say, judged, not just listed. Two families are loaded from
`rules/markdown/`: the writing-quality rubrics ported from JevSlop
(`document-is-*`, `score` 0–4) and the checks from the cognitive-rhythm
writing norm (`section-ends-with-a-preview`, `section-opens-with-an-
agenda`, `document-abandons-a-question`). The norm's general form,
`section-narrates-itself`, and `address-outside-boundaries` are
candidates under `experiments/rule-candidates/markdown/`; add `-R` on
that directory to run them too, at the precision their reports state.

1. Confirm `TYPESAFE_API_KEY` (or `TYPESAFEAI_API_KEY`) is set. If not, stop
   and say so.
2. Plan first, spend nothing:
   `npx -y jev-lint check $ARGUMENTS -R node_modules/jev-lint/rules/markdown --dry-run`
   (in a checkout of jev-lint, `-R rules/markdown`). Report the section
   count and price. A document over 48,000 characters is judged on its
   first 48,000 and the run says so.
3. Run it: `npx -y jev-lint check $ARGUMENTS -R node_modules/jev-lint/rules/markdown --retry 3 --loose 10`.
4. For each finding on a section rule, open the section and quote the
   sentence that does it — the one whose topic is the text and not the
   subject — then say which of the norm's four exceptions it is not. For a
   `document-is-*` finding, name the passages that earn the score; these
   are writing characteristics, not authorship claims, and a technical
   reference scoring low on firsthand evidence is expected.
5. The leakage test, which is a grep and not a model question: search the
   documents for the norm's own vocabulary, which must not appear in a text
   that applies it —
   `grep -nE '答えの半分|未回収|緊張(を|が)|回収(する|し)|線を引(く|いて)|問いを.*返す|装置|拍を|緩み' $ARGUMENTS`
   — and report every hit as a sentence to delete and realise in content
   instead.
6. Say which findings a reader should act on and which are the rule
   reading a boundary as the middle. Do not rewrite the document unless
   asked.
