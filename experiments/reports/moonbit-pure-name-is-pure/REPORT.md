# pure-name-is-pure, ported to MoonBit

`rules/moonbit/pure-name-is-pure/`. Ported from `rules/python/pure-name-is-pure`
(snake_case, so the name regex carries over) and
`rules/typescript/pure-name-is-pure` (the fuller criteria, and the record of
what that copy got wrong first).

Ships.

## Final numbers

| | |
|---|---|
| subjects | 30 (2 fixture files) |
| defects | 11 |
| cleans | 19, of which 12 are hard twins of a defect in the same file |
| cutoff (`at:`) | **0.55** |
| fitted midpoint | 0.53 – 0.55 depending on the run |
| precision | 1.00 |
| recall | 1.00 |
| decision flips | 0 |
| clean band | 0.02 – 0.07, plus one member at 0.19 – 0.22 |
| defect band | 0.85 – 0.98 |
| headroom, clean side | 0.33 (0.55 − 0.22, worst observed clean) |
| headroom, defect side | 0.30 (0.85 − 0.55, worst observed defect) |
| max pass-to-pass spread | 0.05 (`parse_next_field`) |
| `state` | `located` |
| `severity` | `info` |

Three independent `--repeat 3` runs on the final corpus (nine passes), one of
them under the repository's own `docs/moonbit.jev-lint.yaml` rather than the
working config: identical decisions each time, `cleanTop` 0.19 / 0.21 / 0.22,
lowest defect 0.85 / 0.86 / 0.86.

0.55 is the midpoint (0.53 – 0.55) rounded onto the false-positive side, and it
is also what the typescript copy of this rule ships. Nothing in the corpus
argues for moving it; the reason not to go lower is stated under "the one case
that matters" below.

## The matcher, and what MoonBit's grammar forced

The brief's verified shape was

```yaml
- kind: function_definition
- has: { kind: function_identifier, stopBy: end, pattern: $NAME, regex: ^(compute|calculate|derive|format|to|parse)(_|$) }
```

It is one character short of correct for MoonBit, and the shortfall is
structural, not cosmetic. A probe file against the real parser:

| written as | matched? | `$NAME` |
|---|---|---|
| `pub fn to_local(x : Int)` | yes | `to_local` |
| `pub fn[T : Show] format_all(xs)` | yes | `format_all` |
| `async fn parse_remote(url)` | yes | `parse_remote` |
| `pub fn P::to_label(self : P)` | **matched the node, failed the regex** | `P::to_label` |
| `pub impl Show for P with output(...)` | no — not a `function_definition` | — |
| `pub impl ToJson for P with to_json(...)` | no — not a `function_definition` | — |

`function_identifier` carries the whole `Type::method` for a method
definition, so `^to` never fires on one. That silently discards the shape where
MoonBit actually puts receiver mutation — `Catalog::compute_revision(self, now)`
assigning `self.revision`. The regex therefore takes an optional qualifier:

```
^([A-Za-z][A-Za-z0-9_]*::)?(compute|calculate|derive|format|to|parse)(_|$)
```

That is the only change to the matcher, and it is a grammar fact rather than a
taste call. With it, `Catalog::compute_revision` (0.95) and `Product::to_json`
(0.03) both become subjects, one on each side.

### Does `to` earn its place?

Yes, and the argument is the table above rather than a judgement call. The worry
was that `to_string` and `to_json` would flood the matcher with trivially clean
subjects. In MoonBit they do not, because the conventional conversions are
written as **trait impls** — `impl Show for T with output`, `impl ToJson for T
with to_json` — and those are not `function_definition` nodes at all. The
parser never hands them over. What `to` actually brings in is explicit
conversion functions, and on the corpus those split: `to_stock_report` (0.07),
`to_receipt` (0.06) and `Product::to_json` (0.03) sit at the floor of the clean
band, while `to_search_entry` (0.91) — a conversion that also registers the
entry into the `Map` it was handed — is a genuine defect that no other prefix
would have caught. Dropping `to` would cost a defect class and save nothing.

I did **not** widen the prefix set beyond the family's six. Candidates that
MoonBit idiom would arguably justify are `render`, `encode`, `decode` and
`serialize`; `build_*`, `make_*` and `from_*` are constructors and would flood
the matcher with cleans, since building a value imperatively is the MoonBit
default. Widening the set changes the rule for every language that shares the
sentence, so it belongs to whoever integrates the family, not to this port.

## What MoonBit changed, relative to Python and TypeScript

**The `state` arm moved from `local` to `located`.** Python and TypeScript both
judge this rule on the matched code plus its enclosing function. That does not
work in MoonBit. A MoonBit module is a flat sheet of free functions over
top-level `let` bindings, and the fact that decides most subjects —
is `score_cache` a top-level store or a local accumulator? — is on a line the
subject's own text does not contain. `located` also lets the model see that
`format_item_line`, which `format_summary` calls, is itself pure.

**The criteria were rewritten, not copied.** The TypeScript sentence is a list
of JavaScript things (`this`, module-level bindings, `fetch`, a URL, a query).
MoonBit's effects are a smaller and completely visible set, so the criteria name
them: assignment to a `mut` field of a handed struct or of `self`; `push`,
`set`, `clear`, `remove`, `swap` on an `Array`, `Map`, `Set`, `Ref` or
`StringBuilder` that arrived as a parameter or is top-level; assignment through
a top-level `let mut` or a `Ref`; a write into a cache a later call reads;
`println`; the clock, environment or a random source.

**The one thing MoonBit makes harder than either source language** is the clean
side, and it is the whole reason this port has content. MoonBit code builds
results imperatively as a matter of course — `let out = []` then `push` in a
loop then return `out` is the ordinary way to write a pure function. The
defect and the clean have literally the same tokens; the only difference is
where the container came from. `derive_discount_notes` (0.96, pushes into a
parameter) and `derive_item_labels` (0.04, pushes into an Array it made) sit two
functions apart in the same file with the same loop body. The criteria carry a
sentence for exactly this, and the `note` carries another.

**What MoonBit's type system took off the table.** The brief's trap: `raise` is
part of a MoonBit function's type, so "can this fail" is the compiler's job and
is explicitly excluded in the `note`. What is *not* in the type, and is
therefore fair game, is every form of mutation in the list above — MoonBit
checks none of it.

## Wording attempts

Only two revisions of the criteria, but the second one is the important one.

**Revision 1** — the criteria as first written, over a 24-subject corpus.
Precision 1.00, recall 1.00, clean band 0.02 – 0.07, defect band 0.92 – 0.97.
A gap of 0.85. This is not a good result, it is a warning: the brief says a
corpus whose cleans are all trivially clean produces a cutoff that looks safe
and falls over on the first real function, and an 0.85 gap means every hard
twin I had written was, to the model, not hard. Rather than accept it I added
five adversarial subjects: a `sort_by` on a `copy()` of a parameter's Array
(`derive_sorted_items`), a `{ ..invoice, total: ... }` struct update that looks
like an assignment (`compute_rebilled`), a body that only *reads* the top-level
cache (`compute_known_score_total`), a consuming cursor that removes from the
Array it was handed (`parse_next_field`), and I/O one hop away through a
file-local helper (`format_debug_row`). The gap narrowed to 0.08 → 0.85. Cost:
nothing but the writing; no label moved.

**Revision 2** — the memoising loader. Revision 1 of the *TypeScript* rule
counted a lazily loaded module as I/O and was wrong on all six of its findings
on an unseen repository; revision 2 of that rule carved out "obtaining a
dependency is not an effect." My MoonBit criteria at this point said the
opposite, in one sentence I had written to make `format_debug_row` come out
bad: *"Calling another function in this file that does one of these things is
doing it."* Read literally that sentence re-introduces the exact defect the
TypeScript rule had already paid for, because a MoonBit `fn bands()` that fills
a top-level `Map` on first use *is* a function in this file that writes to a
top-level binding.

So I wrote the case (`format_weight_band` — asks `bands()` for a table, reads
one entry, returns a String) and split the sentence in two:

- `"true"` now says: *an effect one hop away is still this body's: calling a
  function defined in this file that prints, or that writes **this body's
  result** into a store, is doing it.*
- `"false"` gains: *obtaining something the body needs is not an effect: a
  helper that hands back a table, a parser, a formatter or a client, and fills
  it in on the first call, is doing its own bookkeeping, not this body's.*
- the `note` gains the line that decides between them: *what gets written.*

Cost elsewhere: none — `format_debug_row` stayed at 0.97, every other defect
moved by at most 0.02, and the clean band did not move. Gain: the case that
broke the TypeScript rule on real code is in the corpus, labelled, and answers
0.19 – 0.22.

I did not try a third wording. Nothing in the answers argued for one.

## Cases within 0.10 of the cutoff

**None.** The nearest subject on either side is 0.33 away. Named anyway, because
the two of them are what the cutoff is actually resting on:

- **`catalog.mbt:172 format_weight_band`, clean, 0.19 – 0.22.** The whole rest
  of the clean band is 0.02 – 0.07, so this one subject is three times further
  out than every other clean put together. That is the correct shape of answer:
  the body does reach a top-level `Map` that a helper mutates, and a careful
  reader should hesitate before calling it pure. It is the reason I would not
  drop the cutoff below 0.4 even though the midpoint allows it, and the reason
  this ships at `severity: info`. If real MoonBit has more loader-shaped
  `compute_*` functions than my corpus does, this is the band they will land in,
  and 0.55 is 0.33 clear of it.
- **`invoice.mbt:155 parse_next_field`, bad, 0.85 – 0.91, spread 0.05.** The
  lowest defect and the only subject with a spread worth mentioning. A cursor
  that returns the head token and `remove`s it from the caller's Array. I
  labelled it bad and I would defend that — `parse_next_field(tokens)` leaves
  the caller's `tokens` shorter, which is a write to a parameter however
  idiomatic the pattern — but it is the one label in this corpus a reasonable
  reviewer could argue with, and the model's hesitation is honest rather than
  confused.

## What the rule cannot see

- **Anything the file does not contain.** `located` is one file. A
  `compute_*` that calls a helper in another package which writes a file reads
  as pure here. The one-hop carve-out only works because both hops are in the
  fixture file; across a package boundary the rule has nothing to go on.
- **Aliasing.** A body that stores a parameter into a struct it built and
  returns is handing the caller a live reference to something the caller already
  owned. That is a real effect on later state and nothing in the text shows it.
- **Traits.** `impl Show for T with output` and `impl ToJson for T with to_json`
  are not `function_definition` nodes, so an effectful trait impl is invisible
  to this matcher entirely. That is a real gap, not a design decision; fixing it
  needs a second arm of the matcher against whatever node kind the grammar gives
  a trait impl, which I did not attempt because no subject in the family's
  sentence depends on it.
- **Whether the mutation matters.** The rule says a `compute_*` writes to
  something outside itself. It does not say whether anyone minds. A
  deliberately-designed in-place API named `compute_*` will be flagged, and
  correctly so under the sentence, but a maintainer may reasonably call it a
  naming preference. `info` is the right severity for that.
- **`abort`, `panic`, `unwrap`, index-out-of-range, overflow.** Excluded in the
  `note`. They end the program rather than change what a later call observes,
  and they belong to a different sentence.

## Cost

| run | subjects | passes | requests | $ |
|---|---|---|---|---|
| `--dry-run --show-subjects` (×4, incl. grammar probe) | — | — | 0 | 0.00000 |
| eval, corpus v1 | 24 | 3 | 6 | 0.00310 |
| eval, corpus v2 (+5 adversarial) | 29 | 3 | 6 | 0.00372 |
| eval, corpus v3 (+ memoising loader, criteria rev 2) | 30 | 3 | 6 | 0.00437 |
| eval `--accept` | 30 | 3 | 6 | 0.00437 |
| confirm run vs baseline | 30 | 3 | 6 | 0.00437 |
| confirm run under `docs/moonbit.jev-lint.yaml` | 30 | 3 | 6 | 0.00437 |
| **total** | | | **36** | **$0.0243** |

Against a budget of $0.30. As the brief predicted, money was not the
constraint; reading thirty answers against thirty function bodies was.

## Two notes for whoever integrates this

1. **The fixtures compile.** `moon check` on both files under
   `moon 0.1.20260915`, zero errors and zero warnings. The deprecated forms
   `Map::new()`, `StringBuilder::new()` and `Map::size()` were replaced with
   `Map([])`, `StringBuilder()` and `.length()`; `rules/moonbit/fn-name-promises/fixtures/`
   still uses the old spellings and warns.
2. **This rule's directory was deleted mid-session** by something else running
   in the repository — between one eval and the next command,
   `rules/moonbit/pure-name-is-pure/` ceased to exist while the sibling agents'
   untracked directories survived, and three other rules' `baseline.json` files
   were modified in the same window. I restored the fixtures from the `moon
   check` probe and rewrote `rule.yml` and `expect.yml`. Everything reported
   here was re-measured after the restore. If a `git clean` is part of the
   integration flow, untracked rule directories are in its blast radius.
