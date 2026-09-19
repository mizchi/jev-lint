# Family A: claims in non-code files

A GitHub Actions step's `name:`, a `package.json` script key and an OpenAPI
operation's `summary:`/`description:` are all claims about the thing beside
them, and every existing tool that parses these files (actionlint,
npm-package-json-lint, spectral) checks structure and never reads the claim.
jev does the one thing they cannot: it reads "Run tests" against
`npm run build`, "lint" against `prettier --write .`, "returns a list" against
a `type: object` schema, and says whether the claim holds. ast-grep parses
YAML and JSON, so the matcher half is the same as for code; the subject is
the mapping (or pair) that holds both the claim and the evidence, so
`subject: node` + `state: bare` carries the whole comparison and nothing else
in the file matters. All three rules were built and measured on that shape.

Corpus: 88 subjects over 9 files (3 workflows, 4 package.json, 3 OpenAPI
documents), labelled by hand in `labels.json` with `"window": 0` on every
label (see the notes at the end for why). Final record:
`records/family-attempt3.json`, 3 passes; earlier attempts are kept beside
it. Every fit below is `replay` of that record, so it is checkable without a
key.

---

## workflow-step-name

### Rule

```yaml
- id: workflow-step-name
  language: Yaml
  kind: noul
  subject: node
  state: bare
  at: 0.44
  rule:
    # A step: the mapping directly under a sequence item, holding a `name:`
    # and a `run:` or `uses:`. The mapping is the subject, so the claim and
    # the evidence are both in it.
    kind: block_mapping
    inside:
      kind: block_node
      inside: { kind: block_sequence_item }
    all:
      - has:
          kind: block_mapping_pair
          all:
            - has: { field: key, regex: "^name$" }
            - has: { field: value, pattern: $NAME }
      - has:
          kind: block_mapping_pair
          has: { field: key, regex: "^(run|uses)$" }
  ask: >-
    This workflow step's name ($NAME) misdescribes what the step runs.
  criteria:
    "true": >-
      Someone who read only the name would be wrong about what the step
      does: the command or action performs a different operation than the
      name states (builds when the name says test, formats when the name says
      lint, checks out when the name says cache, downloads when the name says
      upload), it rewrites files when the name promises only a check or a
      verification, or the step also does something consequential --
      publishes, pushes, deploys, deletes, commits -- that is not part of
      what the name names.
    "false": >-
      The command or action does what the name says. A terse name ("Test",
      "Install"), a conventional name for a well-known action ("Checkout"
      for actions/checkout, "Setup Node" for actions/setup-node), or a name
      that summarises a multi-line script as one operation is not a
      mismatch, even when that operation conventionally ends in a commit,
      push or deploy -- a version bump that pushes its tag, a release that
      publishes, a preview that deploys to a preview environment.
  note: >-
    Judge the name against the `run:` script or the `uses:` action and its
    `with:` inputs only. Whether the step is placed well, or whether it
    should exist, is not the question.
```

### Corpus

33 subjects found (`corpus/workflows/ci.yml`, `release.yml`, `nightly.yml`),
10 bad, 23 clean, of which 17 are hard cleans (conventional names for
well-known actions, terse names, names summarising a multi-line run that
ends in a push or deploy).

Bad cases:

- `ci.yml:31` `Run tests` over `run: npm run build`
- `ci.yml:37` `Lint` over a script that also runs `npm publish`
- `ci.yml:44` `Check formatting` over `prettier --write` (rewrites, does not check)
- `ci.yml:60` `Cache dependencies` over `uses: actions/checkout@v4` (fetches a fixtures repo)
- `ci.yml:75` `Upload coverage` over `uses: actions/download-artifact@v4`
- `release.yml:47` `Type check` over `npx eslint .` (lints, does not type-check)
- `release.yml:63` `Clean up workspace` over `gh release create`
- `nightly.yml:25` `Install dependencies` over `npm ci && npm audit fix --force` (rewrites package.json and the lockfile with breaking upgrades)
- `nightly.yml:28` `Bump version` over `npm version ... && npm publish --tag canary` (publishing is not part of bumping)
- `nightly.yml:43` `Upload logs` over `rm -rf logs/`

### Attempts

1. First sentence and criteria, 23 subjects. `gaps`: **works**, gap 0.35,
   head +0.31 at 0.70. Fit at the fitter's 0.82: p 1.0 r 0.86 (tp 6 fp 0 fn 1).
   Two hard cleans read as violations -- `Bump version` (pushes its tag)
   0.76, `Build and preview site` (deploys a preview) 0.74 -- and one bad,
   `Check formatting` / `prettier --write`, read as clean at 0.39: the
   criteria named "formats when the name says lint" but not "rewrites when
   the name says check".
2. Criteria only: added "rewrites files when the name promises only a check"
   to `true`; reworded `false` so a summarising name is forgiven "even when
   that operation conventionally ends in a commit, push or deploy". Added
   two more summarising hard cleans (`Publish docs`, `Deploy`), 26 subjects.
   `gaps`: **works**, gap 0.48, head +0.38. Fit 0.56: p 1.0 r 1.0 (tp 7).
   `Check formatting` rose to 0.88; `Bump version` fell to 0.32, `Build and
   preview site` to 0.24.
3. Corpus only (same sentence): 7 unseen steps in `nightly.yml`, three bad,
   four clean. Unseen, at 0.56: 3/3 bad flagged, 0/4 clean flagged, but
   `Install dependencies` + `audit fix --force` sat at 0.58. Refit on all 33:
   `gaps`: **rewrite** (gap 0.24, narrow), head +0.12 at the fitted 0.44.

### Fit

Cutoff **0.44** (fitter's midpoint). Precision 1.0, recall 1.0 (tp 10 fp 0
fn 0). Decision flips across the 3 passes: 0. Max spread 0.08. Bad band
0.56-0.96 (nine of ten at >= 0.73), clean band 0.03-0.32. Headroom above
the highest clean 0.12; margin below the lowest bad 0.12; worst single-pass
values 0.36 (clean) and 0.53 (bad).

### Verdict

**COOKBOOK.** It separates the corpus with no flips, but the gap is one
subject wide on each side: the subtle-side-effect bad (`audit fix --force`
under "Install dependencies") lands at 0.56, and the summarising hard cleans
only fell below 0.35 after the `false` criterion named their shape
(bump-that-pushes, preview-that-deploys), which is criteria fitted to this
corpus. Without the audit-fix case the gap is 0.41 and it would ship; with
it, `gaps` says rewrite, and the next real "install that also mutates the
lockfile" is a coin flip.

### What I would change

Corpus: more of the subtle-extra-effect class (a `Test` that also uploads
to codecov, an `Install` that also runs a postinstall build) to find out
whether 0.56 is that class's level or one sample. Criteria: the `false`
branch's list of forgiven endings is the part I trust least; the shorter
version "a name that summarises a multi-line script as one operation" was
tried in attempt 1 and did not forgive the push. Matcher: fine -- 33/33
intended steps found, nothing unintended, captures right.

---

## script-name-does

### Rule

```yaml
- id: script-name-does
  language: Json
  kind: noul
  subject: node
  state: bare
  at: 0.56
  rule:
    # One entry of `"scripts": { ... }` in a package.json: the pair is the
    # subject, the key is the claim, the value is the command.
    kind: pair
    all:
      - has: { field: key, pattern: $SCRIPT }
      - has: { field: value, kind: string, pattern: $COMMAND }
    inside:
      kind: object
      inside:
        kind: pair
        has: { field: key, regex: '^"scripts"$' }
  ask: >-
    This npm script's name ($SCRIPT) misdescribes the command it runs
    ($COMMAND).
  criteria:
    "true": >-
      The command does a different thing than the name states: it prints or
      exits instead of doing the named work, it rewrites files when the name
      promises only a check ("lint" running a formatter in write mode), it
      only deletes when the name promises an artifact ("build" that is just
      rm -rf), it runs a different tool category than the name says
      ("typecheck" running a linter, "e2e" running unit tests), it only
      reports when the name promises to change files ("format" running a
      linter without a fix flag), or it also does consequential extra work
      -- publishes, deploys, commits, deletes -- the name does not mention.
    "false": >-
      The command does what the name says. A terse or abbreviated name, a
      name that describes the sum of several delegated scripts, a name that
      covers a family of read-only checks ("lint" that also type-checks,
      "check" that runs several checkers), an npm lifecycle hook
      (pre*/post*/prepare/postinstall/version) whose command is the
      conventional thing to run at that moment, or a tool whose own name
      differs from the script name but does the named work is not a mismatch.
  note: >-
    Judge only the script name and its command. A `pre<x>` or `post<x>` name
    promises only "runs before/after x", not x itself, so a `prebuild` that
    clears the output directory is honouring its name. Whether the tool is a
    good choice, or whether the script should exist, is not the question.
```

### Corpus

37 subjects found (`corpus/package-json/{app,lib,cli,monorepo}/package.json`),
9 bad, 28 clean, of which about 20 are hard cleans (lifecycle hooks, terse
names, tool names that differ from the script name, delegating scripts,
umbrella names).

Bad cases:

- `app:8` `build` is `rm -rf dist` -- deletes, produces nothing
- `app:12` `lint` is `prettier --write .` -- formats and rewrites, does not lint
- `app:14` `typecheck` is `eslint . --ext .ts,.tsx` -- lints, does not type-check
- `lib:17` `test` is `echo ok` -- runs no tests
- `lib:21` `clean` is `rm -rf dist && tsc -p tsconfig.build.json` -- also builds
- `cli:16` `typecheck` is `tsc --noEmit && git add -A && git commit ...` -- also commits
- `monorepo:6` `test:e2e` is `vitest run --dir src/unit` -- unit tests, not e2e
- `monorepo:7` `format` is `eslint .` -- reports, changes nothing
- `monorepo:8` `start` is `npm run build` -- builds, starts nothing

### Attempts

1. First sentence, 29 subjects. `gaps`: **works**, gap 0.46, head +0.34.
   Fit 0.61: p 1.0 r 1.0 (tp 6). One wobble: `prebuild: rm -rf dist` (hard
   clean, lifecycle hook) answered 0.53 / 0.19 / 0.37 across passes.
2. Note only: added that a `pre<x>`/`post<x>` name promises "runs before/after
   x", not x. `gaps`: **works**, gap 0.44. Fit 0.52 (tp 6). `prebuild` fell
   to 0.10 with spread 0.00. One decision flip at the uncalibrated 0.70
   (`test: echo ok`, 0.74 mean, spread 0.13); none at the fitted cutoff.
3. Corpus (8 unseen scripts) then criteria: unseen at 0.52, `format: eslint .`
   (bad) scored 0.58 and `lint: biome lint . && tsc --noEmit` (hard clean,
   umbrella name) scored 0.59 -- both mid-scale, 0.06 from the cutoff.
   Added "only reports when the name promises to change files" to `true`
   and "a name that covers a family of read-only checks" plus the `version`
   hook to `false`. Refit on all 37: `gaps`: **works**, gap 0.46, head
   +0.37 at 0.70, +0.23 at the fitted 0.56. `format` rose to 0.84, `lint`
   fell below 0.20.

### Fit

Cutoff **0.56** (fitter's midpoint). Precision 1.0, recall 1.0 (tp 9 fp 0
fn 0). Decision flips across the 3 passes: 0. Max spread 0.15 (on cleans
near 0.25-0.33; the three highest cleans are `version: changeset version &&
git add .` 0.33, `test:watch: vitest` 0.24, `watch: node --watch` 0.23). Bad
band 0.79-0.95, clean band 0.04-0.33. Headroom above the highest clean
0.23; margin below the lowest bad (`test: echo ok`, 0.79) 0.23; worst
single-pass values 0.38 (clean) and 0.74 (bad).

### Verdict

**SHIP.** Separates with 0.23 headroom on both sides and no flips over 37
subjects, including nine lifecycle-hook and umbrella-name hard cleans. The
caveat is that the third-attempt criteria were written after seeing the two
mid-scale unseen cases, so those two are no longer unseen; the classes they
stand for (a check named as a mutation, an umbrella name) are now stated in
the criteria rather than discovered by the model.

### What I would change

Corpus: a `package.json` from a real repository, since every one here was
written knowing the rule. Nothing in the matcher or subject: the pair holds
both sides, `bare` was right first time, and 37/37 subjects were found with
`$SCRIPT`/`$COMMAND` captured (with their quotes, see notes).

---

## openapi-summary-matches-schema

### Rule

```yaml
- id: openapi-summary-matches-schema
  language: Yaml
  kind: noul
  subject: node
  state: bare
  at: 0.58
  rule:
    # An operation: the mapping that is the value of an HTTP-method key and
    # holds `responses:`. Its `summary`/`description` are the claim; its
    # parameters, requestBody and responses are the evidence.
    kind: block_mapping
    inside:
      kind: block_node
      inside:
        kind: block_mapping_pair
        has: { field: key, regex: "^(get|post|put|patch|delete|head|options|trace)$" }
    all:
      - has:
          kind: block_mapping_pair
          has: { field: key, regex: "^responses$" }
      - any:
          - all:
              - has: &summary
                  kind: block_mapping_pair
                  all:
                    - has: { field: key, regex: "^summary$" }
                    - has: { field: value, pattern: $SUMMARY }
              - has: &description
                  kind: block_mapping_pair
                  all:
                    - has: { field: key, regex: "^description$" }
                    - has: { field: value, pattern: $DESCRIPTION }
          - has: *summary
          - has: *description
  ask: >-
    This operation's summary or description claims something that its
    parameters, request body or responses contradict.
  criteria:
    "true": >-
      A specific claim in the summary or description is false of the schema
      beside it: it says the response is a list when the success response
      schema is a single object or the reverse, it names a parameter, field
      or header the operation does not declare, it states a status code or
      body shape the responses do not declare, it lists accepted values that
      differ from an enum, or it calls the operation safe, read-only or
      free of side effects when the method and responses show it creates,
      replaces or deletes something.
    "false": >-
      Every checkable claim holds. A summary that is vague, says less than
      the schema, or does not mention pagination, envelopes or error codes
      the schema declares is not a contradiction.
  note: >-
    Judge only claims the operation's own parameters, requestBody and
    responses can confirm or contradict. A claim about authentication, rate
    limits, other endpoints, or behaviour the schema cannot show is not
    checkable here and is not a violation. A POST used for a search or
    query that only reads is not a contradiction.
```

### Corpus

18 subjects found (`corpus/openapi/users.yaml`, `billing.yaml`,
`catalog.yaml`), 9 bad, 9 clean, all nine cleans hard (vague-but-true
summaries, summaries that say less than a paginated envelope, claims the
schema cannot check -- scopes, rate limits, cache lifetime, irreversibility
-- a read-only POST search, an idempotent PUT).

Bad cases:

- `users.yaml:13` says "returns all users ... as an array"; 200 schema is a single user object
- `users.yaml:34` says "idempotent and safe, no side effects"; POST that creates, 201 + Location, 409 on duplicate
- `users.yaml:106` says "requires the `orgId` query parameter"; only `id` in path is declared
- `users.yaml:125` says "returns 204 with no body"; responses declare 200 with a JSON body
- `billing.yaml:39` says `format` accepts `csv` or `json`; enum is `[pdf, xlsx]`
- `billing.yaml:149` says the response has a `refunds` array and an `expand` query parameter; neither is declared
- `catalog.yaml:29` says the body must include `sku` and `price`; only `sku` is required and `price` is not a property
- `catalog.yaml:55` says "or 404 if no product has that SKU"; responses declare only 200 and 410
- `catalog.yaml:89` says "as a flat array"; 200 schema is an object wrapping a `categories` array

### Attempts

1. First sentence, 13 subjects. `gaps`: **works**, gap 0.62, head +0.46.
   Fit 0.54: p 1.0 r 1.0 (tp 6). Bad band 0.89-0.96, clean band 0.04-0.19.
2. No change to the rule (re-asked alongside the others): gap 0.63, fit
   0.56, same six, max spread 0.02.
3. Corpus only: 5 unseen operations in `catalog.yaml`, three bad, two
   clean. Unseen at 0.56: two of three bad flagged (0.93, 0.81), the
   undeclared-404 case at 0.34, both cleans under 0.11. Refit on all 18:
   `gaps`: **works**, gap 0.44 (between the 0.36 bad and the 0.80 bad),
   fitter suggests 0.58; the fitter's own "midpoint" 0.27 sits 0.09 above
   the highest clean and was rejected for headroom.

### Fit

Cutoff **0.58** (the `suggest` value, chosen for headroom over the fitter's
0.27). Precision 1.0, recall 0.89 (tp 8 fp 0 fn 1). Decision flips across
the 3 passes: 0. Max spread 0.07. Bad band 0.80-0.96 plus the one outlier
at 0.36; clean band 0.06-0.17. Headroom above the highest clean 0.41;
margin below the lowest caught bad 0.22; worst single-pass clean value 0.18.

### Verdict

**SHIP**, with one named hole. Eight distinct contradiction shapes (list vs
object, undeclared parameter, undeclared field, wrong status/body, wrong
enum, wrong required set, envelope vs flat array, safe-on-a-creating-POST)
land at >= 0.80 and every hard clean, including four not-checkable claims
and a read-only POST, under 0.18. The hole: a description that promises a
status code the responses do not declare reads as an omission, not a
contradiction (0.36, stable across passes). That is a class, not noise, and
it is the same class real specs omit constantly, so at 0.58 it is a known
false negative rather than a threat to precision.

### What I would change

Criteria: if the undeclared-status class matters, it needs its own clause
("promises a status code the responses do not list") -- and probably its
own rule, since it is an omission check and the other eight are
contradictions. Corpus: the OpenAPI corpus is the thinnest of the three at
18; a real spec with `$ref` parameters would test whether `bare` still
holds when the evidence is behind a reference the subject cannot see (it
will not, and `located` is the arm to measure then).

---

## Cost

From the tool's own summaries: gaps (attempt 1) 7 requests $0.00146;
calibrate attempt 1, 3 x 7 requests, $0.00437; calibrate attempt 2, 3 x 7
requests, $0.00482; unseen check, 9 requests, $0.00150; calibrate attempt 3,
3 x 10 requests, $0.00654. **Total 88 requests, ~445k input tokens, ~15.5k
output tokens, $0.0187.** Every paid run was preceded by `--dry-run`.

---

## Notes for a future YAML/JSON rule author (not in the skill)

1. **`inside:` and `has:` stop at the neighbour by default, and YAML has a
   `block_node` wrapper between every container and its contents.** A step
   is `block_sequence_item > block_node > block_mapping`, so
   `inside: { kind: block_sequence_item }` on a `block_mapping` matches
   nothing, silently. Either nest (`inside: { kind: block_node, inside: {
   kind: block_sequence_item } }`) or add `stopBy: end`. The same wrapper
   sits between a `block_mapping_pair`'s `value:` and a nested mapping,
   sequence or block scalar; only a plain/quoted scalar is a direct
   `flow_node`.
2. **Keys are matched by text with `has: { field: key, regex: "^name$" }`.**
   In YAML the key node's text is the bare word. In JSON the key node is a
   `string` whose text includes the quotes, so the regex is
   `'^"scripts"$'`, and a captured `$SCRIPT`/`$COMMAND` arrives at the model
   with its quotes (`"\"test\""`). The model coped; the labels and any
   post-processing must expect them.
3. **A YAML block scalar (`>-`, `|`) captures as raw source.** The
   `$DESCRIPTION` text was `">-\n        Renders the invoice ..."`, indicator
   line and indentation included, not the folded string value. Fine for a
   `pattern` capture the model reads; wrong for any `regex` on the captured
   value that assumes the string.
4. **Two `has:` keys in one mapping is a YAML duplicate-key error**
   ("Fail to parse yaml as RuleConfig: duplicate field `has`"), and a
   claim-plus-evidence rule always needs two. Wrap them in `all:`. The
   error comes from ast-grep, not jev-lint, and names the rule file, not the
   line.
5. **`subject: enclosing`, `state: local`, `graph` and `subject: file` have
   nothing to work with in YAML/JSON.** `src/scan.ts` `STRUCTURE` has no
   entry for `Yaml` or `Json`, so there are no containers, imports or
   exports: `enclosing` is the node, `local` is `bare`, the file outline is
   empty. Only `node` + `bare`/`located` are real choices. For these three
   rules `bare` was right on the first measurement because the matched
   mapping holds both sides.
6. **Labels need `"window": 0` for dense subjects.** The default window is
   3 lines and a `bad` label wins over every clean label in its window.
   `package.json` scripts are one per line and workflow steps are three
   lines apart, so the first fit reported tp 25 for six labelled bads and
   was meaningless. `window` is per-label (`l.window ?? 3` in
   `calibrate.ts`), not a top-level key, and the skill's calibration.md only
   says it "widens".
7. **Identical subject text is asked once across files** (`run.ts`,
   `verdictKey`). A `Checkout` / `actions/checkout@v4` step that appears in
   every workflow costs one question, and `--dry-run`'s per-file counts show
   the deduplicated number while the total shows every subject (33 total,
   13 + 6 + 10 per file here). Not a bug, but it reads like one, and it
   means a corpus of copy-pasted steps has fewer independent samples than
   it has labels.
8. **`gaps` does not honour `--record`**; only `calibrate` and `check` do.
   The first gaps run left no record.
9. The language names `Yaml` and `Json` load as written; `rules.ts` also
   accepts them case-insensitively. File discovery is ast-grep's, so
   `.yml`, `.yaml` and `.json` are picked up with no configuration, and a
   directory holding both workflows and OpenAPI documents is scanned by
   both YAML rules -- the matchers here do not cross-fire because one
   requires `run:`/`uses:` and the other an HTTP-method parent key, but
   that is a property of these matchers, not of the tool.
