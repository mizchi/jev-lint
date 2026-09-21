# What six first-time readers did not understand

2026-09-21. The README's opening was rewritten against this, not against
taste. Kept so that whoever rewrites it next knows which parts were
measured and which were only liked.

## Method

Three candidate openings were drafted in parallel, each from a different
angle: lead with the defective code, lead with the gap between this and a
type checker, lead with the mechanism. Each went to a subagent given
**only that text** -- no repository, no tools, told to answer from the page
and to flag any point where it was reasoning from outside knowledge.

They answered the same questions in the same order. The ones that did the
work:

- *In one sentence, what does this tool do?*
- *What is the example showing? What specifically was wrong with that code?*
- *Did you understand whether this sends your code anywhere? At what point
  did that land -- before or after you'd formed an opinion?*
- *What did you have to already know to follow this?*
- *`0.89 cutoff 0.56 arm located` -- what do you think these mean? Guess.
  Say "no idea" if you have none.*
- *Would you scroll further, close the tab, or try it?*

Asking whether a reader liked it returns that they liked it. Asking what a
term means returns whether they know.

## What six readers said

| | |
| --- | --- |
| Understood the example's defect | **6/6** |
| Read `0.89` / `cutoff` correctly, unprompted | 5/5 asked |
| `arm located` | **3/3 "no idea"** |
| `subject(s)`, `cached` | 3/3 unexplained |
| Noticed code is sent to a service, when the page did not say so | 3/3 inferred it from the cost line |
| ...and treated that as a reason not to run it | 3/3 |

Two quotes that decided edits:

> I am not certain code leaves the machine, I'm reconstructing that from
> cost/token accounting that reads like an LLM API bill.

> [`arm located`] undermines trust in the rest of the output format since I
> now don't know what else in that line I'm not being told.

## What changed, and why

- **The defective code comes first, with no file named above it.** It is
  the only part that worked in every version. A reader who sees
  `examples/cart.ts` before seeing the code has been asked to care about a
  file they cannot see.
- **`arm`, `subject(s)` and `cached` are gone from the first output block.**
  Three of three readers guessed at `arm` and all three guessed wrong. The
  full output still carries them; the first thirty seconds do not.
- **That the code is sent to an API is in the paragraph that explains what
  the tool is**, not in the shell block below it. Stated late, one reader
  noted the disclosure "landed after I'd already formed a favorable
  impression" -- which is worse than stating it plainly up front.
- **The rule YAML was tried in the opening and removed.** One reader
  converted on it ("understood the core mechanic in about ten seconds");
  two were hurt, because it drags ast-grep's matcher DSL into the first
  screen and an `# abridged` note reads as being shown a stand-in. The
  sentence a rule is made of is quoted inline instead: that is the idea,
  and it needs no DSL.
- **"a tenth of a cent" and "measurably good / measurably poor" now link to
  their evidence.** Both were backed by `docs/cost.md` and
  `docs/deepdive.md` and neither said so, so a reader called them "a
  cherry-picked marketing figure" and "asserted with confidence but no
  benchmark". The measurements existed; the claim just did not point at
  them.

## Still open

No reader could tell what happens to their code after it reaches the API.
The page now says the code is sent, which is a fact about jev-lint; what
the service retains is a fact about the service, and stating it would mean
asserting something this repository has not verified.
