# The class level: method-name-promises and class-shape-shows-its-role

Two new rules, in TypeScript and Python. Both ship.

The naming pack asked its questions one member at a time and never about a
class. These two add the level above: whether a method's name, read on its
class, describes its body; and whether a class's name, fields and method
signatures add up to one role.

## method-name-promises

`fn-name-promises` with the class in the question. Both halves reach the
model by name -- `$CLASS.$NAME` -- so the comparison is between two things
the code states.

| | typescript | python |
|---|---|---|
| subjects / defects | 11 / 4 | 11 / 4 |
| cutoff | **0.50** | **0.47** |
| cleans top at | 0.25 | 0.35 |
| defects start at | 0.71 | 0.58 |
| headroom | 0.25 / 0.21 | 0.12 a side |
| precision / recall | 1.00 / 1.00 | 1.00 / 1.00 |

The same eleven methods written twice. Python's clean band sits higher and
its weakest defect lower, so the gap is half TypeScript's: where every
attribute is public, a method that writes surprises a reader less, and
`find_or_create` (0.29-0.35) and `save` (0.22-0.27) are the cases that
climb.

What the class name buys: `CartRepository.save` returning the new size is
clean at 0.23-0.28 because a Repository's `save` is a write and the return
is a detail; the same body under a `Validator` would read differently.
`validate` that also stores the row it was asked to check is the defect
this rule exists for and answers 0.89 -- `fn-name-promises` alone, without
the class, has no reason to call a store surprising.

## class-shape-shows-its-role

The class-level question: a reader meets a class, reads its name, its
fields and its method signatures, and infers what it is FOR. Does that
inference land?

| | typescript | python |
|---|---|---|
| subjects / defects | 8 / 4 | 8 / 4 |
| cutoff | **0.38** | **0.38** |
| cleans top at | 0.21 | 0.18 |
| defects start at | 0.56 | 0.56 |
| headroom | 0.17 / 0.18 | 0.20 / 0.18 |
| precision / recall | 1.00 / 1.00 | 1.00 / 1.00 |

The four defects are four ways the three can disagree: a name about prices
over fields holding a person (0.90-0.93); two roles in one class, mail
sending beside report building, with a field only one of them touches
(0.82-0.86); settings holding a request's mutable state (0.56-0.60); and a
parser carrying an `smtpPort` it never uses (0.83-0.85). The last is the
cheapest to find by hand and the first would survive review for years.

The hard cleans are the ones a lazy rule would flag: two fields for one job
(a retry count and a backoff), a locale beside the lines it formats, a
class with no field at all and one method, and a store whose three methods
all serve its one field. None answers above 0.21.

`SessionConfig` is the case that set the cutoff. Its first version --
a timeout, a user and a request id, with one method that begins a request
-- answered 0.46-0.50 and flipped across passes. Adding what the role
actually implies (a start time, and an `endRequest` that clears both
fields) moved it to 0.56-0.62 without making it a different kind of
defect: the shape says session, the name says config.

## Cost

Four suites, 3 passes each: $0.006 in total. Both rules are `located`.
