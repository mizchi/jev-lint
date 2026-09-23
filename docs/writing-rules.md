# Writing a rule

A rule is an [ast-grep](https://ast-grep.github.io) matcher plus one
sentence. The matcher decides **which code is looked at** — exact, free,
local, and silent when it misses. The sentence decides **whether it is a
problem** — answered by the model, and loud, because every answer is
visible. Knowing which half you are working on is most of the job.

Every field is in [reference.md](reference.md#rule-fields); this is the
walkthrough. The shipped rules under `rules/<language>/<id>/` are the
worked examples, and `jev-lint rules` prints what loaded and every
validation error.

## Where it goes

A rule is a YAML file. Put it in `.jev-lint/rules/` — flat
(`.jev-lint/rules/mine.yml`) or, if you want fixtures and a baseline beside
it, in the layout the shipped rules use:
`.jev-lint/rules/<language>/<id>/rule.yml` — and name it in the config's
`rules:` like any shipped one. Everything ast-grep
understands works in `rule:` unchanged — `pattern`, `kind`, `regex`,
`all`/`any`/`not`, `inside`/`has`, `utils`, `constraints`:

```yaml
id: catch-hides-failure
languages: [TypeScript, Tsx]
rule:
  kind: catch_clause
subject: enclosing          # judge the function around the match, not the clause
ask: This catch block swallows a failure the caller needed to know about.
note: logging and rethrowing is fine; returning a default silently is not.
severity: info
```

Three decisions shape whether a rule works, and each is a field:

| field | choices | the question it answers |
| --- | --- | --- |
| `rule` | any ast-grep matcher | which code is looked at. **Over-match on purpose**: a node the matcher misses is never asked about, and the model saying "irrelevant" is cheaper than a tight matcher |
| `subject` | `node` (default), `enclosing`, `file` | what code is judged. The most common failure is asking about code that cannot contain the answer; a `catch` clause alone cannot show whether the failure mattered |
| `state` | `bare`, `local`, `paired`, `located` (default), `graph`, `full` | what else the model sees. Not a quality knob: the least context that still contains the answer. `paired` adds excerpts of the file's related tests, for a question whose evidence is in them |

Capture names when the rule is about a name. `has: { field: name, pattern:
$NAME }` hands `$NAME` to the model by name, and "does this body do what
`$NAME` promises" is a sharper question than "is this well named".

Then check it does something:

```bash
jev-lint rules                                      # loaded, or the validation error
jev-lint check src --dry-run --show-subjects        # which nodes it found, with captures
jev-lint check src --at typescript/catch-hides-failure=2 --retry 3   # a score runs 0-3
```

### Evals: the cases a rule ships with

A cutoff is fitted, not chosen, and a rule is only as good as the cases it
is measured on. Each rule directory carries them, under its language:

```
rules/typescript/catch-hides-failure/
  rule.yml                 one language; a Rust twin goes under rules/rust/
  fixtures/handlers.ts     code that reads like real code -- no markers in it
  expect.yml               fixtures/handlers.ts: [{ line: 12, label: bad, window: 0, reason: "..." }]
  baseline.json            the accepted run: answers, cutoffs, the rule's draft hash
```

The language directory admits only its own grammars (`typescript` admits
the ECMAScript four), so one language's matcher cannot land in another's
file. The same id under two languages is one rule in two languages: it
shares the id in findings and `--at`, and the loader warns if the two
copies of the sentence drift. Two languages are first tier — `typescript`
and `rust` — and every shipped rule under them has fixtures, an expect
file and an accepted baseline; a rule under any other language directory
may ship without a baseline and is listed as uncalibrated.

Expectations live in `expect.yml` and never in the code: a `// DEFECT: named seconds,
holds milliseconds` above a case is inside the file the model is shown, and
the fit then measures the label instead of the rule — which is how this
repository's own corpus once claimed 22 rules at 1.00/1.00 and had 17.
Put in the hard clean cases, the ones a lazy rule would flag.

And put them **near the cutoff**. A corpus of obvious defects and obvious
cleans scores 1.00 on both axes and measures nothing: the rule could drift a
quarter of the way across its scale and no number would move. `jev-lint eval`
refuses a suite in that state — and equally one whose nearest case sits closer
to the cutoff than that case's own pass-to-pass spread, where the score is
decided by the run rather than by the rule. A rule for which this is a genuine
property rather than a lazy corpus says so in `inconclusive:`, naming what was
tried and what it answered; a declaration on a suite that does not need one is
an error.

```bash
jev-lint eval rules/typescript/catch-hides-failure --repeat 3   # ask 3 times, score at the shipped cutoff
jev-lint eval rules/typescript/catch-hides-failure --accept     # ...and make that run the baseline
jev-lint eval --replay                                 # every rule, no requests: the CI gate
```

The score is at the rule's **shipped** cutoff on the mean of the passes —
does the rule as it ships still get its cases right — with the fitted cutoff
printed beside it, not used. `--replay` re-scores every baseline at the
current cutoffs without a request and fails on a case that was right when
the baseline was accepted and is wrong now, or on a rule whose sentence,
criteria, matcher, subject or state changed since: those answers were to a
different question, and the eval has to be run and accepted again. This
repository's `npm run ci` ends in it.

Every field, `score` versus `noul`, the state arms with their measurements,
and sharing one sentence across grammars are in
[docs/reference.md](docs/reference.md#rule-fields).
