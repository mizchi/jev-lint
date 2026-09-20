/**
 * The `paired` arm's evidence: the tests that go with a file.
 *
 * Every other arm is built from the file the match is in. This one reaches
 * across to a second file, because the question it serves -- does any test
 * reach this function's failure path -- is unanswerable from the source alone
 * at any cutoff. The evidence is genuinely elsewhere, and the arm design says
 * to supply the least context that contains it, not to leave it out.
 *
 * "Which tests" is a heuristic, deliberately. Resolving imports would be the
 * exact answer and would also be a build system; the conventions -- a test
 * named for the module, a test directory mirroring the source tree -- cover
 * the ordinary case, and the arm says what it found so the model can weigh
 * a weak pairing rather than mistake it for a strong one.
 *
 * What travels is an EXCERPT, not the file. A test file is mostly setup; the
 * lines that matter are the ones that name the module's symbols and the ones
 * that open a test, and a few lines around each. Measured on the same shape
 * elsewhere, a whole test file per source file put the state over budget on
 * ordinary modules; the excerpt keeps four related files under a few thousand
 * tokens.
 */
import { basename, dirname, isAbsolute, join, posix, relative, sep } from "node:path";
import { moduleIdentity } from "./scan.ts";
import { FileIndex, tryReadFile } from "./files.ts";

/** One related test, as the state carries it. */
export interface RelatedTest {
  path: string;
  /** What made it related: its name, that it imports the file, or that it IS the file (vitest in-source tests). */
  via: "name" | "import" | "in-source";
  /** The excerpt, or the whole file when nothing in it matched. */
  code: string;
}

/** At most this many related tests per file, best matches first. */
export const MAX_RELATED_TESTS = 4;

/**
 * Characters of test excerpt per source file, shared by its related tests,
 * for one subject in the file; each further subject adds
 * `TEST_EXCERPT_PER_SUBJECT`, up to `TEST_EXCERPT_MAX`.
 *
 * One related file gets all of it; four get a quarter each. Over a file's
 * share, what the lowest-priority keywords alone matched is dropped and the
 * cut is marked. The tests are evidence per subject: a file with ten
 * exported functions asked about at once needs ten functions' tests in
 * the excerpt, and at a flat 8,000 characters -- 180 lines of a
 * repository's one test file -- the model read most of them as untested.
 */
export const TEST_EXCERPT_BUDGET = 8000;
export const TEST_EXCERPT_PER_SUBJECT = 2000;
export const TEST_EXCERPT_MAX = 32_000;

/** The excerpt budget for a file with `subjects` subjects asked about. */
export function excerptBudget(subjects: number): number {
  return Math.min(TEST_EXCERPT_MAX, TEST_EXCERPT_BUDGET + Math.max(0, subjects - 1) * TEST_EXCERPT_PER_SUBJECT);
}

/** How many lines around a matching line an excerpt keeps. */
const EXCERPT_CONTEXT_LINES = 2;

/**
 * A test file, by the usual spellings: `a.test.ts`, `a.spec.js`, `a_test.go`,
 * `test_a.py` anywhere; or, under a `test`, `tests`, `__tests__` or `spec` directory, a
 * file that actually opens a test. The second clause needs the content:
 * `test/fixtures/cart.ts` sits under `test/` and is a fixture, and pairing
 * it as `cart.ts`'s test was measured to happen before the content was
 * consulted. Without content, a file under a test directory is taken on
 * its directory alone.
 *
 * Directory names must be whole path segments: `src/latest.ts` and
 * `src/contest/` are not tests, and `spec-parser.ts` is a parser.
 */
const TEST_DIRECTORY = /(?:^|\/)(?:tests?|__tests__|spec)(?:\/|$)/;
const TEST_NAME = /(?:[._-](?:spec|test)|_(?:spec|test))\.[A-Za-z0-9]+$|^test_[^/]+\.py$/;

export function isTestFile(path: string, content?: string): boolean {
  const p = path.split(sep).join("/");
  if (TEST_NAME.test(basename(p))) return true;
  if (!TEST_DIRECTORY.test(dirname(p) + "/")) return false;
  return content === undefined || TEST_OPENER_ANYWHERE.test(content);
}

/** Directories at the project root that hold tests by convention. */
const CONVENTIONAL_ROOTS = ["test", "tests", "__tests__", "spec"];

/**
 * Every test file under the paths a run was given, plus the conventional
 * test directories at the project root -- `jev-lint check src` should still
 * find `test/`. Paths come back relative to `cwd`, with forward slashes, the
 * way ast-grep reports its matches. The walk is the run's shared one when
 * an index is given.
 */
export function findTestFiles(roots: string[], cwd: string = process.cwd(), index: FileIndex = new FileIndex(cwd)): string[] {
  const all = index.extend([...roots, ...CONVENTIONAL_ROOTS]);
  return all.filter((rel) => isTestFile(rel, readIfUnderTestDirectory(join(cwd, rel), rel)));
}

/**
 * The content, for the files whose test-ness depends on it -- those under a
 * test directory but not named as tests. Everything else is decided by name
 * and never read here.
 */
function readIfUnderTestDirectory(full: string, rel: string): string | undefined {
  if (TEST_NAME.test(basename(rel)) || !TEST_DIRECTORY.test(dirname(rel) + "/")) return undefined;
  // Unreadable is empty: a file that cannot be read opens no test.
  return tryReadFile(full) ?? "";
}

/**
 * The tests most likely to be about a file, best first.
 *
 * A test is related when its NAME contains the module's name, or when it
 * IMPORTS the module -- the second is what pairs a repository whose tests
 * all live in one file. Sitting under the module's directory, or under a
 * directory named for the module (the mirrored `test/cart/` for `src/cart/`),
 * only ranks the related ones. A same-directory test named for something
 * else is not evidence about this file -- counting it would pair every file
 * in a flat `src/` with four arbitrary neighbours. A module named by its
 * directory, `cart/index.ts`, is named `cart`, and its mirror
 * `cart/index.test.ts` counts as a name match too, since `index` on its own
 * names nothing. A test file is not its own test.
 *
 * `readSource` is what makes the import signal possible; without it only
 * the name is consulted.
 */
export function relatedTestFiles(
  file: string,
  testFiles: string[],
  readSource?: (path: string) => string,
): string[] {
  return relatedTests(file, testFiles, readSource).map(({ path }) => path);
}

/** As `relatedTestFiles`, with how each was paired; `limit` is how many, best first. */
export function relatedTests(
  file: string,
  testFiles: string[],
  readSource?: (path: string) => string,
  limit: number = MAX_RELATED_TESTS,
): Array<{ path: string; via: RelatedTest["via"] }> {
  const id = moduleIdentity(file);
  const name = (id.named_by_directory ?? id.stem).toLowerCase();
  const own = id.stem.toLowerCase();
  const dir = dirname(file) === "." ? "" : `${dirname(file)}/`.toLowerCase();
  // The name as a whole segment of the test's name, split on `.` and `_`:
  // `cart.test.ts` and `cart_test.js` name `cart`; `cartography.test.ts` and
  // `shopping-cart.test.ts` name something else. A hyphen is part of a
  // name, so `my-module.test.ts` still pairs with `my-module.ts`.
  const names = (base: string) => base.split(/[._]/);
  const family = languageFamily(file);
  return testFiles
    .filter((t) => t !== file && languageFamily(t) === family)
    .map((t) => {
      const lower = t.toLowerCase();
      const base = basename(lower);
      const segments = lower.split("/").slice(0, -1);
      const mirrored = segments.includes(name);
      const byName =
        names(base).includes(name) || (id.named_by_directory !== null && mirrored && names(base).includes(own));
      const byImport = !byName && readSource !== undefined && importsModule(readSource(t), file, t, readSource);
      const byDir = dir !== "" && lower.startsWith(dir);
      const via: RelatedTest["via"] = byName ? "name" : "import";
      // A file named for the module outranks one that merely imports it:
      // every test file may import a module for a fixture builder, and
      // the four that did, alphabetically, once shut out `rules.test.ts`.
      return { t, via, score: byName ? 4 + (byDir || mirrored ? 1 : 0) : byImport ? 2 + (byDir || mirrored ? 1 : 0) : 0 };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.t.localeCompare(b.t))
    .slice(0, limit)
    .map(({ t, via }) => ({ path: t, via }));
}

/** The opener of a vitest in-source test block. */
const IN_SOURCE_OPENER = /^[ \t]*if\s*\(\s*import\.meta\.vitest\s*\)\s*\{/m;

/**
 * The `if (import.meta.vitest) { ... }` block of a module, from its opener
 * to the brace that closes it, or null when the module has no such block.
 * Braces are counted textually, strings and comments included: a stray `}`
 * returns the block cut short there, and a stray `{` returns everything
 * from the opener to the end of the file.
 */
export function inSourceTests(source: string): string | null {
  const m = IN_SOURCE_OPENER.exec(source);
  if (!m) return null;
  const from = m.index;
  let depth = 0;
  for (let i = from + m[0].length - 1; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(from, i + 1);
    }
  }
  return source.slice(from);
}

/**
 * Does the source of `from` import the module at `file`?
 *
 * A relative specifier is resolved from the importing file and compared as
 * a path, extension aside, with a directory standing for its `index`. It
 * used to compare only the specifier's last segment to the module's stem,
 * and that paired `test/test.ts` with any `report.ts` in the tree because
 * it imports `../src/report.ts`. A path-like alias (`src/cart/cart`,
 * `@/cart/cart`) has no base to resolve from and is matched as a suffix of
 * the module's path. A bare package name is not a module in this
 * repository.
 */
export function importsModule(source: string, file: string, from: string, readSource?: (path: string) => string): boolean {
  const target = modulePaths(file);
  const base = dirname(from.split(sep).join("/"));
  const relative: string[] = [];
  for (const m of source.matchAll(IMPORT_SPECIFIER)) {
    const spec = (m[1] ?? m[2] ?? "").split(sep).join("/");
    if (!spec.includes("/")) continue;
    const bare = spec.replace(/\.[A-Za-z0-9]+$/, "");
    if (spec.startsWith(".")) {
      const resolved = posix.normalize(posix.join(base, bare));
      if (target.has(resolved)) return true;
      relative.push(resolved + (/\.[A-Za-z0-9]+$/.test(spec) ? spec.slice(spec.lastIndexOf(".")) : ""));
    } else {
      const alias = bare.replace(/^@\//, "");
      if ([...target].some((t) => t === alias || t.endsWith(`/${alias}`))) return true;
    }
  }
  // One hop: a test that drives an entry point -- `main.ts`, an `index` --
  // which imports the module is that module's test too. One hop and not a
  // walk, since two hops from a test reach most of a tree. Only relative
  // imports with their extension are followed; a source that cannot be
  // read is empty, and imports nothing.
  if (readSource) {
    for (const path of relative) {
      if (!/\.[A-Za-z0-9]+$/.test(path)) continue;
      if (importsModule(readSource(path), file, path)) return true;
    }
  }
  return false;
}

/** The forms an import of `file` can resolve to: the file, and its directory when it is an index. */
function modulePaths(file: string): Set<string> {
  const p = posix.normalize(file.split(sep).join("/"));
  const out = new Set([p.replace(/\.[A-Za-z0-9]+$/, "")]);
  if (moduleIdentity(file).named_by_directory) out.add(dirname(p));
  return out;
}

/** `from "..."`, `import("...")` and `require("...")`, single or double quoted. */
const IMPORT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)(?:"([^"]+)"|'([^']+)')/g;

/**
 * The language a file's tests are written in, by extension: the ECMAScript
 * grammars are one family, everything else is its own. A test in another
 * family is never this file's test, whatever it is called -- without this,
 * a Go `cart.go` paired with a `cart.test.ts` under the conventional
 * `test/` root, and the excerpt budget went three ways.
 */
export function languageFamily(path: string): string {
  const ext = (path.split(".").pop() ?? "").toLowerCase();
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"].includes(ext)) return "ecmascript";
  return ext;
}

/**
 * Lines that open a test or a suite, in the common runners. A call, not a
 * definition: `function test(name, fn)` is a harness, and a harness under
 * `test/` paired with every module until this said so.
 */
const TEST_OPENER = /(?<!function\s+)(?<!\bconst\s+)(?<!\blet\s+)\b(?:describe|test|it|suite|context)\s*(?:\.\w+)?\s*\(|^\s*#\[test\]|^\s*fn test_|^\s*def test_|^\s*func Test\w*\s*\(/;
/** The same, anywhere in a file: does this file open a test at all? */
const TEST_OPENER_ANYWHERE = /(?<!function\s+)(?<!\bconst\s+)(?<!\blet\s+)\b(?:describe|test|it|suite|context)\s*(?:\.\w+)?\s*\(|#\[test\]|\bfn test_|\bdef test_|\bfunc Test\w*\s*\(/;

/** A test block this long or shorter is kept whole once any line in it matched. */
const WHOLE_BLOCK_LINES = 40;

/** How far above a keyword line the test's title is looked for. */
const TITLE_LOOKBACK_LINES = 60;

/**
 * The part of a test file worth sending: the lines that mention any of the
 * `keywords` with a little context around each, and for each of those the
 * nearest line above that opens a test -- its title, which is the claim the
 * call is there to establish. Runs of kept lines are joined; a gap is
 * marked so the model knows it is reading an excerpt.
 *
 * `keywords` are in priority order: the names of the subjects being asked
 * about first, the module's other exports after, its stem last. Over the
 * budget, the regions a lower-priority keyword alone matched are dropped
 * before any a higher one did, and file order is kept among what stays.
 * In a repository with one test file for everything, keyed on the stem
 * alone `config` matched three hundred lines of `--config` flags and the
 * excerpt was cut from the middle, where the one test of `findConfig`'s
 * throw sat; the rule then reported a failure path no test reached.
 *
 * Openers are not kept on their own. Every `test(` line kept would fill the
 * excerpt with titles of tests about other modules and push the lines that
 * call THIS module past the cut.
 *
 * A file where nothing matched is sent whole -- an empty excerpt would say
 * "this file tests nothing", which is not what was measured.
 */
export function compactTest(
  path: string,
  content: string,
  keywords: string[],
  limit: number = TEST_EXCERPT_BUDGET,
): Omit<RelatedTest, "via"> {
  const lines = content.split("\n");
  const needles = keywords
    .filter((k) => k.length > 0)
    .map((k) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"));
  // Each kept line carries the best (lowest) keyword rank that reached it.
  const rank = new Map<number, number>();
  const keep = (j: number, r: number) => {
    const have = rank.get(j);
    if (have === undefined || r < have) rank.set(j, r);
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const r = needles.findIndex((k) => k.test(line));
    if (r < 0) continue;
    for (let j = Math.max(0, i - EXCERPT_CONTEXT_LINES); j <= Math.min(lines.length - 1, i + EXCERPT_CONTEXT_LINES); j += 1) {
      keep(j, r);
    }
    for (let j = i - 1; j >= 0 && j >= i - TITLE_LOOKBACK_LINES; j -= 1) {
      if (!TEST_OPENER.test(lines[j]!)) continue;
      keep(j, r);
      // A short test is kept whole from its opener to its close, found by
      // indentation: the first later line at the opener's depth that begins
      // a closer. The assertion that proves a failure path was reached sits
      // several lines below the call, and two lines of context lost it.
      const depth = indentOf(lines[j]!);
      let end = -1;
      for (let k = j + 1; k < lines.length && k <= j + WHOLE_BLOCK_LINES; k += 1) {
        const l = lines[k]!;
        if (l.trim() !== "" && indentOf(l) <= depth && /^[\s]*[})\]]/.test(l)) {
          end = k;
          break;
        }
      }
      if (end >= 0) for (let k = j; k <= end; k += 1) keep(k, r);
      break;
    }
  }
  if (rank.size === 0) return { path, code: fit(content, limit) };
  // Runs of adjacent kept lines of one rank are the regions. Regions enter
  // by rank, then by position, while they fit; the first always enters,
  // cut from the middle if it must be. What was kept and then dropped for
  // room is marked like any other gap.
  const kept = [...rank.keys()].sort((a, b) => a - b);
  const regions: Array<{ from: number; to: number; rank: number; size: number }> = [];
  for (const i of kept) {
    const last = regions.at(-1);
    const r = rank.get(i)!;
    if (last && i === last.to + 1 && last.rank === r) {
      last.to = i;
      last.size += lines[i]!.length + 1;
    } else {
      regions.push({ from: i, to: i, rank: r, size: lines[i]!.length + 1 });
    }
  }
  if (regions.length === 1 && rank.size === lines.length) return { path, code: fit(content, limit) };
  const byRank = [...regions].sort((a, b) => a.rank - b.rank || a.from - b.from);
  const chosen = new Set<(typeof regions)[number]>();
  let used = 0;
  for (const region of byRank) {
    const gap = chosen.size > 0 ? 2 : 0;
    if (chosen.size > 0 && used + gap + region.size > limit) continue;
    chosen.add(region);
    used += gap + region.size;
  }
  const out: string[] = [];
  let lastLine = -1;
  let dropped = false;
  for (const region of regions) {
    if (!chosen.has(region)) {
      dropped = true;
      continue;
    }
    if (out.length > 0 ? region.from !== lastLine + 1 : dropped) out.push("…");
    for (let i = region.from; i <= region.to; i += 1) out.push(lines[i]!);
    lastLine = region.to;
    dropped = false;
  }
  if (dropped) out.push("…");
  return { path, code: fit(out.join("\n"), limit) };
}

/** Within `limit`, cut from the middle: both ends of a region survive. */
function fit(code: string, limit: number): string {
  if (code.length <= limit) return code;
  const side = Math.floor((limit - 3) / 2);
  return `${code.slice(0, side)}\n…\n${code.slice(-side)}`;
}

function indentOf(line: string): number {
  return /^\s*/.exec(line)![0].length;
}

export interface PairOptions {
  /** The paths the run was given; the walk starts there. */
  roots: string[];
  cwd?: string;
  /** The run's shared walk, so this is not a second one. */
  index?: FileIndex;
  /** What to look for in a test: a file's exported names, typically. */
  keywords?: (file: string) => string[];
  /** Characters of excerpt for a file, `excerptBudget(subjects)` typically; the default is one subject's. */
  budget?: (file: string) => number;
  /** Test file discovery, injectable for tests of this module. */
  testFiles?: string[];
  readSource?: (path: string) => string;
}

/**
 * Pair each source file with the excerpts of its related tests.
 *
 * A file with no related test is ABSENT from the map rather than mapped to
 * an empty list, so the caller can count and report those files: a question
 * about tests with no tests to look at is a question the state cannot
 * answer, and the runner drops it loudly rather than asking anyway.
 */
export function pairTests(
  files: Iterable<string>,
  { roots, cwd = process.cwd(), keywords = () => [], budget = () => TEST_EXCERPT_BUDGET, testFiles, readSource, index }: PairOptions,
): Map<string, RelatedTest[]> {
  const candidates = testFiles ?? findTestFiles(roots, cwd, index);
  // An unreadable test file has no tests in it, and pairs with nothing.
  const read = readSource ?? ((p: string) => tryReadFile(isAbsolute(p) ? p : join(cwd, p)) ?? "");
  // Each test file is read once, however many source files it pairs with.
  const contents = new Map<string, string>();
  const source = (p: string) => {
    if (!contents.has(p)) contents.set(p, read(p));
    return contents.get(p)!;
  };
  const out = new Map<string, RelatedTest[]>();
  for (const file of files) {
    // Every related file, then the best `MAX_RELATED_TESTS` by what they
    // mention. The keywords are in priority order -- the subjects asked
    // about first, the module's other exports, its name last -- and a file
    // scores by the keywords it names, earlier ones counting more; the
    // pairing order breaks ties. The module's own name is not scored: every
    // related file has it.
    const words = [...new Set([...keywords(file), moduleIdentity(file).named_by_directory ?? moduleIdentity(file).stem])];
    const needles = words.slice(0, -1).map((k) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`));
    const relevance = (path: string): number => {
      const text = source(path);
      return needles.reduce((n, k, i) => n + (k.test(text) ? needles.length - i : 0), 0);
    };
    const related = relatedTests(file, candidates, source, Infinity)
      .map((r, order) => ({ ...r, order, hits: relevance(r.path) }))
      .sort((a, b) => b.hits - a.hits || a.order - b.order)
      .slice(0, MAX_RELATED_TESTS);
    // A module carrying its own tests (`if (import.meta.vitest) { ... }`)
    // is paired with that block first: the tests nearest the code.
    const own = inSourceTests(source(file));
    if (related.length === 0 && own === null) continue;
    // The budget is split by relevance, not evenly: a file naming most of
    // the subjects gets most of the room, and one that only pairs gets
    // the least. The in-source block, when there is one, counts as the
    // most relevant file there is.
    const weights = [...(own === null ? [] : [Math.max(1, ...related.map((r) => r.hits)) + 1]), ...related.map((r) => r.hits + 1)];
    const total = weights.reduce((a, b) => a + b, 0);
    const shareOf = (i: number) => Math.floor((budget(file) * weights[i]!) / total);
    out.set(
      file,
      [
        ...(own === null ? [] : [{ path: file, via: "in-source" as const, code: own.length > shareOf(0) ? own.slice(0, shareOf(0)) : own }]),
        ...related.map(({ path, via }, i) => ({ ...compactTest(path, source(path), words, shareOf(i + (own === null ? 0 : 1))), via })),
      ].filter((t) => t.code.trim() !== ""),
    );
    if (out.get(file)!.length === 0) out.delete(file);
  }
  return out;
}
