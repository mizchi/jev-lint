# Family E: consistency among the siblings in one file

A conventional linter checks a convention it was told: `no-throw-in-handlers`
needs someone to have written down that handlers return `Result`. These two
rules judge the module as one subject (`subject: file`) and let the model read
the convention off the file itself -- five `handle*` returning `Result` say
what the sixth should do; four `get*` say what `loadInvoice` should be called.
Nothing had to be configured, and the same rule applies to a module whose
convention is `(ctx, input)` and to one whose convention is `is*`/`has*`. The
cost of that is that "inconsistent" is a matter of degree, and the measurement
below is mostly about where the degree stops separating.

Corpus: 19 TypeScript modules, 5-6 exports each, one subject per module, both
rules asked about every module. Labels are hand-written in `labels.json`, one
per rule per file, with the argument for each. Records in `records/`;
`records/show.mjs <record> labels.json` prints per-subject means and passes.

One finding about state before the rules: the module outline (`graph`) carries
names, roles, line ranges, imports and within-file call edges -- **no
signatures, no async, no parameter order, no bodies**. Both rules were tried on
`graph` first as the brief asked, and both moved to `full`. What each move
cost is in the Attempts sections.

## module-naming-consistent

**Rule**

```yaml
- id: module-naming-consistent
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  kind: noul
  subject: file
  # `full`, not `graph`: on the outline alone the hard clean case (a sync cache
  # `get` beside an async network `fetch`) sat at 0.47 against a weakest defect
  # of 0.68; with the source it drops to 0.29. The outline has names, not
  # signatures. Costs the file's source in the state (+20% tokens on 30-line
  # files; the whole file on a big one).
  state: full
  axis: file
  # Fitted on records/attempt5-full-repeat3.json: 19 modules, 6 defects,
  # precision 1 recall 1, gap 0.29-0.72, 0 flips over 3 passes.
  at: 0.51
  rule:
    kind: program
  ask: >-
    This module's public items use different verbs for the same kind of
    operation.
  criteria:
    "true": >-
      Two or more public items do the same kind of thing -- the same operation
      applied to different nouns, with the same shape of signature -- yet their
      names use different verbs for it: synonyms such as get, fetch, load and
      retrieve for identical lookups; create, make, new and build for identical
      constructors; set, update, change and modify for identical setters; send
      beside dispatch for identical deliveries; or a function that returns a
      boolean answer like its siblings but is named with a command verb
      (check, verify, validate) where the siblings are named is, has or can.
      Swap the nouns and the items would be interchangeable; only the verb
      differs.
    "false": >-
      Every difference in verb marks a difference in what the item does, and
      the difference is visible here: a synchronous read from a cache beside an
      asynchronous fetch over the network, a lookup by id (get) beside a search
      by criteria (find), a conventional inverse pair such as parse/stringify
      or encode/decode, or verbs naming distinct operations such as create,
      cancel and list. A module with one public item, or whose public items
      each do a different thing, has nothing to be inconsistent about.
  note: >-
    Judge the public items against each other. Private helpers, imports and
    call edges are evidence of what each public item does, not subjects.
    Different nouns are expected; the question is only whether the verbs
    disagree about the same operation.
```

**Corpus**

19 subjects found / 6 bad / 13 clean (of which 5 designed as hard cleans).

- `user_repository.ts` -- bad: `getUser` / `fetchOrder` / `loadCart` /
  `retrieveInvoice` are four identical by-id SQL lookups with the same
  signature; four verbs for one operation.
- `factories.ts` -- bad: `createOrder` / `makeInvoice` / `newCustomer` /
  `buildShipment`, four identical plain-object constructors.
- `permissions.ts` -- bad: `checkAdmin` returns a boolean exactly like
  `isValid` / `hasPermission` / `canEdit` / `isOwner` but is named as a
  command.
- `settings.ts` -- bad: `updateTheme` / `setLocale` / `changeTimezone` /
  `modifyDensity` / `setFontScale`, five identical immutable setters, four
  verbs.
- `notifications.ts` -- bad: `sendEmail` / `sendSms` / `sendWebhook` /
  `dispatchPush`, four identical deliveries; `dispatch` is `send`.
- `lookups.ts` -- bad: four `get*` lookups and one `loadInvoice` doing the
  same thing (the one-deviant degree of the same defect).

Hard cleans: `product_source.ts` (`fetchProduct` async over `./http`,
`getProduct` sync from `./cache`, `loadProduct` cache-then-network -- the
verbs carry the difference); `codec.ts` (`encodeFrame`/`decodeFrame` bytes,
`parseHeader`/`stringifyHeader` text -- two conventional inverse pairs);
`preferences.ts` (`load`/`save` on a path, `get`/`set` on the object -- a lazy
rule flags get vs load); `order_service.ts` (`getOrder` by id and throwing vs
`findOrdersByCustomer` by criteria -- the conventional get/find split);
`rate_limiter.ts` (one export). The remaining cleans are the sibling rule's
files, all of which use one verb throughout.

**Attempts**

1. `state: graph`, first wording -- `gaps`: **rewrite**, gap 0.25 (largest
   step, between two cleans), head +0.02. Labelled: separates, precision 1
   recall 1 at 0.57, but the defect/clean boundary is 0.68 (`permissions`) vs
   0.47 (`product_source`): the hard clean whose difference is only in
   signatures and imports sat mid-scale because the outline has no
   signatures.
2. Same wording, `--arm full` -- `gaps`: **move**, gap 0.37, head +0.10,
   suggest 0.42. `product_source` fell to 0.23; `permissions` 0.60. Cost:
   28.3k -> 34.1k input tokens for 17 files (+20%); on a large file it is the
   whole source, and the 32Ki state budget would step the arm down.
3. `state: full` in the rule, criteria's predicate clause reworded ("returns
   a boolean answer like its siblings but is named with a command verb") --
   `gaps`: **works**, gap 0.46, head +0.43 at 0.7, suggest 0.5. `permissions`
   0.73, `product_source` 0.27. This is the shipped wording; attempts 4-5
   were repeat runs and corpus additions with it unchanged.

**Fit** (`records/attempt5-full-repeat3.json`, 19 modules, `--repeat 3`)

Fitted cutoff 0.51. Precision 1, recall 1 (tp 6 / fp 0 / fn 0). Defects
0.72-0.96, cleans 0.05-0.29, gap 0.43. Decision flips across the 3 passes: 0.
Max spread 0.05, mean 0.01. Headroom from the highest clean (0.29) to the
cutoff: 0.22; from the cutoff to the weakest defect (0.72): 0.21.

The weakest defect is the predicate-named-as-command case (0.72 on all three
passes), and the highest clean is the sync-cache/async-network case (0.29).
Those two are where a real file will land first.

**Verdict**: **SHIP** -- separates with 0.22 headroom on both sides and no
flips over three passes, on a corpus whose hard cleans are the cases the
brief named (different words for different operations, conventional pairs,
one export). Caveat that keeps it from being a stronger claim: 19 synthetic
modules; the naming pack's own experience is that real code raises the clean
band, so the first real run should be read with `replay` headroom in mind.

**What I would change**: state. `full` is what makes the sync-vs-async
hard clean separable, and `full` is the arm that dies on a big file. The
fix belongs in the outline, not the rule: if `renderOutline` carried each
public function's signature line (`async`, parameters, return type), this
rule -- and the next one -- would work on `graph` at outline cost, on a
3000-line file. That is a `src/state.ts` change, out of scope here.

## sibling-deviates

**Rule** (the `noul` form; the `score` variant follows)

```yaml
- id: sibling-deviates
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  kind: noul
  subject: file
  state: full
  axis: file
  # NOT a calibrated cutoff: no cutoff separates on the corpus. 0.65 is the
  # best trade-off (precision 1, recall 0.86, headroom 0.03 over the highest
  # clean). See REPORT.md; the `score` form below is the recommended shape.
  at: 0.65
  rule:
    kind: program
  ask: >-
    Every public item of this module but one follows the same convention, and
    the one exception does the same kind of work as the rest.
  criteria:
    "true": >-
      Count the forms the public items take. All but one take the same form --
      the same kind of name (one shared prefix or suffix, or all
      question-shaped is/has/can names), the same parameter order, all async
      or all sync, the same way of reporting failure (returning a Result or
      null versus throwing) -- and the single remaining item does the same job
      as the others in a different form, with nothing in the code saying why.
    "false": >-
      The items take one form, with no exception; or they take three or more
      forms with no single exception (several verbs, several shapes: that is
      inconsistency across the module, not one deviant); or the exception is
      explained by the code: it is a helper the others call, a combinator over
      them, a different kind of thing from its siblings (a type, a factory, a
      placeholder), one of two internally consistent groups, or it carries a
      comment saying why it differs.
  note: >-
    A difference that follows from a genuinely different operation is not a
    deviation: a cache read has no reason to be async because its siblings
    hit the network. Judge whether the one item does the same job as its
    siblings in a different shape.
```

```yaml
- id: sibling-deviates-score
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  kind: score
  subject: file
  state: full
  axis: file
  # 2.5 reports only the signature-level deviants (2.77-2.87, confidence
  # ~0.8): precision 1, recall 0.57, headroom 0.14, 0 flips. The name-level
  # deviants and the "everyone differs" clean case share a band at 2.2-2.4
  # with confidence 0.2-0.35; `at: 2.0` with `unsureBelow: 0.5` reports that
  # band as questions instead.
  at: 2.5
  unsureBelow: 0.5
  rule:
    kind: program
  ask: >-
    One public item of this module differs in shape from all of its siblings,
    which agree with each other -- a different form of name, parameter order,
    async-ness or way of reporting failure -- while doing the same kind of
    work as they do.
  note: >-
    Not applicable when the module has one public item or its items do
    unrelated work. Satisfied when every item follows one shape; when the
    items differ from each other in several ways with no majority form (that
    is inconsistency, not one deviant); when the odd item is a helper the
    others call or a combinator over them; when the module holds two or more
    internally consistent groups; or when a comment beside the odd item says
    why it differs. Names that ask a question (is, has, can, should) count as
    one form. The more the deviating item's job matches its siblings' and the
    more of their shape it breaks, the stronger the violation.
```

**Corpus**

19 subjects found / 7 bad / 12 clean (of which 6 designed as hard cleans).

- `handlers.ts` -- bad: five `handle*` return `Promise<Result<T>>` and report
  failure with `err()`; `handleArchive` returns `Promise<Note>` and throws for
  the same not-found case.
- `project_files.ts` -- bad: four `read*` are async over `fs/promises`;
  `readSchema` does the same read with `readFileSync`, no reason given.
- `commands.ts` -- bad: four commands take `(ctx, input)`; `runExport` takes
  `(input, ctx)`.
- `auth_routes.ts` -- bad: four `*Handler` express handlers and one
  `handleSignup`.
- `notifications.ts` -- bad: three `send*` and one `dispatchPush` with the
  same signature and job.
- `lookups.ts` -- bad: four `get*` and one `loadInvoice`.
- `permissions.ts` -- bad: four question-shaped predicates (`is`/`has`/`can`)
  and one `checkAdmin` doing the same work.

Hard cleans: `validators.ts` (`fail()` differs in shape from five
`validate*` but every one of them calls it); `middleware.ts` (`compose` is a
combinator over the five `(req, res, next)` middlewares); `sync.ts` (three
sync `diff*` returning `Change[]`, three async `push*` returning
`PushReport` -- two groups, no deviant); `jobs.ts` (`noopJob` is the only
sync item and the comment above it says why); `product_source.ts`
(`getProduct` is the only sync item because it reads a cache while its
siblings hit the network); `preferences.ts` (two pairs at two layers plus a
factory). Plus the naming rule's "everyone differs" files (`settings`,
`factories`, `user_repository`), labelled clean here because four verbs
across five items is inconsistency, not one deviant.

**Attempts**

1. `state: graph`, "Exactly one public item ... breaks a pattern that every
   other public item follows" -- `gaps`: **rewrite**, gap 0.13, head +0.08.
   Only the name-level deviants were found (`notifications` 0.83,
   `auth_routes` 0.75); the signature-level ones sat at 0.13-0.44
   (`commands` 0.13, `handlers` 0.19) because the outline cannot show a
   parameter order, an `async`, or a throw. `settings` (clean) 0.58. Fit:
   precision 0.67 recall 0.67.
2. Same wording, `--arm full` -- `gaps`: **rewrite**, gap 0.14, head +0.03.
   Signature-level deviants now 0.74-0.87; `settings` 0.67, `user_repository`
   0.53 (both clean, "everyone differs"); `permissions` 0.37. Fit: 0.73,
   precision 1 recall 0.83. Same +20% token cost as above.
3. `state: full`, reworded to "differs in shape from all of its siblings,
   which agree with each other", with the "several ways at once, no majority
   form" clause added to `false` -- `gaps`: **move**, gap 0.25, head +0.04.
   The clause worked on `user_repository` (0.53 -> 0.24) and `factories`
   (0.44 -> 0.35) but not on `settings` (0.60), and it pulled the name-level
   deviants down (`notifications` 0.66, `auth_routes` 0.63) because "shape"
   reads as signature. Fit: 0.63, precision 1 recall 0.83.
4. (3-pass repeat of attempt 3 alongside the new `score` variant.) noul: 0
   flips, fit 0.62, precision 1 recall 0.67 (`permissions` 0.29,
   `auth_routes`/`notifications` 0.62 on the line). score: fit 2.22,
   precision 0.86 recall 1; signature-level deviants 2.78-2.86 with
   confidence ~0.8, name-level deviants and `settings` 2.22-2.32 with
   confidence 0.2-0.33, cleans <= 1.83.
5. Third and last wording, "Every public item of this module but one follows
   the same convention, and the one exception does the same kind of work as
   the rest", criteria opening with "Count the forms" -- `gaps`: **rewrite**,
   gap 0.21, head +0.11 (at 0.7). Name-level deviants recovered
   (`lookups` 0.92, `notifications` 0.89, `auth_routes` 0.71); `settings`
   still 0.59; `permissions` still 0.38. This is the wording in rules.yml.

**Fit** (`records/attempt5-full-repeat3.json`, `--repeat 3`)

noul form: no separating cutoff. The tool's best trade-off is 0.38
(precision 0.88, recall 1, fp `settings`). At 0.65, the value written into
rules.yml: precision 1, recall 0.86 (tp 6 / fp 0 / fn 1, the miss is
`permissions` at 0.38), headroom 0.06 over `settings` (0.59; its passes
reach 0.62, so 0.03). Flips across 3 passes: 1 at the uncalibrated 0.7
(`auth_routes` 0.68-0.73), 0 at 0.65. Max spread 0.07.

score form at 2.5: precision 1, recall 0.57 (tp 4 / fp 0 / fn 3: the three
name-level deviants at 2.22-2.33). Headroom 0.14 over the highest clean
(`settings` 2.26, peak pass 2.34) and 0.27 under the weakest reported
defect (`lookups` 2.77). Flips: 0. Max spread 0.22 (`settings`).

Does the ordering help? Yes, in the one way that matters: it puts the
defects the noul agrees on (signature, async-ness, failure mode; 2.79-2.87,
confidence ~0.8) in a band of their own, and puts the name-level deviants
in the same band as the one clean file the noul cannot get rid of
(`settings`), *with a confidence of 0.2-0.35 that says so*. The noul returns
0.59 for `settings` and 0.62-0.71 for `auth_routes` with nothing to tell
them apart. With `at: 2.0` and `unsureBelow: 0.5` the score form reports
the clear band as findings and the 2.2 band as questions -- the "route the
wobble to a person" case from calibration.md. The name-level band is also
exactly the naming rule's territory (`notifications` 0.93, `lookups` 0.94,
`permissions` 0.72 there), so in a pack the two rules cover it between them.

**Verdict**: **COOKBOOK** -- the noul does not separate after three
wordings (the "everyone differs" clean at 0.59 and the question-shaped
predicate family at 0.38 stay on the wrong side of any cutoff); the score
form separates the signature-level class with 0.14 headroom and no flips,
but at 4 labelled defects in that class and a name-level band it can only
flag as uncertain, that is a recipe with a stated scope, not a shipped
cutoff.

**What I would change**: two things. (1) Scope: split the class. Signature
and failure-mode deviation is a different defect from name deviation, and
the corpus shows the model already treats them differently; a rule that
asks only "one item does its siblings' job in a different signature or
failure mode" is the shippable half, and name deviation is
`module-naming-consistent`'s. (2) State, as above: signatures in the
outline would let the shippable half run on `graph`. The corpus should
also gain a few mid-degree cases -- two deviants among six, a deviant that
is *also* the odd operation -- because those are what a real repository
will send first.

## Cost

From the tool's own summaries, all runs (one unrecorded `gaps`, three
1-pass `calibrate`, two 3-pass `calibrate`):

- requests: 176 (17 + 17 + 17 + 17 + 3x17 + 3x19)
- input tokens: ~417k (29,562 + 29,562 + 34,733 + 35,838 + 3x45,526 +
  3x50,300); output tokens ~9.6k
- dollars: $0.0175 ($0.00124 + $0.00124 + $0.00146 + $0.00151 + $0.00574 +
  $0.00634), model jev-1.13.0
