# improve: openapi-summary-matches-schema

## Rule

`openapi-summary-matches-schema`,
`experiments/rule-candidates/openapi-summary-matches-schema/`. An
operation's `summary`/`description` against its parameters, requestBody
and responses; `subject: node`, `state: bare`, matcher unchanged.

| | start | end |
| --- | --- | --- |
| subjects | 18 (9 bad, 9 clean, all hard) | 30 (16 bad, 14 clean, all hard) |
| `at:` | 0.58 | 0.58 (fitted midpoint 0.46-0.48; kept above it) |
| P / R | 1.00 / 0.89 | 1.00 / 1.00 |
| flips | 0 | 0 |
| bad band | 0.83-0.96, one at 0.40 | 0.77-0.96 |
| clean band | 0.04-0.26 | 0.04-0.16 |
| headroom clean / bad | 0.32 / -0.18 | 0.42 / 0.19 |

The start reproduced the baseline: `catalog.yaml:55` (a description
promising a 404 the responses do not declare) at 0.40 [0.34 0.42 0.44],
read as an omission.

**Bar reached**: P 1.00 R 1.00 on 16 defects and 14 hard cleans, 0 flips,
nothing within 0.03 of the cutoff, 0.42 above the highest clean and 0.19
below the lowest defect, on two consecutive runs of the final question.

## The decision on promised-but-undeclared responses

Made it a contradiction. The argument: the `responses` map is, by the
OpenAPI spec, the operation's declaration of what it can return, and it is
inside the subject; a description that promises "404 if not found" against
a map holding `200` and `410` is contradicted by evidence the model can
see, not by something outside the subject. The criteria now say exactly
that, and say which direction of omission is forgiven (the text saying
less than the map) and which is not (the text promising a code the map
lacks). A second sample of the class (`webhooks.yaml:41`, "409 if the URL
is already registered", only `201` declared) was added before the change
to confirm it was a class: 0.52 [0.63 0.56 0.38] with a flip, beside the
original at 0.42. After the change both answer 0.89-0.93 with spread
<= 0.03, and the three hard cleans that mention a *declared* code
(`webhooks.yaml:96` 404 declared, `webhooks.yaml:191` 410 declared,
`billing.yaml:66` 404 and 409 declared) stay at 0.05-0.12, so the model
is checking the map, not reacting to a number in the text.

Consequence to know about: a real spec whose description says "401 if the
token is missing" while relying on global `security` and declaring no 401
will now be flagged. That is a finding a reviewer can act on (declare the
401) rather than a false positive, but it is the class most real specs
omit, so the rule will fire on it.

## Attempts

0. Cases only (+12 subjects, 7 bad, 5 clean in `webhooks.yaml`), criteria
   unchanged: P 1.00 R 0.88 at 0.58, 1 flip, fitted 0.32. Every new
   defect shape except the undeclared-409 lands at >= 0.84; every new
   clean <= 0.10. Re-run once more by accident (an edit script failed
   before writing): same decisions; the 409 case 0.43-0.63 over six
   passes, the 404 case 0.37-0.50.
1. Criteria: in `true`, "it states a status code or body shape the
   responses do not declare" became "it states a body shape the responses
   do not declare, it promises a status code that is not a key of
   `responses` -- the responses map is the operation's complete
   declaration of what it can return, so a '404 if not found' or '409 if
   it already exists' whose code is absent from the map is contradicted
   by the map, not merely left out of it"; in `false`, "...is not a
   contradiction; the omission that counts is the other way round, a code
   the text promises and the responses map lacks." P 1.00 R 1.00, 0
   flips, fitted 0.48. `catalog.yaml:55` 0.41 -> 0.93, `webhooks.yaml:41`
   0.50 -> 0.89. No clean moved by more than 0.06.
2. Accept run (same question): P 1.00 R 1.00, 0 flips, fitted 0.46; bad
   band 0.77-0.96, clean band 0.04-0.16. `--replay` passes.

`at:` stays 0.58: above the fitted midpoint for headroom on real specs,
with 0.19 to the lowest defect (`webhooks.yaml:114`, "only `url` and
`events` can be changed" over a body that also accepts `active` and
`description`, 0.77-0.80).

## Cases added

All in `openapi/webhooks.yaml`, subject line = the `operationId` line.

- 9 bad: "the `status` filter is optional" over `required: true`. 0.92.
- 41 bad: "Returns 409 if the same URL is already registered" over
  responses declaring only `201`. The second undeclared-status sample;
  0.50 -> 0.90.
- 68 clean hard: read-only POST `lookup` whose body is the query, array
  response. 0.07.
- 96 clean hard: "or 404 if no endpoint has that id" with `404` declared;
  the contrast to the defect class. 0.05.
- 114 bad: "Only `url` and `events` can be changed" over a body schema
  that also accepts `active` and `description`. 0.77-0.84, the lowest
  defect; it is the description saying less than the schema *allows*,
  which is the hardest shape to call a contradiction.
- 147 bad: "returns 200 with the deleted endpoint" over `204` no content.
  0.93 (mirror of `users.yaml:125`).
- 165 clean hard: idempotent PUT that replaces delivery config. 0.10.
- 191 clean hard: "shown only once ... later calls return 410"; the
  once-only claim is not checkable, the 410 is declared. 0.10.
- 213 bad: "Responds 400 if the URL is not https" over a map declaring
  that condition as `422`: wrong code for a declared condition. 0.92.
- 237 bad: "as an array, newest first" over a 200 schema that is a single
  attempt object. 0.95.
- 259 clean hard: "cannot be undone" is not checkable; 204/404 hold. 0.10.
- 275 bad: "returns 200 with the endpoint's response once it has
  answered" over `202 Ping scheduled` with an `attemptId`: described as
  synchronous, declared asynchronous. 0.93.

The brief's three hard-clean shapes (a summary that says less, a
read-only POST search, an idempotent PUT) now each have two samples
(`billing.yaml:9`/summary-only envelope, `billing.yaml:91`/`webhooks:68`,
`users.yaml:82`/`webhooks:165`), and the three defect shapes it asked for
(wrong status code, optional-but-required parameter, list-vs-object) are
`webhooks:213`+`:275`+`:147`, `webhooks:9`, `webhooks:237`.

## What stops the bar

Nothing. The residual to watch is `webhooks.yaml:114` at 0.77-0.80: a
description that restricts more than the schema does is the one defect
shape the model is least sure is a contradiction rather than a
convention, and a second sample of it on real code might sit lower.

## Unseen check

Not run: agent-cluster has no OpenAPI document (`grep -l "^openapi:"` over
its `.yml`/`.yaml` files finds none), and the corpus has nothing with
`$ref` parameters, so the original report's open question -- whether
`bare` still holds when the evidence is behind a `$ref` the subject cannot
see -- is still open.

## Cost

Five paid runs: baseline eval 9 requests; three evals of 30 subjects at
12 requests each (cases, an accidental repeat, attempt 1); the accept run,
12. **57 requests, ~305k input tokens, $0.013.**
