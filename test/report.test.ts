import { strict as assert } from "node:assert";
import { decide, gate } from "../src/gate.ts";
import { formatGithub, formatJson, formatPretty, silentRules, idleLanguages } from "../src/report.ts";
import type { Rule, Subject } from "../src/types.ts";
import { test, scoreRule, noulRule, subjectOf, answer } from "./helpers.ts";

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
