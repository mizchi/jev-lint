# trait-name-describes-methods

A new rule, in Rust and MoonBit: does a trait's name describe what its
methods do?

Ships in both.

## The question it adds

`type-name-describes-shape` asks whether a type's name describes its
members -- a claim about data. A trait's name claims a **capability**:
what implementing it lets a value do. The compiler checks that the
methods exist and never that the name is about them; a linter can enforce
casing and nothing else. `Comparable` whose one method renders,
`Serializable` that only measures a length, `Named` that also sorts and
serialises: each is a claim a reader acts on and the methods contradict.

## Final numbers

| | rust | moonbit |
|---|---|---|
| subjects | 10 | 11 |
| defects | 4 | 5 |
| cleans | 6, of which 5 hard | 6, of which 5 hard |
| cutoff (`at:`) | **0.62** | **0.60** |
| precision / recall | 1.00 / 1.00 | 1.00 / 1.00 |
| clean band tops at | 0.44 | 0.46 |
| defects start at | 0.81 | 0.75 |
| headroom | 0.18 a side | 0.14 / 0.15 |
| flips over 3 passes | 0 | 0 |

## What the hard cleans are

- **A marker trait** (Rust `Copyable {}`): no method, so nothing can
  contradict the name. 0.21-0.25.
- **A method whose name repeats the trait's** (`Copyable` with `copy`,
  `Printable` with `to_line`): what the name says, not a tautology to
  punish. 0.06-0.08.
- **Several methods that add up to the name** (`Cacheable` with
  `cache_key` and `ttl_seconds`; `Countable` with `length` and
  `is_empty`): 0.13-0.18.
- **A default method body** (Rust `Countable::is_empty`): counted as part
  of what the trait provides. 0.11-0.12.
- **`Sortable` with one `sort_key`** is the top of both clean bands (0.44,
  0.46) and the reason the cutoff is where it is: an adjective over a
  noun-returning method is the shape the model is least sure of.

## What it costs

Rust: 10 subjects, 3 requests, $0.0009 for three passes. MoonBit the
same. The rule is `located`, so each file travels once.

## One change outside the rule

MoonBit's `type-name-describes-shape` matched `trait_definition` as well
as struct, enum and newtype. Asking both rules of one declaration reports
the same name twice under two sentences, so the trait alternative was
removed from it and its two trait cases moved here; its baseline was
re-accepted (P/R 1.00 on 10 subjects, unchanged otherwise). Rust has no
type-name rule, so nothing moved there.
