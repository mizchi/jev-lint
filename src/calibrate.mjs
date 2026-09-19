/**
 * Calibration.
 *
 * The order of operations here is the part that matters, and it is the reverse
 * of what seems natural. **Read the gap before touching a threshold.**
 *
 * Sort a rule's answers and look at the largest step between neighbours:
 *
 *   wide gap (say 1.8 on a 0-3 scale)   the sentence discriminates. Any cutoff
 *                                       inside the gap gives the same answers,
 *                                       so there is nothing to tune.
 *   narrow gap (0.2-0.3)                the answers are not separated at all.
 *                                       No cutoff repairs this; the SENTENCE
 *                                       has to be rewritten.
 *
 * That distinction is worth more than any number this module prints, because
 * calibrating a rule whose answers are bunched together is time spent on a
 * problem that calibration cannot reach. In published trials of five hand
 * written rules of exactly this shape, two failed with gaps of 0.16 and 0.28;
 * neither was fixable by threshold and both were fixed by rewriting the
 * question -- one of them by asking about something the subject could actually
 * show. The other three had gaps from 1.79 to 2.16 and their default cutoffs
 * were never touched.
 *
 * So: `jevlint gaps` first. `jevlint calibrate` only once the gaps are wide.
 */
import { cutoffFor, DEFAULT_SCORE_AT, DEFAULT_NOUL_AT } from "./rules.mjs";

/** Largest step between consecutive sorted values, and where it sits. */
export function widestGap(values) {
  if (values.length < 2) return { gap: 0, low: values[0] ?? null, high: values[0] ?? null };
  const sorted = [...values].sort((a, b) => a - b);
  let best = { gap: -1, low: sorted[0], high: sorted[0] };
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap > best.gap) best = { gap, low: sorted[i - 1], high: sorted[i] };
  }
  return best;
}

/**
 * Per-rule separation report.
 *
 * `verdict` is the actionable column:
 *
 *   works    the gap is wide and the cutoff is inside it. Leave it alone.
 *   move     the gap is wide but the cutoff is outside it -- the rule is
 *            discriminating and the threshold is in the wrong place, which is
 *            the one case calibration genuinely fixes.
 *   rewrite  the gap is narrow. The answers are not separated; rewrite the
 *            sentence, and start by checking whether the question asks for
 *            something the subject can actually show.
 *   silent   the matcher produced nothing. The matcher fails SILENTLY, so this
 *            row is the only place it shows up at all -- a rule that never
 *            matched looks exactly like a rule that found no problems.
 *   thin     too few matches to say anything. Not a pass.
 */
export function gapReport(all, rules, { cutoffs = {} } = {}) {
  const byRule = new Map(rules.map((r) => [r.id, []]));
  for (const f of all) {
    if (typeof f.value !== "number") continue;
    if (!byRule.has(f.rule)) byRule.set(f.rule, []);
    byRule.get(f.rule).push(f);
  }

  const rows = [];
  for (const rule of rules) {
    const answers = byRule.get(rule.id) ?? [];
    const values = answers.map((a) => a.value);
    const at = cutoffFor(rule, cutoffs);
    const scale = rule.kind === "score" ? 3 : 1;
    const { gap, low, high } = widestGap(values);
    const reported = answers.filter((a) => a.value >= at).length;
    // "Wide" has to be relative to the scale: 0.5 is narrow on a 0-3 score and
    // half the range on a 0-1 noul.
    const wide = gap >= 0.25 * scale;
    const inGap = gap > 0 && at > low && at <= high;

    let verdict;
    if (values.length === 0) verdict = "silent";
    else if (values.length < 3) verdict = "thin";
    else if (!wide) verdict = "rewrite";
    else if (inGap) verdict = "works";
    else verdict = "move";

    rows.push({
      rule: rule.id,
      kind: rule.kind,
      matches: values.length,
      reported,
      at,
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
      median: median(values),
      gap,
      gapLow: low,
      gapHigh: high,
      inGap,
      // The midpoint of the widest gap: the cutoff furthest from any observed
      // answer, and therefore the one least likely to be crossed by the next
      // draw. Fitting a cutoff to the edge of the observed clean set puts it
      // exactly on the boundary it was meant to clear.
      suggested: gap > 0 ? round2((low + high) / 2) : at,
      verdict,
      values: values.slice().sort((a, b) => b - a),
    });
  }
  return rows;
}

function median(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return round2(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Stability across repeated runs of the same subjects.
 *
 * Two numbers, and the second is the one that matters to a user:
 *
 *   spread  how much a subject's raw answer moves between runs.
 *   flips   how often the reported/not-reported DECISION changes.
 *
 * A rule can have a wobbly score and a perfectly stable decision, if the wobble
 * happens far from the cutoff. That is the good case, and it is why a decision
 * sitting inside the wobble band should not be automated: a trivial difference
 * in input flips it. Those belong in front of a person.
 */
export function stabilityReport(runs, rules, { cutoffs = {} } = {}) {
  const atFor = new Map(rules.map((r) => [r.id, cutoffFor(r, cutoffs)]));
  const bySubject = new Map();
  for (const run of runs) {
    for (const f of run) {
      if (typeof f.value !== "number") continue;
      const key = `${f.rule}\u0000${f.file}\u0000${f.line}`;
      if (!bySubject.has(key)) bySubject.set(key, { rule: f.rule, file: f.file, line: f.line, values: [] });
      bySubject.get(key).values.push(f.value);
    }
  }

  const subjects = [];
  for (const s of bySubject.values()) {
    if (s.values.length < 2) continue;
    const at = atFor.get(s.rule) ?? 0;
    const decisions = s.values.map((v) => v >= at);
    const flipped = decisions.some((d) => d !== decisions[0]);
    subjects.push({
      ...s,
      runs: s.values.length,
      min: Math.min(...s.values),
      max: Math.max(...s.values),
      spread: round2(Math.max(...s.values) - Math.min(...s.values)),
      mean: round2(s.values.reduce((a, b) => a + b, 0) / s.values.length),
      at,
      flipped,
      // How close the subject sits to its own cutoff, which is what predicts a
      // flip far better than the spread does.
      distance: round2(Math.min(...s.values.map((v) => Math.abs(v - at)))),
    });
  }

  const byRule = new Map();
  for (const s of subjects) {
    if (!byRule.has(s.rule)) byRule.set(s.rule, []);
    byRule.get(s.rule).push(s);
  }
  const rows = [...byRule.entries()].map(([rule, list]) => ({
    rule,
    subjects: list.length,
    flipped: list.filter((s) => s.flipped).length,
    maxSpread: round2(Math.max(...list.map((s) => s.spread))),
    meanSpread: round2(list.reduce((a, s) => a + s.spread, 0) / list.length),
  }));

  return {
    runs: runs.length,
    subjects,
    rows,
    flipped: subjects.filter((s) => s.flipped),
  };
}

/**
 * Fit cutoffs against a labeled corpus.
 *
 * The procedure, not the numbers, is the transferable part:
 *
 *   1. Take the highest answer among subjects labeled CLEAN for this rule.
 *   2. Put the cutoff a step above it, not immediately above it.
 *
 * Step two is the whole lesson. A cutoff fitted to "highest clean answer plus
 * a hair" sits exactly on the false-positive boundary, and the next sample
 * crosses it -- this has been measured happening after adding ten functions to
 * a corpus. Where a gap exists between the clean set and the labeled-bad set,
 * the midpoint of that gap is the right answer and this returns it.
 *
 * With no labels there is nothing to fit against, and `gapReport`'s suggestion
 * -- the midpoint of the widest gap, wherever the truth lies -- is the best
 * available guess. It is a starting point, not a calibration.
 */
export function fitCutoffs(all, labels, rules) {
  const byRule = new Map();
  for (const f of all) {
    if (typeof f.value !== "number") continue;
    if (!byRule.has(f.rule)) byRule.set(f.rule, []);
    const label = labelFor(labels, f.file, f.line, f.rule);
    byRule.get(f.rule).push({ ...f, label });
  }

  const fits = [];
  for (const rule of rules) {
    const answers = byRule.get(rule.id) ?? [];
    const scale = rule.kind === "score" ? 3 : 1;
    const bad = answers.filter((a) => a.label === "bad").map((a) => a.value);
    const clean = answers.filter((a) => a.label === "clean").map((a) => a.value);

    if (bad.length === 0 || clean.length === 0) {
      fits.push({
        rule: rule.id,
        fitted: null,
        reason: bad.length === 0 ? "no labeled violations matched" : "no labeled clean matches",
        bad: bad.length,
        clean: clean.length,
      });
      continue;
    }

    const hiClean = Math.max(...clean);
    const loBad = Math.min(...bad);
    const separable = loBad > hiClean;
    // Separable: put it in the middle of the gap. Overlapping: no cutoff is
    // clean, so take the one maximising (recall - false positives) and say so.
    const fitted = separable ? round2((hiClean + loBad) / 2) : bestTradeoff(answers, scale);
    const { tp, fp, fn } = score(answers, fitted);

    fits.push({
      rule: rule.id,
      fitted,
      separable,
      hiClean: round2(hiClean),
      loBad: round2(loBad),
      bad: bad.length,
      clean: clean.length,
      precision: tp + fp > 0 ? round2(tp / (tp + fp)) : null,
      recall: tp + fn > 0 ? round2(tp / (tp + fn)) : null,
      tp,
      fp,
      fn,
      reason: separable ? "midpoint of the clean/violation gap" : "no separating cutoff; best trade-off",
    });
  }
  return fits;
}

function bestTradeoff(answers, scale) {
  let best = { at: scale / 2, gain: -Infinity };
  const candidates = [...new Set(answers.map((a) => a.value))].sort((x, y) => x - y);
  for (const v of candidates) {
    const at = v;
    const { tp, fp } = score(answers, at);
    const gain = tp - fp;
    if (gain > best.gain) best = { at: round2(at), gain };
  }
  return best.at;
}

function score(answers, at) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const a of answers) {
    const flagged = a.value >= at;
    if (a.label === "bad") flagged ? (tp += 1) : (fn += 1);
    else if (a.label === "clean" && flagged) fp += 1;
  }
  return { tp, fp, fn };
}

/**
 * Look up a label.
 *
 * Labels are keyed loosely -- by file and a line window -- because a subject's
 * reported line is the matcher's, and a human labeling a corpus writes down the
 * line the problem is on. Requiring them to agree exactly would make the corpus
 * brittle against a rule whose `subject: enclosing` moves the reported line to
 * the top of the function.
 */
export function labelFor(labels, file, line, rule) {
  // `$default` lets a corpus mark only its defects and treat everything else as
  // clean, which is the only practical way to author one: the clean cases are
  // most of the corpus and enumerating them by line is busywork that goes stale
  // the moment a file is edited.
  const fallbackLabel = labels?.$default ?? "unlabeled";
  const forFile = labels?.[file];
  if (!Array.isArray(forFile)) return fallbackLabel;
  let result = fallbackLabel;
  for (const l of forFile) {
    const within = Math.abs((l.line ?? -1) - line) <= (l.window ?? 3);
    if (!within) continue;
    if (l.rule && l.rule !== rule) continue;
    // A `bad` label wins over anything else covering the same lines: the
    // windows are loose and a defect inside a nearby clean span is still a
    // defect.
    if (l.label === "bad") return "bad";
    result = l.label ?? result;
  }
  return result;
}
