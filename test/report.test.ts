import { strict as assert } from "node:assert";
import { decide, gate } from "../src/gate.ts";
import { formatGithub, formatJson, formatPretty, silentRules, idleLanguages } from "../src/report.ts";
import type { Finding, Rule, Subject } from "../src/types.ts";
import { scoreRule, noulRule, subjectOf, answer } from "./builders.ts";
import { test } from "./harness.ts";

/**
 * A reported `subject: change` finding, the way `attributeFindings` in
 * `src/run.ts` actually leaves one: `decide` for the verdict, `violates`
 * bolted on after, the same order the real pass writes them in (it sets
 * `finding.violates` once the request comes back, never through `decide`
 * itself).
 */
function changeFinding(violates: NonNullable<Finding["violates"]>): Finding {
  const rule = noulRule({
    id: "diff-follows-instructions",
    language: "Git",
    subject: "change",
    ask: "the diff breaks an instruction the documents give",
    criteria: { true: "it does", false: "it does not" },
    rule: undefined,
  });
  const subject = subjectOf({
    rule,
    file: "deadbeef00deadbeef00deadbeef00deadbeef0",
    line: 1,
    endLine: 1,
    text: "cart.ts | 4 ++--",
    commit: { files: ["cart.ts"], stat: "cart.ts | 4 ++--", diff: "diff --git a/cart.ts b/cart.ts", truncated: false },
    captured: { SUBJECT: "cart.ts | 4 ++--" },
  });
  const finding = decide(subject, { value: 0.9, confidence: null, kind: "noul" });
  finding.violates = violates;
  return finding;
}

test("report: a language with no files is one idle line, not a list of dead matchers", () => {
  const ts = { ...scoreRule({ id: "a" }), languageDir: "typescript" };
  const tsSilent = { ...scoreRule({ id: "b" }), languageDir: "typescript" };
  const py1 = { ...scoreRule({ id: "a", language: "Python", rule: { kind: "x" } }), languageDir: "python" };
  const py2 = { ...scoreRule({ id: "b", language: "Python", rule: { kind: "x" } }), languageDir: "python" };
  const result = { rules: [ts, tsSilent, py1, py2], subjects: [subjectOf({ rule: ts })] };
  assert.deepEqual(idleLanguages(result), [{ language: "python", rules: 2 }]);
  assert.deepEqual(silentRules(result), ["typescript/b"], "the TypeScript matcher that missed is still named; Python is idle, not silent");
  const pretty = formatPretty({ ...result, findings: [], all: [], review: [], stats: { subjects: 1, reported: 0, missing: 0, unsure: 0, review: 0, byRule: {}, byFile: {} } }, { color: false });
  assert.match(pretty, /no files for python \(2 rules\)/);
  assert.match(pretty, /1 rule\(s\) matched nothing: typescript\/b/);
});

test("report: a language whose parser nobody declared is not reported as having no files", () => {
  // Found on the published package: a directory with an `a.mbt` in it and no
  // `languages:` printed `no files for moonbit (20)`. The files were right
  // there. They produced no subjects because the rules were dropped before
  // the scan, which is what `idleLanguages` counts, and the true sentence is
  // the notice underneath. Two lines that contradict each other teach a
  // reader to believe neither.
  const ts = { ...scoreRule({ id: "a" }), languageDir: "typescript" };
  const mbt = { ...scoreRule({ id: "a", language: "moonbit", rule: { kind: "x" } }), languageDir: "moonbit" };
  const result = {
    rules: [ts, mbt],
    subjects: [subjectOf({ rule: ts })],
    undeclared: ["moonbit"],
    findings: [],
    all: [],
    review: [],
    stats: { subjects: 1, reported: 0, missing: 0, unsure: 0, review: 0, byRule: {}, byFile: {} },
  };
  const pretty = formatPretty(result, { color: false });
  assert.ok(!/no files for/.test(pretty), `moonbit is the only idle language and must not be called fileless:\n${pretty}`);
  assert.match(pretty, /moonbit: no parser declared/);
  assert.match(pretty, /docs\/reference\.md#a-language-ast-grep-does-not-have-built-in/);
  // And it is still off duty rather than a matcher that missed.
  assert.deepEqual(silentRules(result), []);
});

test("report: a finding that did not reproduce in every pass says so", () => {
  // The whole point of --retry. A finding the mean reports but only some passes
  // did is the case the calibration discipline says to route to a person, so it
  // cannot look identical to one that reproduced three times out of three.
  const rule = noulRule({ id: "n", at: 0.6 });
  const stable = decide(subjectOf({ rule, file: "a.ts", line: 1 }), {
    value: 0.9,
    confidence: null,
    kind: "noul",
  });
  stable.passes = { over: 3, of: 3, spread: 0.01 };
  const flaky = decide(subjectOf({ rule, file: "a.ts", line: 2 }), {
    value: 0.62,
    confidence: null,
    kind: "noul",
  });
  flaky.passes = { over: 1, of: 3, spread: 0.24 };

  const text = formatPretty(
    { findings: [stable, flaky], all: [stable, flaky], stats: gate([]).stats, retry: 3 } as never,
    { color: false },
  );
  assert.match(text, /3\/3 passes/);
  assert.match(text, /1\/3 passes/);
  assert.match(text, /did not reproduce in every pass \(spread 0\.24\)/);
  assert.equal(
    (text.match(/did not reproduce/g) ?? []).length,
    1,
    "only the one that actually flickered",
  );
});

test("report: a suppression is reported, and so is one naming a missing rule", () => {
  // A suppression removes a subject before it is asked about, so nothing else
  // in the output would show that a rule had been quieted.
  const text = formatPretty(
    {
      findings: [],
      all: [],
      stats: gate([]).stats,
      ignored: { subjects: 4, files: ["b.ts"], unknownRules: ["fn-name-promisez"] },
    } as never,
    { color: false },
  );
  assert.match(text, /4 subject\(s\) skipped by jev-lint-ignore comments/);
  assert.match(text, /1 file\(s\) suppressed whole: b\.ts/);
  assert.match(text, /name a rule that does not exist: fn-name-promisez/);
  assert.match(text, /suppress nothing/);
});

test("report: rules that produced no subject are listed", () => {
  const fired = scoreRule({ id: "fired" });
  const quiet = scoreRule({ id: "quiet" });
  const result = { rules: [fired, quiet], subjects: [{ rule: fired } as Subject] };
  assert.deepEqual(silentRules(result), ["quiet"]);
});

test("report: github annotations escape newlines and never use error by default", () => {
  const rule = scoreRule({ at: 2 });
  const g = gate([
    {
      subject: subjectOf({ rule }),
      answer: { value: 2.9, confidence: 0.9, kind: "score" },
    },
  ]);
  const text = formatGithub({ ...g, rules: [rule] });
  assert.match(text, /^::warning file=a\.ts,line=3,endLine=5/);
  assert.ok(!text.includes("\n::error"));

  const multiline = formatGithub({
    ...gate([
      {
        subject: subjectOf({ rule: scoreRule({ at: 2, message: "line one\nline two" }) }),
        answer: { value: 2.9, confidence: 0.9, kind: "score" },
      },
    ]),
    rules: [],
  });
  assert.ok(!multiline.slice(2).includes("\n"), "a message newline must be escaped");
  assert.match(multiline, /%0A/);
});

test("report: an incomplete run says so in every format", () => {
  const g = gate([{ subject: subjectOf(), answer: null }]);
  const result = { ...g, rules: [] as Rule[], subjects: [] as Subject[], elapsedMs: 1 };
  assert.match(formatGithub(result), /this run is incomplete/);
  assert.equal(JSON.parse(formatJson(result)).stats.missing, 1);
  // The third format. This assertion was missing, and jev-lint's own
  // `test-name-matches-body` flagged the title's "every format" against a body
  // that checked two of three (0.64 against a 0.69 cutoff -- under it, but for
  // a correct reason).
  assert.match(
    formatPretty(result, { color: false, showMissing: true }),
    /without a verdict|no verdict/,
  );
});

test("report: severity error is honoured when a rule has earned it", () => {
  const rule = scoreRule({ at: 2, severity: "error" });
  const g = gate([
    { subject: subjectOf({ rule }), answer: { value: 2.9, confidence: 0.9, kind: "score" } },
  ]);
  assert.match(formatGithub({ ...g, rules: [rule] }), /^::error /);
});

test("report: a git rule off duty in file mode is not a matcher that missed", () => {
  // `N rule(s) matched nothing` is the one place a dead matcher is visible,
  // which only holds if nothing else lands in that list. A `subject: commit`
  // rule was already excluded from a file-mode run; `subject: change` was
  // added beside it and inherited none of that, so an idle change rule was
  // reported as having matched nothing when it simply had no files to look
  // at (there is no such thing as a file for a git subject).
  const change = scoreRule({ id: "r-change", language: "Git", subject: "change", kind: "noul", ask: "a", criteria: { true: "y", false: "n" }, rule: undefined });
  const commit = scoreRule({ id: "r-commit", language: "Git", subject: "commit", kind: "noul", ask: "a", criteria: { true: "y", false: "n" }, rule: undefined });
  const empty = { rules: [change, commit], subjects: [], all: [], findings: [], review: [], stats: { subjects: 0, reported: 0, missing: 0, unsure: 0, review: 0, byRule: {}, byFile: {} } };
  assert.deepEqual(silentRules(empty), [], "neither is on duty in a file-mode run: `commits` is absent");
});

test("report: a change rule over an empty range found no commits, which is a fact about the range and about neither rule", () => {
  const change = scoreRule({ id: "r-change", language: "Git", subject: "change", kind: "noul", ask: "a", criteria: { true: "y", false: "n" }, rule: undefined });
  const commit = scoreRule({ id: "r-commit", language: "Git", subject: "commit", kind: "noul", ask: "a", criteria: { true: "y", false: "n" }, rule: undefined });
  const empty = { rules: [change, commit], subjects: [], all: [], findings: [], review: [], stats: { subjects: 0, reported: 0, missing: 0, unsure: 0, review: 0, byRule: {}, byFile: {} } };
  assert.deepEqual(
    silentRules({ ...empty, commits: { range: "HEAD", total: 0, skippedMerges: 0, noInstructionDoc: 0 } }),
    [],
    "commits.total === 0 already short-circuits before either rule is even considered",
  );
});

test("report: a change rule with real commits but no AGENTS.md or CLAUDE.md anywhere in them is off duty, not silent -- unlike a commit rule with the same zero subjects", () => {
  // Distinct from the empty-range case above: here `commits.total` is 1, not
  // 0, and `noInstructionDoc` accounts for the whole of it. Before this
  // test the two reasons for a change rule finding nothing -- no commits at
  // all, and commits but no standard to judge them against -- were
  // indistinguishable downstream: both read as "the change rule matched
  // nothing", which is a sentence a change rule cannot earn (it has no
  // matcher). The commit rule here has no such excuse: nothing about
  // `noInstructionDoc` explains why it found nothing, so it is still
  // reported.
  const change = scoreRule({ id: "r-change", language: "Git", subject: "change", kind: "noul", ask: "a", criteria: { true: "y", false: "n" }, rule: undefined });
  const commit = scoreRule({ id: "r-commit", language: "Git", subject: "commit", kind: "noul", ask: "a", criteria: { true: "y", false: "n" }, rule: undefined });
  const empty = { rules: [change, commit], subjects: [], all: [], findings: [], review: [], stats: { subjects: 0, reported: 0, missing: 0, unsure: 0, review: 0, byRule: {}, byFile: {} } };
  assert.deepEqual(
    silentRules({ ...empty, commits: { range: "HEAD", total: 1, skippedMerges: 0, noInstructionDoc: 1 } }).sort(),
    ["r-commit"],
    "the change rule is fully accounted for; the commit rule is not and stays reported",
  );
});

test("report: a change rule that found nothing despite some commit having an instruction document is still silent", () => {
  // The exclusion above is conditional on `noInstructionDoc` covering EVERY
  // non-merge commit, not on the rule simply having zero subjects. Two of
  // three commits here had a document and the rule still produced nothing,
  // which is not something `noInstructionDoc` explains -- that is a real
  // silent rule, the same as any other.
  const change = scoreRule({ id: "r-change", language: "Git", subject: "change", kind: "noul", ask: "a", criteria: { true: "y", false: "n" }, rule: undefined });
  const empty = { rules: [change], subjects: [], all: [], findings: [], review: [], stats: { subjects: 0, reported: 0, missing: 0, unsure: 0, review: 0, byRule: {}, byFile: {} } };
  assert.deepEqual(
    silentRules({ ...empty, commits: { range: "HEAD", total: 3, skippedMerges: 0, noInstructionDoc: 1 } }),
    ["r-change"],
  );
});

test("report: a run explains why a change rule asked about nothing, rather than call it a matcher that missed", () => {
  const change = scoreRule({ id: "diff-follows-instructions", language: "Git", subject: "change", kind: "noul", ask: "a", criteria: { true: "y", false: "n" }, rule: undefined });
  const result = {
    rules: [change],
    subjects: [],
    all: [],
    findings: [],
    review: [],
    stats: { subjects: 0, reported: 0, missing: 0, unsure: 0, review: 0, byRule: {}, byFile: {} },
    commits: { range: "HEAD", total: 1, skippedMerges: 0, noInstructionDoc: 1 },
  };
  const pretty = formatPretty(result, { color: false });
  assert.match(pretty, /1 commit\(s\) have no AGENTS\.md or CLAUDE\.md, so diff-follows-instructions was not asked about them/);
  assert.ok(!/matched nothing/.test(pretty), "the reason is stated in its own line; the rule is not also reported as a matcher that missed");
});

test("report: a change finding attributed to one directive prints where it is, its answer and enough of it to recognise", () => {
  const finding = changeFinding([
    {
      file: "AGENTS.md",
      line: 42,
      breadcrumb: "Contributing to jev-lint > Rules",
      body: "- A rule ships with a cutoff that was fitted, and the `at:` carries a\n  comment naming the run it came from.",
      value: 0.82,
    },
  ]);
  const pretty = formatPretty(
    { findings: [finding], all: [finding], review: [], stats: gate([]).stats } as never,
    { color: false },
  );
  assert.match(pretty, /AGENTS\.md:42/);
  assert.match(pretty, /0\.82/);
  assert.match(pretty, /Contributing to jev-lint > Rules/);
  // The wrapped source line joins into one -- a citation is one line in a
  // report where every line after it hangs at a fixed indent.
  assert.match(pretty, /A rule ships with a cutoff that was fitted, and the `at:` carries a comment naming the run it came from\./);
});

test("report: more than one attributed directive prints all of them, strongest first", () => {
  const finding = changeFinding([
    { file: "AGENTS.md", line: 42, breadcrumb: "Contributing to jev-lint > Rules", body: "- A rule ships with a cutoff that was fitted.", value: 0.91 },
    { file: "AGENTS.md", line: 29, breadcrumb: "Contributing to jev-lint > Secrets", body: "- The API key lives in the environment.", value: 0.7 },
  ]);
  const pretty = formatPretty(
    { findings: [finding], all: [finding], review: [], stats: gate([]).stats } as never,
    { color: false },
  );
  assert.match(pretty, /AGENTS\.md:42 \(0\.91\)/);
  assert.match(pretty, /AGENTS\.md:29 \(0\.70\)/);
  const first = pretty.indexOf("AGENTS.md:42");
  const second = pretty.indexOf("AGENTS.md:29");
  assert.ok(first >= 0 && second > first, "the stronger directive (already sorted by attributeFindings) prints first");
});

test("report: an ordinary finding with no violates is unchanged", () => {
  const rule = scoreRule({ at: 2 });
  const g = gate([{ subject: subjectOf({ rule }), answer: { value: 2.9, confidence: 0.9, kind: "score" } }]);
  const pretty = formatPretty({ ...g, rules: [rule] } as never, { color: false });
  assert.ok(!/cites /.test(pretty), "no violates on the finding means no citation line");
  assert.ok(!/AGENTS\.md/.test(pretty));
});

test("report: the github annotation carries the citation", () => {
  const finding = changeFinding([
    { file: "AGENTS.md", line: 42, breadcrumb: "Contributing to jev-lint > Rules", body: "- A rule ships with a cutoff that was fitted.", value: 0.82 },
  ]);
  const text = formatGithub({ findings: [finding], review: [], stats: gate([]).stats } as never);
  assert.match(text, /cites AGENTS\.md:42 \(0\.82\)/);
  assert.match(text, /A rule ships with a cutoff that was fitted\./);
});

test("report: formatJson reports violates verbatim, not a rendering", () => {
  const violates: NonNullable<Finding["violates"]> = [
    { file: "AGENTS.md", line: 42, breadcrumb: "Contributing to jev-lint > Rules", body: "- A rule ships with a cutoff that was fitted.", value: 0.82 },
  ];
  const finding = changeFinding(violates);
  const parsed = JSON.parse(formatJson({ findings: [finding], review: [], stats: gate([]).stats } as never));
  assert.deepEqual(parsed.findings[0].violates, violates);
});
