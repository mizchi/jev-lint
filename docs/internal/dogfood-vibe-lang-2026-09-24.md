# Vibe language dogfood, 2026-09-24

## Scope

Tested `jev-lint` against `mizchi/vibe-lang` at `30a9f6876` plus the parser
changes described here. The Vibe repository owns its tree-sitter grammar at
`integrations/treesitter-vibe`; `jev-lint` loads a native library built from
that grammar through ast-grep's `customLanguages`. This run covers `.vibe`
files under `lib/`, not generated compiler output or `.vibei` files.

## Parser and matcher

The original grammar missed current syntax including named `fn` declarations,
package imports, relative re-exports, constructor expressions, effect
annotations, indexed assignment, slices, exception handlers, character
literals, arrow-bodied function values, and `\{...}` string interpolation.
The last issue caused very large parse recovery regions, hiding otherwise
ordinary functions and tests. The grammar now has 20 passing corpus cases.
Both committed WASM copies pass 40 corpus comparisons, and the native parser
matches `function_declaration` and `test_block` through ast-grep.

On 1,218 `.vibe` files under `lib/`, a dry run planned 19,593 subjects in
1,118 files. Comparing exact line numbers against line-leading declarations
found 11,570 of 11,589 `fn` declarations (99.84%) and 7,743 of 7,759 `test`
blocks (99.79%). These are recall checks for the two syntax shapes, not a
measure of semantic correctness. The remaining 19 functions span 9 files;
the remaining 16 tests span 5 files. Other declaration forms and nested
constructs are outside this comparison.

## Rule quality

Two rules ship: `vibe/fn-name-promises` and
`vibe/test-name-verifies-claim`. Each uses the same question and criteria as
its existing language variants, captures the grammar's `name` field, and has
its own Vibe fixtures and accepted three-pass baseline. Replay reports
precision and recall 1.00 on 8 labelled function examples (3 defects) and 6
labelled test examples (3 defects), with no unanswered examples or flips.
These small authored sets establish that the matchers and cutoffs work; they
do not estimate precision across the repository.

A live run on `checker_warning.vibe`, `array.vibe`, and `array_test.vibe`
examined 36 subjects, returned no findings and no API errors, and cost about
$0.0012. This sample did not contain independently confirmed defects, so zero
findings is not evidence of repository-wide recall. The full `lib/` dry run
estimated about $0.74, and was not sent to the API.

## Remaining work

- Investigate the 35 line-leading declarations that the parser still misses.
- Extend the rule set only with labelled Vibe examples and measured cutoffs.
- Confirm proposed findings on actual Vibe code before turning any rule into a
  blocking gate. The checked-in `.jev-lint.yaml` keeps both at warning level.

The parser build and dry-run workflow is documented in the Vibe repository's
`CONTRIBUTION.md`; `pkf run jev-plan` needs a sibling `jev-lint` checkout and
does not need an API key.
