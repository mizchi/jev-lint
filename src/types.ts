/**
 * The shared type surface.
 *
 * Every domain vocabulary that more than one module needs lives here, so there
 * is one definition of what a rule, a subject, a batch and an answer are rather
 * than an implicit agreement between modules that drifts.
 *
 * Two conventions throughout:
 *
 * - **Unions come from `as const` arrays, not enums.** The arrays already
 *   existed because validation needs them at runtime, and deriving the type
 *   from the array means a new arm or kind cannot be added to one without the
 *   other. It also keeps the build inside `erasableSyntaxOnly`, so the same
 *   source runs under `tsc` and under Node's type stripping.
 * - **`null` means "known to be absent", `undefined` means "not applicable
 *   here".** A rule with `at: null` has no cutoff of its own and takes the
 *   default; a subject with no `id` has not been assigned to a batch yet.
 */

// ---------------------------------------------------------------- vocabulary

/**
 * Languages the ast-grep CLI has built in, plus one that is not a grammar:
 * `Git`, the pseudo-language of a `subject: commit` rule, whose subjects
 * come from `git log` rather than from a parse. It is never handed to
 * ast-grep; `scan.ts` filters it out of every rule file and probe list.
 */
export const LANGUAGES = [
  "Bash", "C", "Cpp", "CSharp", "Css", "Dart", "Elixir", "Go", "Haskell",
  "Html", "Java", "JavaScript", "Json", "Jsx", "Kotlin", "Lua", "Php",
  "Python", "Ruby", "Rust", "Scala", "Solidity", "Swift", "Tsx", "TypeScript",
  "Yaml", "Git", "Text",
] as const;
/**
 * A built-in name, or a language a config declared. The union keeps the
 * built-ins spelled correctly where they are written by hand; the open
 * half is a declared language's name, which is whatever the config called
 * it -- ast-grep matches a rule's `language:` against its `sgconfig.yml`
 * key exactly, so there is nothing to normalize it to. `normalizeLanguage`
 * is the gate: it takes the declarations and returns null for a name that
 * is neither.
 */
export type Language = (typeof LANGUAGES)[number] | (string & {});

/**
 * A grammar ast-grep does not have built in: a tree-sitter parser compiled
 * to a dynamic library, as its `customLanguages` takes it.
 */
export interface CustomLanguage {
  /** The compiled parser (.so / .dylib / .dll), absolute by the time a run sees it. */
  libraryPath: string;
  /** The file extensions it claims, without the dot. */
  extensions: string[];
  /**
   * The character `$` becomes inside a pattern, for a language where `$VAR`
   * is not valid syntax. Without it a pattern with a metavariable parses to
   * an ERROR node and matches nothing -- measured on MoonBit, where `_` works.
   */
  expandoChar?: string;
}

/** Declared languages, by the name a rule's `language:` must use. */
export type CustomLanguages = Record<string, CustomLanguage>;

/**
 * Languages the package ships rules for that ast-grep does not have built
 * in: the name, the extensions and the expando are known, the parser is
 * not. Loading such a rule needs nothing -- `eval --replay`, `rules` and
 * RULES.md read rules without scanning a line -- and a run that has no
 * `languages:` naming one drops its rules and says which, rather than
 * reporting a language's worth of nothing.
 */
export const SHIPPED_CUSTOM_LANGUAGES: Record<string, Omit<CustomLanguage, "libraryPath">> = {
  moonbit: { extensions: ["mbt"], expandoChar: "_" },
};

/** The one language that is not a grammar. */
export const COMMIT_LANGUAGE: Language = "Git";
export interface InstructionDoc {
  /**
   * Where this document's text actually came from: one of
   * `INSTRUCTION_FILES`, or, when a root-level file was a symlink, the
   * path it resolved to -- which is not always one of those names. A
   * finding reports against this, not against the link's own name.
   */
  file: string;
  text: string;
}

export interface Instructions {
  docs: InstructionDoc[];
  /** True when the budget cut a document short; the state has to say so. */
  truncated: boolean;
}

/** The other: a `subject: block` rule's, whose subjects are blocks of a text file split at a header line. */
export const TEXT_LANGUAGE: Language = "Text";

/**
 * The shipped layout: `rules/<lang>/<id>/rule.yml`. A language directory
 * admits these grammars and no other, which is what keeps one language's
 * matcher out of another's file. `typescript` admits the ECMAScript
 * family, since one matcher usually serves all four. A directory named
 * for any other grammar (`python`, `go`) admits that grammar alone.
 */
export const LANGUAGE_DIRS: Record<string, readonly Language[]> = {
  typescript: ["TypeScript", "Tsx", "JavaScript", "Jsx"],
  javascript: ["JavaScript", "Jsx"],
  rust: ["Rust"],
  // Three shells, one grammar: ast-grep's `Bash` parses sh and zsh as well,
  // and a reader looking for the rules that read scripts looks for `shell`.
  shell: ["Bash"],
  git: ["Git"],
  text: ["Text"],
  markdown: ["Text"],
};

/**
 * The languages a shipped rule is held to the full bar for: fixtures, an
 * expect file and an accepted baseline, checked by the test suite. A rule
 * under any other language directory loads without them and is reported
 * as uncalibrated.
 */
export const TIER_ONE = ["typescript", "rust"] as const;

/** What the question asks for, and therefore what the answer means. */
export const KINDS = ["score", "noul"] as const;
export type RuleKind = (typeof KINDS)[number];

/**
 * What code the question is actually about. `commit` and `change` are the
 * two subjects with no ast-grep matcher: both are built from git. `commit`
 * judges the message, with the diff as evidence; `change` judges the diff
 * itself, so it exists before a commit does.
 */
export const SUBJECTS = ["node", "enclosing", "file", "commit", "change", "block"] as const;
export type SubjectMode = (typeof SUBJECTS)[number];

/** Which sections of state accompany the questions. */
export const STATE_ARMS = ["bare", "local", "paired", "located", "graph", "full"] as const;
export type StateArm = (typeof STATE_ARMS)[number];

/** What a state is built around: one file, or one rule's matches. */
export const GROUPINGS = ["file", "rule"] as const;
export type Grouping = (typeof GROUPINGS)[number];

/**
 * What the runner is asked to do about the axis.
 *
 * `auto` lets the scheduler cost both ways per rule before spending anything;
 * the other two force one axis for everything, which is what the grouping
 * experiment needs in order to measure them against each other.
 */
export const GROUP_MODES = ["file", "rule", "auto"] as const;
export type GroupMode = (typeof GROUP_MODES)[number];

/**
 * Reserved rule-id prefix, for the structural probes `scan.ts` emits.
 *
 * Here rather than in `scan.ts` so that `rules.ts` can reject a user rule that
 * starts with it without importing the scanner. Before that check existed the
 * prefix was reserved by comment only: a rule id beginning with it had every
 * match routed into the probe stream, produced no subjects, and appeared in
 * the report as a `silent` rule with no explanation -- a silent matcher
 * failure, which is the one thing this design spends the most effort avoiding.
 */
export const PROBE_PREFIX = "__jev-lint_";

/**
 * What a suppression comment names: the rules it silences, or [] for all of
 * them.
 *
 * An empty list is "everything", not "nothing", because `jev-lint-ignore-file`
 * with no rule after it is the common case and has to mean the broad thing.
 */
export type IgnoreDirective = string[];

export const SEVERITIES = ["hint", "info", "warning", "error"] as const;
export type Severity = (typeof SEVERITIES)[number];

/**
 * `review` is the one that is not a finding: a subject under its cutoff but
 * over the rule's loose floor, listed for a reader when the run asked for
 * it with `--loose`, never counted and never blocking.
 */
export const MESSAGE_IDS = ["violation", "unsure", "flag", "missing", "review"] as const;
export type MessageId = (typeof MESSAGE_IDS)[number];

// --------------------------------------------------------------------- rules

/**
 * An ast-grep matcher, passed through untouched.
 *
 * Deliberately not modelled further. ast-grep owns this grammar, it is
 * recursive and it grows; a partial model here would reject valid matchers and
 * give a false sense that they had been checked. ast-grep validates it, and
 * rejects the whole rule set if it is wrong.
 */
export type Matcher = Record<string, unknown>;

/**
 * One branch of a noul's criteria, in either of two shapes.
 *
 * A sentence is the usual form. The structured form is what the vendor's own
 * review workflow sends: the defining sentence, a few examples of the branch,
 * and what the branch is NOT for. The wire accepts any JSON as a description,
 * so this is a validation choice rather than a protocol one -- a mapping is
 * limited to these three keys so a misspelt one is an error and not a field
 * the model silently never sees.
 */
export interface CriterionDetail {
  what: string;
  examples?: string[];
  not_for?: string;
}
export type Criterion = string | CriterionDetail;

/** A noul's two branches. Must be nested under `criteria` on the wire. */
export interface NoulCriteria {
  true: Criterion;
  false: Criterion;
}

/**
 * What every rule has, whatever its kind and its subject: its identity, the
 * grammars it reads, the sentence the model answers, the cutoff the answer
 * is gated at, and how a finding is reported. What differs is in
 * `RuleJudgment` and `RuleSource`; `Rule` is the three together.
 */
/** A `context:` document: its path as the rule file wrote it, and its text. */
export interface ContextDoc {
  path: string;
  text: string;
}

export interface RuleBase {
  id: string;
  /** The first of `languages`; kept for display and single-language callers. */
  language: Language;
  languages: Language[];
  ask: string;
  /** Context for the model only. Never shown in a finding. */
  note: string | null;
  /** The rule's own cutoff, or null to take the default for its kind. */
  at: number | null;
  /**
   * The floor of the `--loose` band: under the cutoff but at or over this,
   * the subject is listed for a reader. null means half the cutoff, which
   * on the shipped evals no visible defect falls under.
   */
  loose: number | null;
  state: StateArm;
  /**
   * Pin this rule to a batching axis, overruling the scheduler.
   *
   * Set it when a rule's cutoff was calibrated on one axis: the grouping can
   * move a verdict, so a rule that was measured on the file axis should not be
   * silently rescheduled onto the rule axis for a token saving. null means
   * "the scheduler may choose".
   */
  axis: Grouping | null;
  severity: Severity;
  unsureBelow: number | null;
  message: string | null;
  docs: string | null;
  tags: string[];
  /**
   * Why this language's copy of the id deliberately says something else.
   *
   * The sentence is a copy per language, and the loader warns when the
   * copies drift. A language whose failures are shaped differently --
   * MoonBit, where `raise` is in the type and the escape is `abort` --
   * cannot carry the same sentence, so it declares the reason here and the
   * warning stands down. Never read by the model: it is a note to whoever
   * edits the other copy next.
   */
  divergent: string | null;
  /**
   * Why this rule's own eval corpus cannot speak reliably about the rule
   * drifting, in either of the two symmetrical ways `evals.ts` scores:
   *
   * - **blind** -- both margins (FN-margin and FP-margin, the distance
   *   from the cutoff to the quietest labelled defect and the loudest
   *   labelled clean) are wide, despite fixtures genuinely aimed at the
   *   boundary: the corpus cannot see drift that happens.
   * - **unstable** -- a margin is narrower than that same case's own
   *   pass-to-pass spread: which side of the cutoff it lands on is
   *   decided by the run, not the rule, so the corpus reports drift that
   *   did not happen.
   *
   * A non-empty value suppresses `eval`'s failure for whichever of the two
   * applies and is shown in its place; null or empty on a rule that is in
   * fact blind or unstable fails, and so does a non-empty value on a rule
   * that is neither -- a stale exemption is worse than none. Never read by
   * the model. Named `inconclusive` rather than `blind`, its original name,
   * because it now covers both failure modes and neither name on its own
   * fit the other.
   */
  inconclusive: string | null;
  /**
   * Labels for a follow-up `choice`, asked of this rule's findings only when
   * the run is given `--explain`: which of these best names why the verdict
   * holds. Never part of the verdict question, so never part of the draft.
   */
  explain: Record<string, string> | null;
  /**
   * The rule this one was built from, as `<lang>/<id>` or a flat id, or null.
   * An extending rule is the base with the fields its own file gives laid
   * over it; this names the base so a report can say where the rest came from.
   */
  extends: string | null;
  /**
   * Documents the model reads beside the code, in the state: a project's
   * conventions the rule is judged against, which are not in the code under
   * review. Read from files named relative to the rule file, at load time,
   * so their text is part of the draft hash and an edited document retires
   * the verdicts that were given against the old one. null when there are
   * none.
   */
  context: ContextDoc[] | null;
  /**
   * The language directory the rule was loaded from under the shipped
   * layout (`rules/<lang>/<id>/rule.yml`), or null for any other rule
   * file. With the id, the rule's identity: `rust/fn-name-promises`.
   */
  languageDir: string | null;
  /** Where it was loaded from. Absent on rules built in memory. */
  source?: string;
  pack?: string;
}

/** What the answer is: a probability that the statement holds, or a level on a rubric. */
export type RuleJudgment =
  | {
      kind: "noul";
      /** The two branches; must be nested under `criteria` on the wire. */
      criteria: NoulCriteria;
      levels: null;
    }
  | {
      kind: "score";
      criteria: null;
      /**
       * The rule's own ordered rubric, clean to worst, in place of the
       * shared four-level scale; null takes the shared one. `at` then runs
       * 0..levels-1.
       */
      levels: string[] | null;
    };

/** Where the subjects come from: an ast-grep matcher, git, or a text file split at a header. */
export type RuleSource =
  | {
      subject: "node" | "enclosing" | "file";
      matcher: Matcher;
      constraints: Record<string, unknown> | null;
      utils: Record<string, unknown> | null;
      split: null;
      extensions: null;
    }
  | {
      /**
       * Two subjects with no matcher, both built from git.
       *
       * `commit`: the message is the subject and the diff is what it is
       * judged against. `change`: the change is the subject and the diff
       * plus the repository's instruction documents are its state, so it
       * exists before a commit does and `--staged` can produce one.
       */
      subject: "commit" | "change";
      matcher: null;
      constraints: null;
      utils: null;
      split: null;
      extensions: null;
    }
  | {
      subject: "block";
      matcher: null;
      constraints: null;
      utils: null;
      /**
       * The header regex, matched at the start of each line; its named
       * groups are the block's captures. null takes the whole file as one block.
       */
      split: string | null;
      /** The file extensions the rule applies to. */
      extensions: string[];
    };

/**
 * A validated, normalized rule: `RuleBase`, and then what its kind and its
 * subject decide. Narrow on `rule.kind` for `criteria` against `levels`,
 * and on `rule.subject` for a matcher rule's `matcher`, `constraints` and
 * `utils` against a block rule's `split` and `extensions` -- a commit rule
 * has neither. The other arm's fields are present as null rather than
 * absent, so a reader that does not narrow still sees one shape.
 */
export type Rule = RuleBase & RuleJudgment & RuleSource;

/** A rule whose subjects ast-grep finds: the only kind with a matcher. */
export type MatcherRule = Rule & { subject: "node" | "enclosing" | "file" };

export function isMatcherRule(rule: Rule): rule is MatcherRule {
  return !isGitSubject(rule.subject) && rule.subject !== "block";
}

/** The two subjects built from git rather than an ast-grep matcher; see the `RuleSource` union arm. */
export function isGitSubject(subject: SubjectMode): subject is "commit" | "change" {
  return subject === "commit" || subject === "change";
}

/** The result of validating one rule: the rule, or the reason it is not one, never both. */
export type RuleResult = { rule: Rule; error?: undefined } | { rule?: undefined; error: string };

// ------------------------------------------------------------------ ast-grep

export interface Position {
  line: number;
  column: number;
}

export interface Range {
  byteOffset: { start: number; end: number };
  start: Position;
  end: Position;
}

export interface MetaVarNode {
  text: string;
  range?: Range;
}

/** One match, as `ast-grep scan --json=stream` reports it. */
export interface AstGrepMatch {
  text: string;
  range: Range;
  file: string;
  language: string;
  ruleId: string;
  lines?: string;
  severity?: string;
  message?: string;
  metaVariables?: {
    single?: Record<string, MetaVarNode>;
    multi?: Record<string, MetaVarNode[]>;
    transformed?: Record<string, unknown>;
  };
}

// ------------------------------------------------------------------- symbols

/** A named container found by the structural probes. */
export interface SymbolInfo {
  name: string | null;
  role: string;
  /** Byte offsets, which is what containment is computed from. */
  start: number;
  end: number;
  /** 1-based, matching what a report shows. */
  line: number;
  endLine: number;
  text: string;
  exported: boolean;
  isTest: boolean;
  /** Within-file, by name occurrence. Approximate by design. */
  calls: string[];
  calledBy: string[];
}

export interface FileSymbols {
  language: string;
  symbols: SymbolInfo[];
  imports: string[];
  /** Ranges of `export` wrappers, used to resolve visibility by containment. */
  exportRanges: Array<[number, number]>;
}

export type SymbolIndex = Map<string, FileSymbols>;

export interface ModuleIdentity {
  path: string;
  stem: string;
  directories: string[];
  named_by_directory: string | null;
}

// ------------------------------------------------------------------ subjects

/** What `resolveSubject` determines about one match. */
export interface ResolvedSubject {
  text: string;
  /** Where the MATCH is. This is what a finding reports. */
  line: number;
  endLine: number;
  /**
   * Where the judged subject is, when it differs from the match.
   *
   * `subject: enclosing` judges the containing function but the finding still
   * points at the matched node, so the question needs the subject's own range
   * separately -- otherwise it would tell the model the wrong line numbers for
   * the code it was given.
   */
  subjectLine?: number;
  subjectEndLine?: number;
  /**
   * The matched node's own text, when the subject was promoted past it.
   *
   * A promoted subject is the container; this is the thing inside it the rule
   * actually selected. A question that omits it cannot say which of several
   * candidates in the container is under test.
   */
  matchText?: string;
  nodeKind: string;
  /**
   * The narrowest named thing around the match. For a test, `path` is every
   * suite and test around it from the outside in, titles as written: what
   * `it("leaves the others")` claims is only readable with the
   * `describe("cart") > describe("removeItem")` it sits in.
   */
  enclosing: { name: string | null; role: string; path?: string[] } | null;
  /** The `local` arm's context: the enclosing function, when there is one. */
  context?: string | null;
  contextName?: string | null;
  /** True when `subject: enclosing` moved the subject up to its container. */
  promoted: boolean;
  /** True when the subject is a module outline rather than code. */
  isOutline?: boolean;
  captured: Record<string, string>;
}

/** A resolved match, ready to be asked about. */
export interface Subject extends ResolvedSubject {
  rule: Rule;
  file: string;
  language: string;
  arm: StateArm;
  /** Present on a block cut to fit: how long the block was. */
  textCut?: { of: number };
  /**
   * Present on a commit subject: the change the message is judged against.
   * `file` is then the sha, `text` the message, `line` 1.
   */
  commit?: { files: string[]; stat: string; diff: string; truncated: boolean };
  /**
   * Present on a `subject: change` subject: the instruction documents the
   * diff is judged against, read from the same tree as the diff. A change
   * subject is never built without them.
   */
  instructions?: Instructions;
  /** Assigned when the subject is placed in a batch; meaningful only there. */
  id?: string;
  /** The content-addressed cache key. Assigned by the runner. */
  key?: string;
}

// ----------------------------------------------------------------- questions

export interface ScoreQuestion {
  type: "score";
  instructions: Record<string, unknown>;
  criteria: readonly string[];
}

export interface NoulQuestion {
  type: "noul";
  instructions: Record<string, unknown>;
  criteria: NoulCriteria;
}

/**
 * The follow-up, not a verdict: which of a rule's labels best names why a
 * finding holds. A choice discards ordering, which is why it is never used
 * for the verdict itself; a set of unordered mechanisms is what it is for.
 */
export interface ChoiceQuestion {
  type: "choice";
  instructions: Record<string, unknown>;
  criteria: Record<string, string>;
}

export type Question = ScoreQuestion | NoulQuestion | ChoiceQuestion;

/** A choice's answer: the label, how sure, and the mass on every label. */
export interface Choice {
  choice: string;
  confidence: number;
  probabilities: Record<string, number> | null;
}

/** A usable answer. Absent rather than zero when unusable. */
export interface Answer {
  value: number;
  /** A noul never carries one; a score does when the model returned one. */
  confidence: number | null;
  kind: RuleKind;
  probabilities?: Record<string, number> | null;
}

/** The server's reply to one request. */
export interface SystemOneResponse {
  model?: string;
  answers?: Record<string, unknown>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * The `state` object sent with a request.
 *
 * Typed loosely on purpose: the known sections are named so callers and tests
 * can read them without casting, and the index signature stays because the
 * state is JSON handed to a model rather than an interface with a contract.
 * Adding a section should not require a type change in three places.
 */
export interface StatePayload {
  language: string | string[];
  reviewing: string;
  subjects: Array<Record<string, unknown>>;
  file?: string;
  module?: ModuleIdentity | Record<string, unknown>;
  imports?: string[];
  symbols?: Array<Record<string, unknown>>;
  source?: string;
  enclosing_code?: Array<Record<string, unknown>>;
  /** The `paired` arm: excerpts of the tests related to the file. */
  related_tests?: Array<{ path: string; paired_by: string; code: string }>;
  /** A commit subject's state: the message, and the change it describes. */
  message?: string;
  files?: string[];
  stat?: string;
  diff?: string;
  /** A change subject's state: the project's own instruction documents, in place of a message. */
  instructions?: Array<{ file: string; text: string }>;
  /** The rule's `context:` documents: the conventions it is judged against. */
  context_documents?: ContextDoc[];
  note_on_context_documents?: string;
  note_on_diff?: string;
  note_on_instructions?: string;
  note_on_independence?: string;
  note_on_enclosing_code?: string;
  note_on_related_tests?: string;
  matcher?: string;
  [key: string]: unknown;
}

// ------------------------------------------------------------------- batches

export interface ArmFallback {
  from: StateArm;
  to: StateArm;
  reason: string;
}

export interface Batch {
  /** A file path under file grouping; a rule and file count under rule grouping. */
  file: string;
  group?: Grouping;
  rule?: string;
  arm: StateArm;
  language: string;
  subjects: Subject[];
  state: StatePayload;
  questions: Record<string, Question>;
  degraded: ArmFallback | null;
  estimatedTokens: number;
}

// ------------------------------------------------------------------ findings

export interface Finding {
  /** null when the answer was below the cutoff and nothing is reported. */
  messageId: MessageId | null;
  reported: boolean;
  rule: string;
  severity: Severity;
  file: string;
  line: number;
  endLine: number;
  at: number;
  value: number | null;
  confidence: number | null;
  kind?: RuleKind;
  /** A score's top level: 3 on the shared scale, levels-1 on a rule's own. */
  scale?: number;
  /** How far past its own cutoff, which is the only cross-rule ranking. */
  margin?: number;
  ask?: string;
  message?: string | null;
  docs?: string | null;
  text?: string;
  captured?: Record<string, string> | null;
  arm?: StateArm;
  level?: string;
  /**
   * Present when `--retry` asked more than once: how many passes put this
   * subject over its cutoff, out of how many asked, and the spread of the
   * answers. `value` is then the MEAN, which is what the decision used.
   *
   * A finding that reproduced in every pass and one that appeared in a single
   * pass are different claims, and the second is the one the calibration
   * discipline says not to automate.
   */
  passes?: { over: number; of: number; spread: number };
  /** Present on a reported finding when `--explain` asked its rule's follow-up. */
  explanation?: { choice: string; confidence: number };
  /** Present on a commit finding: the commit's subject line, for the report. */
  commit?: { subject: string };
  /**
   * Present on a change finding: the stat's summary line, for the report.
   * A change subject's `text` is the stat, not a message -- reporting it
   * under `commit.subject`, quoted as if someone wrote it, would claim a
   * commit message that does not exist.
   */
  change?: { summary: string };
  /** Present when the block was cut to fit: the verdict is about its first `judged` of `of` characters. */
  cut?: { judged: number; of: number };
  /**
   * Present on a `subject: change` finding: the instructions the attribution
   * pass could point at, with the answer each one got. A finding with none
   * is retracted rather than printed, so this is never empty.
   */
  violates?: Array<{ file: string; line: number; breadcrumb: string; body: string; value: number }>;
}

export interface GateStats {
  subjects: number;
  reported: number;
  missing: number;
  unsure: number;
  /** Subjects in the `--loose` band; 0 when the run did not ask for it. */
  review: number;
  byRule: Record<string, number>;
  /** Findings and subjects per file: the density a reader groups a long report by. */
  byFile: Record<string, { findings: number; subjects: number }>;
}

/** What suppression comments removed from a run, for reporting. */
export interface IgnoreStats {
  /** Subjects never asked about because a suppression covered them. */
  subjects: number;
  /** Files suppressed whole. */
  files: string[];
  /** Rule ids named in a suppression that no loaded rule answers to. */
  unknownRules: string[];
}

/**
 * What the `paired` arm could not pair: subjects dropped because their file
 * has no related test to look at, and the files they were in.
 */
export interface UnpairedStats {
  subjects: number;
  files: string[];
}

export interface GateResult {
  findings: Finding[];
  all: Finding[];
  /**
   * The `--loose` band, closest to its cutoff first, capped at what the run
   * asked for. Apart from `findings` so nothing that reads findings -- the
   * exit code, `--fail-on`, the counts -- ever sees one.
   */
  review: Finding[];
  stats: GateStats;
}

// --------------------------------------------------------------------- cache

export interface CacheEntry {
  value: number;
  confidence: number | null;
  kind: RuleKind;
  rule?: string;
  draft?: string;
  arm?: StateArm;
  file?: string;
  line?: number;
  at?: string;
}

// ----------------------------------------------------------------- reporting

export interface Spend {
  calls: number;
  inputTokens: number;
  outputTokens?: number;
  /** The sum of every request's latency; with requests in flight together, more than the run took. */
  ms: number;
  /** What the asking took end to end. */
  wallMs?: number;
  retried?: number;
  /** 429s met, each waited out and sent again. */
  rateLimited?: number;
  /** The paced input-token rate as the run ended, per second. */
  tokensPerSecond?: number;
  splits?: number;
  usd: number;
}

export interface RunError {
  file: string;
  subjects: number;
  error: string;
}

/** Everything a report, a record or a replay needs from one pass. */
/** One pass's answer to one subject, as an eval records it. */
export interface Sample {
  rule: string;
  file: string;
  line: number;
  endLine: number;
  kind: Answer["kind"] | null;
  value: number | null;
  confidence: number | null;
}

export interface RunResult extends GateResult {
  rules: Rule[];
  group?: GroupMode;
  subjects: Subject[];
  batches: Batch[];
  cache?: unknown;
  errors?: RunError[];
  stderr?: string;
  skippedByDiff?: number;
  /** Subjects under an `exclude` path, never judged. */
  excluded?: number;
  /** Languages whose rules were dropped for want of a declared parser. */
  undeclared?: string[];
  duplicateGrammars?: number;
  ignored?: IgnoreStats;
  unpaired?: UnpairedStats;
  /** Present in commits mode: how many commits the range held, and how many merges were skipped. */
  commits?: { total: number; skippedMerges: number; range: string; noInstructionDoc: number };
  /** How many times everything was asked; above 1 with `--retry`. */
  retry?: number;
  /**
   * Every answer of every pass, before the mean: one list per pass, one
   * entry per subject asked in it. What an eval records, so that a record
   * carries the samples and not only the decision.
   */
  samples?: Sample[][];
  /** Present when `group: "auto"`: what the scheduler decided, and why. */
  schedule?: unknown;
  cachedCount: number;
  spent: Spend;
  servedModel?: string | null;
  elapsedMs?: number;
  dryRun?: boolean;
}

/**
 * What a report needs: a gate result, plus whatever else the caller happens to
 * have.
 *
 * A live run has batches, spend and a cache; a replay of a recorded run has
 * answers and thresholds and nothing else. Demanding the full `RunResult` would
 * force a replay -- and every test -- to invent batches and token counts that
 * no formatter reads, so the optional half is optional in the type too.
 */
export type ReportInput = GateResult & Partial<Omit<RunResult, keyof GateResult>>;

// ----------------------------------------------------------------- labels

/** One corpus label. `window` is a line tolerance, not an exact match. */
export interface Label {
  line: number;
  label: "bad" | "clean";
  rule?: string;
  window?: number;
  reason?: string;
}

/**
 * A label file: paths to labels, plus `$default` for everything unmarked.
 *
 * The `$`-prefixed keys are metadata rather than paths, which is why lookups
 * have to skip them.
 */
export interface Labels {
  $default?: "bad" | "clean" | "unlabeled";
  $note?: string;
  /** The spellings `expect.yml` uses; `relocateLabels` folds them into the `$` forms. */
  default?: "bad" | "clean" | "unlabeled";
  note?: string;
  [path: string]: Label[] | string | undefined;
}
