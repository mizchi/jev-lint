# Family G: paired contracts

A module that defines both halves of a round trip -- `serialize*`/`parse*`,
`encode*`/`decode*`, `toJSON`/`fromJSON`, `pack*`/`unpack*`, `toRow`/`fromRow`,
`write*`/`read*` -- has declared a contract about itself that nothing checks:
the reader reads back what the writer wrote, under the same keys, in the same
units, against the same literals. The type checker cannot see it because both
halves pass through `JSON.parse`, `Record<string, unknown>` or a string; a
test only catches it when someone thought to round-trip; ast-grep can find the
writer by name but cannot say whether `exp: expiresAt.getTime()` and
`new Date(payload.exp * 1000)` are inverses. Jev holds the two bodies in mind
at once, which is the one thing the model is measured to be good threshold: two
pieces of code that contradict a contract they declare about each other. The
matcher over-matches one half (the writer, by name regex) with
`state: located` so the other half is in the state, and the criteria say what
to do when there is no other half.

One candidate: `serializer-parser-agree`. Candidate directory
`experiments/rule-candidates/serializer-parser-agree/`; records are the
eval's own `evals/baseline.json` (accepted) and `evals/last.json`. No Rust
variant: it was a bonus, and the TypeScript rule did not earn SHIP.

Tooling note, repeated from Family B: `gaps` ignores `--record` (only
`check`, `calibrate` and `eval` write one), so per-subject answers below come
from `eval --repeat 3`'s `last.json` after each attempt, and each attempt's
`gaps` line is quoted from its own output.

---

## serializer-parser-agree

### Rule

```yaml
- id: serializer-parser-agree
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  kind: noul
  subject: node
  # `located`: the counterpart is elsewhere in the file, never inside the
  # matched node, so `bare` and `local` cannot contain the answer.
  state: located
  # 0.40, fitted 2026-09-20 on this rule's evals (7 defects, 9 cleans of which
  # 6 hard, 3 passes, evals/baseline.json): clean tops at 0.31 (readPrefsFile,
  # an alias-tolerant reader), defects start at 0.51 (toUserRow, display_name
  # written and displayName read) then 0.60 (writeConfigFile, proxy emitted
  # conditionally and required on read); the other five sit at 0.84-0.97.
  # Midpoint 0.41; set just under it so the weakest defect keeps its side.
  # Gap 0.20 on means, 0.15 on single passes -- narrow, and the two weakest
  # defects moved by 0.3-0.6 between phrasings of the question, which is why
  # this is a cookbook recipe and not a shipped cutoff. See
  # experiments/reports/g-paired-contracts/REPORT.md.
  threshold: 0.40
  rule:
    any:
      - all:
          - kind: function_declaration
          - has: &writer_name
              field: name
              pattern: $NAME
              # The writer side of every conventional pair. `to[A-Z]` also
              # catches toString and toCacheKey; those have no reader and the
              # "false" branch says so, which is cheaper than a tighter regex
              # that misses a toRow.
              regex: "^(serialize|serialise|encode|stringify|marshal|pack|write|dump|to[A-Z])([A-Za-z0-9_]|$)"
      - all:
          - kind: method_definition
          - has: *writer_name
      - all:
          - kind: variable_declarator
          - has: *writer_name
          - has:
              field: value
              any:
                - kind: arrow_function
                - kind: function_expression
      # `const codec = { encode: (p) => ..., decode: (s) => ... }`
      - all:
          - kind: pair
          - has:
              field: key
              pattern: $NAME
              regex: "^(serialize|serialise|encode|stringify|marshal|pack|write|dump|to[A-Z])([A-Za-z0-9_]|$)"
          - has:
              field: value
              any:
                - kind: arrow_function
                - kind: function_expression
  ask: >-
    Passing what $NAME produces to the function in this file that reads it
    back would not give back the value $NAME was given: a field comes back
    under a different key, in a different unit or encoding, or the reader
    rejects a value the writer legitimately produces.
  criteria:
    "true": >-
      Trace one value through $NAME and then through its counterpart in this
      file -- the parse, decode, from, unpack, read or unmarshal function for
      the same format, even when a file, a database row, a queue or a cookie
      sits between the two -- and the round trip fails: the reader looks a
      field up in the record under a key the writer never put there, so it
      comes back undefined; the reader applies a scale, format or decoding
      that is not the inverse of what the writer applied, so a number or date
      comes back a different quantity (getTime() milliseconds read with a
      `* 1000` that assumes seconds, an ISO string read as a number, hex
      decoded as base64); the reader throws, asserts or dereferences without a
      fallback a field the writer never emits or emits only inside a
      condition; or the reader compares a version or type tag against a
      literal other than the one the writer wrote.
    "false": >-
      The file has no function that reads back what $NAME produces, so no
      round trip exists here to fail; or the round trip gives back what the
      writer was given for everything the writer can produce. Renaming across
      the trip is fine when the key the reader looks up is the key the writer
      wrote, whatever property it is then assigned to; seconds written with
      `/ 1000` and read with `* 1000` is a correct inverse; a reader that also
      tolerates a missing field with a default, accepts an older spelling as
      an alias, handles an older version in its own branch, or ignores or
      recomputes a field the writer emits is agreeing with the writer, not
      contradicting it; and a reader that nests what the writer flattened
      is fine when every field maps across.
  note: >-
    The counterpart is the function in this file that consumes the format
    $NAME produces; a store or a wire between them does not put it out of
    scope, and its name need not mirror $NAME's. A writer with no such
    counterpart in this file is not a violation, and a writer whose only
    reader is a library codec agrees with it by construction. Judge the two
    bodies, not the declared types: the disagreement to find is one the type
    checker cannot see because both halves pass through a string or an
    untyped record.
```

### Corpus

16 subjects found / 7 bad / 9 clean (6 hard, 3 plain). Eight files, one JS,
two subjects each, both halves of every pair in the same file. Every writer
the matcher found was intended; captures hold the bare name (`toJSON`,
`encode` on an object-literal codec included).

- `session-cookie.ts:15 encodeSessionCookie` -- writes `exp` as
  `getTime()` (epoch ms); `decodeSessionCookie` reads `new Date(exp * 1000)`
  (seconds). Every cookie expires a thousand times too late.
- `cache-entry.ts:11 serializeCacheEntry` -- writes `v: FORMAT_VERSION` (2);
  `parseCacheEntry` throws unless `v === 1`. Version tag written as one
  literal, checked against another.
- `cli-config.ts:12 writeConfigFile` -- emits `proxy` only `if (cfg.proxy)`;
  `readConfigFile` throws `proxy missing` unless it is a string. Optional on
  write, required on read.
- `queue-message.ts:8 packJobMessage` -- writes `type: "job.run"`;
  `unpackJobMessage` rejects anything but `"run-job"`.
- `user-row.ts:15 toUserRow` -- writes `display_name`; `fromUserRow` reads
  `row.displayName`. Three of four fields agree.
- `api-key.ts:10 encodeApiKey` -- secret written as hex; `decodeApiKey` reads
  it with `Buffer.from(secret, "base64")`.
- `audit-event.ts:9 marshalEvent` -- `unmarshalEvent` throws unless
  `wire.actor` is a string; the writer never emits an `actor`.

Hard cleans: `encodeCsrfToken` (no reader in the file, beside a pair that does
disagree), `writePrefsFile` (reader takes MORE: defaults, a `lang` alias,
missing-file fallback), `packRetryMessage` (v1 handled in a migration branch
that mentions seconds and milliseconds), `toAddressRow` (writer flattens
`street.line1` to `street_line1`, renames `postalCode` to `postal_code`,
reader nests and renames back -- a lazy casing rule flags it),
`packRefreshToken` (`/ 1000` on write, `* 1000` on read: the same surface as
the cookie defect, correct here), `Snapshot.toJSON` (emits a `checksum` the
reader deliberately drops with a comment and a rest destructure). Plain
cleans: `stringifyTags`/`parseTags`, `serializeHeaders`/`parseHeaders`,
`pointCodec.encode`/`decode`.

### Attempts

1. Ask "This function ($NAME) writes out a value, and the function in the
   same file that reads that value back disagrees with it about what was
   written"; criteria list key/unit/required/tag mismatches; note "a reader
   in another module is out of scope". `gaps`: **works**, gap 0.29, head
   +0.12 at 0.70, median 0.19. Eval at 0.70: P 1.00, R 0.57 (tp 4, fp 0,
   fn 3), fitted 0.23. The four literal defects (tag, version, encoding,
   missing field) answer 0.89-0.96; the three that need a step of reasoning
   sit in the clean band -- `writeConfigFile` 0.54, `encodeSessionCookie`
   0.44, `toUserRow` 0.25 -- against a top clean of 0.20. The sentence let
   "reads that value back" exclude a reader with a store or wire between it
   and the writer, and never asked for a field-by-field walk.
2. Ask "reads at least one field differently from how $NAME writes it: under
   a different key, in a different unit or encoding, against a different
   literal, or as required when the writer does not always emit it";
   criteria open with "compare, field by field ... even when a file, a
   database row, a queue or a cookie sits between the two", add "snake_case
   on one side and camelCase on the other counts" and the `getTime()` /
   `* 1000` example; note adds "judge the two bodies, not the declared
   types". `gaps`: **works**, gap 0.28, head +0.21 at 0.70, median 0.49.
   Eval at 0.70: P 1.00, R 0.86 (tp 6, fp 0, fn 1), fitted 0.57 with P 1 R 1.
   `toUserRow` 0.25 -> 0.87, `writeConfigFile` 0.54 -> 0.78,
   `encodeSessionCookie` 0.44 -> 0.65; but the casing clause dragged the
   correct flatten/rename `toAddressRow` from 0.10 to 0.48 and the
   alias-tolerant `readPrefsFile` from 0.20 to 0.46. Gap 0.17 on means,
   headroom 0.08 a side.
3. Ask as round-trip fidelity: "Passing what $NAME produces to the function
   in this file that reads it back would not give back the value $NAME was
   given"; criteria "trace one value through $NAME and then through its
   counterpart ... the reader looks a field up under a key the writer never
   put there, so it comes back undefined"; false branch "renaming across the
   trip is fine when the key the reader looks up is the key the writer
   wrote, whatever property it is then assigned to". `gaps`: **move**, gap
   0.28, head +0.12 at 0.70, suggest 0.41, median 0.25. Eval at 0.70: P 1.00,
   R 0.71 (tp 5, fp 0, fn 2), fitted 0.39 with P 1 R 1. Cleans fell back
   (`toAddressRow` 0.21, `readPrefsFile` 0.29, top clean), the cookie defect
   rose to 0.83, but `toUserRow` fell to 0.48 and `writeConfigFile` to 0.59.
   Widest gap of the three on means (0.19) and the lowest clean band; taken.

### Fit

`evals/baseline.json`, 3 passes at the taken sentence (attempt 3). Cutoff
**0.40** (midpoint 0.41; set just under it so the weakest defect keeps its
side, and because the clean band is what real code is made of). Precision
1.00, recall 1.00 (tp 7, fp 0, fn 0). Decision flips across the 3 passes: 0.
Max spread 0.10 (`writeConfigFile` 0.56-0.66). Per subject, means: defects
0.97, 0.97, 0.94, 0.93, 0.84, 0.60, 0.51; cleans 0.31, 0.21, 0.20, 0.20,
0.15, 0.13, 0.13, 0.09, 0.09. Headroom on means: 0.09 above the top clean
(`readPrefsFile` 0.31), 0.11 below the lowest defect (`toUserRow` 0.51). On
single passes the band is 0.33 to 0.48: 0.07 and 0.08. `eval --replay`
against the accepted baseline: same decisions.

### Verdict

**COOKBOOK.** The rule separates on the corpus with precision 1, recall 1 and
no flips, but the headroom is under 0.10 (0.09 on means, 0.07 on single
passes) and the two weakest defects moved 0.25 -> 0.87 -> 0.51 (`toUserRow`)
and 0.54 -> 0.78 -> 0.60 (`writeConfigFile`) across three phrasings of the
same question, so the cutoff belongs to this wording and this corpus, not to
the rule. The literal-versus-literal defects (tag, version, encoding, absent
field) are found at 0.84-0.97 by every phrasing and are worth a recipe; the
one-step-of-reasoning defects (a key looked up under another casing, a field
optional on one side and required on the other) are what keep it from
shipping.

### What I would change

- **Corpus**: it is at the BRIEF's minimum for hard cleans and the weak
  class has one specimen each. Add two more casing-mismatch defects and two
  more conditional-emit defects, and two more clean flatten/rename readers,
  before believing any cutoff -- the current 0.51 for `toUserRow` is one
  subject. Also an unseen-code run over a real repository's `codec.ts` /
  `serializers.ts` files, where every subject is clean and the top clean
  answer is the number that matters.
- **Sentence**: attempt 2's "snake_case on one side and camelCase on the
  other counts" lifted `toUserRow` to 0.87 but cost 0.28-0.38 on the two
  cleans that rename correctly; attempt 3's "the key the reader looks up,
  whatever property it is then assigned to" fixed the cleans but lost half
  of that. A fourth attempt would keep attempt 3 and add one sentence to the
  true branch that names the lookup specifically: "the property name in
  `row.x` / `obj["x"]` on the reader side is not one the writer's object
  literal contains". Not tried: the BRIEF allows three.
- **Matcher**: as intended; nothing unintended fired. `to[A-Z]` will catch
  `toString` on real code and the false branch handles it, at a subject's
  cost each. If that proves noisy, exclude `toString` in the regex.
- **Subject/state**: `node` + `located` is right; `gaps` never said
  `rewrite`, and the counterpart is never inside the matched node, so
  `enclosing`/`local` cannot help. `bare` is a certain miss.
- **Rust**: not attempted (bonus only if cheap; it was not, given the TS
  result). Would be `impl_item` with `has: { kind: function_item, has:
  { field: name, regex: "^(serialize|to_bytes|encode|write)" } }` sharing
  the sentence by anchor.

---

## Cost

From the tool's own summaries. `gaps` x3: 8 requests each, $0.00070,
$0.00078 and ~$0.00086 (attempt 3's line was not captured; that is its
`--dry-run` price, which matched the paid price to $0.00003 on attempts 1
and 2), ~58,000 input tokens together. `eval --repeat 3` x4 (three attempts
plus `--accept`): 24 requests each, 50,172 + 55,980 + 57,372 + 57,372 =
220,896 input tokens, $0.00211 + $0.00235 + $0.00241 + $0.00241 = $0.00928.
Total: **120 requests, ~279,000 input tokens, ~$0.0116** of the $0.50
budget. Every paid run was preceded by a `check --dry-run` of the same
corpus and rule.
