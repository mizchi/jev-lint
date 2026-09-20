# Rules by Language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `rules/` by language (`typescript/`, `rust/`, `javascript/`), one rule per file with its fixtures and expectations beside it; then port the transferable families to Python and Go; then add a `git/` rule that checks a commit message against its diff.

**Architecture:** The loader learns one convention — a path matching `<lang>/<id>/rule.yml` under a rules root gives the rule a `languageDir` and constrains its grammars — and everything else (cache, batching, gate) is untouched. Evals discover `expect.yml` instead of `evals/labels.json`. Commits become a second source of subjects beside ast-grep, built by `src/commits.ts` from `git`, judged through the same batch → ask → gate path with a `subject: commit` rule.

**Tech Stack:** Node 20+ (`--experimental-strip-types`), ast-grep CLI, `yaml`, `node:child_process` for git. Tests: `test/test.ts` (`npm test`), `npm run typecheck`.

Spec: `docs/superpowers/specs/2026-09-20-rules-by-language-design.md`.

---

## Phase 1 — layout

### Task 1: The loader knows language directories

**Files:**
- Modify: `src/types.ts` (Rule gets `languageDir: string | null`; `LANGUAGE_DIRS` map; `TIER_ONE`)
- Modify: `src/rules.ts` (`loadRules`, `normalizeRule`, `cutoffFor`, duplicate check, drift warnings)
- Test: `test/test.ts`

- [x] **Step 1: Failing tests.** `rules: a rule under <lang>/<id>/rule.yml carries its language dir and may only name that dir's grammars` — write `typescript/a/rule.yml` with `languages: [TypeScript, Rust]` into a temp root, expect an error naming Rust; with `[TypeScript, Jsx]` expect `languageDir === "typescript"`. `rules: the same id under two language dirs is two rules, and differing sentences are a drift warning` — load `typescript/a` and `rust/a` with different `ask`, expect two rules and `warnings` containing `a`. `rules: cutoffFor prefers lang/id over id` — `cutoffFor(rule, {"rust/a": 0.9, a: 0.4})`.
- [x] **Step 2: Run** `npm test rules:` → fails.
- [x] **Step 3: Implement.** In `types.ts`: `LANGUAGE_DIRS: Record<string, Language[]> = { typescript: [TypeScript, Tsx, JavaScript, Jsx], javascript: [JavaScript, Jsx], rust: [Rust], python: [Python], go: [Go], git: [] }` plus a fallback `normalizeLanguage(dirName)` for any other name; `TIER_ONE = ["typescript", "rust"]`. In `rules.ts`: `loadRules` returns `{ rules, errors, warnings }`; when a file path ends `/<lang>/<id>/rule.yml` and `<lang>` is a known dir, set `languageDir`, require the document's `id` to equal `<id>`, and reject grammars outside the dir. Duplicate key is `${languageDir ?? ""}/${id}`. After loading, group by id across dirs and push a warning per id whose `ask`/`criteria`/`note`/`explain` differ (compare canonical JSON). `cutoffFor`: `overrides[`${rule.languageDir}/${rule.id}`] ?? overrides[rule.id] ?? rule.at ?? default`.
- [x] **Step 4: Run** `npm test` → green (existing callers of `loadRules` ignore `warnings`).
- [x] **Step 5:** `jev-lint rules` prints warnings; `--at` parsing accepts `lang/id=n`. Commit: `Loader: language directories, (lang, id) identity, drift warnings`.

### Task 2: Evals discover `expect.yml`

**Files:**
- Modify: `src/evals.ts` (`discoverEvals`, `loadSuite`, `relocateLabels`, suite naming)
- Modify: `src/types.ts` (`Labels` → keys `default`/`note`, keep `$default`/`$note` accepted on read)
- Test: `test/test.ts`

- [x] **Step 1: Failing test.** `evals: a suite is a rule.yml with expect.yml beside it, named lang/id, fixtures relative to the rule dir` — temp root with `typescript/a/{rule.yml,expect.yml,fixtures/x.ts}`; `discoverEvals(root)` returns one suite `{ name: "typescript/a", dir, fixtures: ".../fixtures", baseline: ".../baseline.json" }`; `loadSuite` re-keys `fixtures/x.ts` to the run path.
- [x] **Step 2:** fails. **Step 3:** implement; `expect.yml` parsed with `yaml`; `default:` and `note:` map to the existing `Labels` fields; an entry's `rule` is set to the suite's rule id so `labelFor` keeps working. **Step 4:** green. **Step 5:** commit `Evals: expect.yml beside the rule`.

### Task 3: Migration script and the move

**Files:**
- Create (temporary): `tools/migrate-rules-layout.ts`
- Move: everything under `rules/` and `experiments/rule-candidates/`
- Modify: `package.json` files, `.gitignore`, `experiments/BRIEF.md`, `experiments/IMPROVE.md`

- [x] **Step 1:** Write the script per spec §Migration (split documents → `<lang>/<id>/rule.yml` with anchors resolved via `doc.toJS` + `YAML.stringify`, keeping the leading `#` header lines of the file on the first document and each document's own leading comments; move cases by extension; write `expect.yml`; split `baseline.json` per rule id with paths rewritten `cases/` → `fixtures/` and the `-rust`/`-js` suffix stripped). Dry-run mode prints the plan.
- [x] **Step 2:** Run it. `git status` shows renames.
- [x] **Step 3: Acceptance.** `node --experimental-strip-types src/cli.ts eval --replay` → `24 suite(s), all as shipped`. `npm test` green (the "shipped pack loads" test, cookbook fixture test, and the shipped-rules count assertions updated). `node --experimental-strip-types src/cli.ts check --dry-run --cache none` → same subject count as before (2,655).
- [x] **Step 4:** Add test `rules: every tier-one shipped rule has fixtures, expect.yml and a baseline`.
- [x] **Step 5:** Delete the script. Commit `Rules by language: typescript/, rust/, javascript/`.

### Task 4: Docs

- [x] README (layout block, rule table headings per language, tiers paragraph), `docs/reference.md` (Layout, Rule fields `languageDir`, The shipped packs, Calibrating), `rules/README.md`, `skills/jev-lint/SKILL.md`, `references/{rule-fields,using-shipped-rules,calibration,cookbook}.md`, `commands/new-rule.md`. Commit `Docs: rules by language`.

## Phase 2 — Python and Go

### Task 5: `paired` recognises Python and Go tests

- [x] Failing test: `isTestFile("tests/test_cart.py")`, `isTestFile("pkg/cart_test.go")`, `relatedTestFiles("pkg/cart.py", ["tests/test_cart.py"])` pairs (`test_` prefix strips to `cart`). Implement in `src/paired.ts` (`TEST_NAME` gains `^test_`, `names()` strips a leading `test_`). Commit.

### Task 6: Port the families (subagents, one per language)

> Done: Python 11 of 12 shipped, Go 9 of 13; the rest are candidates with reports. Shipped rules are second tier (calibrated, not promised).

- [x] Dispatch two subagents with `experiments/BRIEF.md`, each producing `experiments/rule-candidates/<python|go>/<id>/` for the transferable families listed in spec §Phase 2, with fixtures, `expect.yml`, calibrated `at:`, baseline, and a report under `experiments/reports/i-python/` and `experiments/reports/j-go/`. Budget $1.00 per language. Node kinds per spec.
- [x] Integrate: `git mv` each SHIP/COOKBOOK candidate to `rules/<lang>/<id>/`; `eval --replay` green; docs list them as tier two. Commit per language.

## Phase 3 — commits

### Task 7: `subject: commit` rules load

**Files:** `src/types.ts` (SUBJECTS += "commit", `LANGUAGES` += "Git"), `src/rules.ts` (rule optional when subject is commit; `Git` only under `git/` with `subject: commit`; every other subject requires `rule`), `src/scan.ts` (skip commit rules in `runAstGrep`/`emitRuleFile`).

- [x] Failing test `rules: a commit rule has no matcher and only the Git grammar`; implement; commit.

### Task 8: `src/commits.ts` builds subjects from git

**Files:** Create `src/commits.ts`; test with a temp repo made by `git init` + two commits.

- [x] `listCommits(range, cwd): Array<{sha, subject, message, isMerge}>` via `git log --format=%H%x00%P%x00%B%x1e range`. `commitDiff(sha, cwd, budgetChars): {files: string[], diff: string, truncated: boolean}` via `git show --format= --no-color --stat` and `git show --format= --no-color`; over budget, keep stat + hunks up to budget and set `truncated`. `commitSubjects(rules, range, cwd): { subjects: Subject[], skippedMerges: number }` — one subject per (commit, commit-rule): `text = message`, `file = sha`, `line = 1`, `nodeKind = "commit"`, `captured = { SUBJECT: subjectLine }`, `arm = "bare"`, and a new `Subject.commit?: { files, diff, truncated }` carried to the state.
- [x] `buildState` for a batch whose subjects carry `commit`: `{ reviewing: "one commit", message, files, diff, note_on_diff? }`; batching is one subject per batch (each commit is its own state). Planner: `planBatches` groups by `file` (= sha) already, arm `bare`; add the commit sections in `buildState` when `subjects[0].commit` is set.
- [x] Cache key: `verdictKey(rule, arm, text=message + "\n" + diff, …)` — pass `text` as message+diff so an amended message re-asks.

### Task 9: `jev-lint commits` command

**Files:** `src/cli.ts` (command, `--base`, positional range, usage), `src/run.ts` (`run` accepts `commits: { range, cwd }` and uses `commitSubjects` in place of `collectSubjects` when the rule set has commit rules and a range was given), `src/report.ts` (a finding whose `file` is a sha prints `sha[:8]  "subject line"`).

- [x] Failing test with a fake client: two commits, the fake answers 0.9 for one; `run({ rules:[commitRule], commits:{range:"A..B", cwd} })` reports one finding at `sha:1` and `formatPretty` shows the subject line. Implement. `jev-lint commits --dry-run` prints the commits and the price.

### Task 10: The rule and its corpus

> Done with one change: fixtures are `fixtures/<case>/{message, before/, after/}`, not `.patch` files (see the spec's Phase 3 note). The corpus is sixteen cases, `at: 0.65`.

- [x] `rules/git/commit-message-describes-diff/rule.yml` per spec; `fixtures/*.patch` (≥ 8: message claims a fix, diff adds a feature; "no behaviour change" over a changed default; "remove X" that leaves X; a rename described as a rewrite; hard cleans: terse subject over a large but faithful diff, an "also" body, a mechanical rename, a revert), `expect.yml` at line 1 per patch, `eval` runs commits by feeding each `.patch` through `git am` into a temp repo — implement `evalCorpus` support: when a suite's rule is `subject: commit`, the runner builds a temp repo from the fixtures in order and judges `HEAD~N..HEAD`. Calibrate with `eval --repeat 3 --accept`. Commit.

### Task 11: Hook and docs

- [x] `jev-lint init` hook template gains a commented `pre-push` line running `jev-lint commits @{upstream}..HEAD`. README section "Commits", reference command row, SKILL.md "Which task is this?" row. Commit.
