# A diff judged against the instructions the repository wrote for itself

2026-09-21. Approved in conversation; this is the record.

## Why

`AGENTS.md` and `CLAUDE.md` are where a repository writes down what a
contributor -- human or agent -- is supposed to do. Nothing checks them. A
diff that adds the dependency the file forbids, writes into the module the
file calls generated, or ships the change without the test the file
requires, passes every linter in the repository, because the claim it
violates is a sentence in a markdown file and the violation is a semantic
one. That is the class this tool exists for, and the shipped `git` pack
covers only the other commit-level claim -- the message against its diff.

[jev-pref](https://github.com/doeixd/jev-pref) reaches the same place from
the other side: it turns `AGENTS.md` preferences into Jev checks, but by
hand-translating each preference into a concrete question, because
"does this follow AGENTS.md?" is, in its own words, the shape of a poor
question. This design keeps its boundary -- only instructions whose
evidence is visible in the change are judged -- while keeping the
translation mechanical, so an existing `AGENTS.md` works unedited.

## What is new

1. `subject: change` -- a commit rule whose subject is the change, not the
   message, so it also runs before a commit exists.
2. The instruction documents in the state of a `change` subject, read from
   the same tree as the diff.
3. `rules/git/diff-follows-instructions/` -- one rule, with fixtures and a
   fitted cutoff.
4. An attribution pass that names which instruction a finding is about, and
   retracts a finding it cannot attribute.
5. `jev-lint commits --staged`, and hook bodies under `.jev-lint/hooks/`
   with `.git/hooks/*` reduced to a shim.

## 1. `subject: change`

`subject: commit` means the message is the subject and the diff is what the
message is judged against. A rule about the diff's content does not fit
that: at `pre-commit` time there is no message at all, and a subject whose
text is the empty string is a question with nothing in it.

| | subject text | state carries | built by |
| --- | --- | --- | --- |
| `commit` | the commit message | diff, stat, files | `commits <range>` |
| `change` | the change: stat and file list | diff, stat, files, instructions | `commits <range>`, `commits --staged` |

- Both are built in `src/commits.ts` and travel the road every other
  subject travels: a batch, a state, a question, a verdict, a finding.
- `commitSubjects` produces both kinds from one `git show`; the diff is
  fetched once per commit and shared.
- `--staged` produces `change` subjects only. A `commit` rule needs a
  message, and the staged tree has none, so the exclusion is by rule
  `subject` and needs no new flag.
- A finding on a `change` subject reports `<sha>:1`, as a `commit` finding
  does; under `--staged` the ref is `staged`.
- `captured.SUBJECT` on a `change` subject is the stat's summary line
  (`7 files changed, 120 insertions(+), 12 deletions(-)`), so a rule can
  refer to the size of the change without the message.
- `subjectFields` in `src/questions.ts` sends `message:` for a `commit`
  subject. A `change` subject sends `change:` -- the stat -- instead, and
  never the message: a rule that is not about the message must not be
  handed one to be distracted by.
- `commit-message-describes-diff` is unchanged. It stays `subject: commit`,
  keeps its cutoff and its baseline, and never sees the instructions.

`RuleSource` gains a `subject: "change"` arm beside `"commit"`, with the
same null matcher. `isMatcherRule` excludes both.

## 2. Instructions in the state

A `change` subject carries the instruction documents as they were **in the
tree the diff belongs to**:

```
git show <sha>:AGENTS.md
git show <sha>:CLAUDE.md
```

and, under `--staged`, the staged content (`git show :AGENTS.md`, the
index, so a staged edit to `AGENTS.md` is judged as part of the change it
arrives with).

- Repository root only. Nested `AGENTS.md` is out of scope for this
  design.
- Both files when both exist. If their contents are identical, or one is
  a single line referring to the other, the duplicate is dropped -- the
  common `CLAUDE.md -> AGENTS.md` symlink must not double the tokens.
- Missing from the tree: **no subject**. A commit in a repository with no
  instructions produces no `change` subject at all, the way the `paired`
  arm produces no subject for a file with no related test. It is not a
  clean verdict and it is not a finding; it is a question there was no
  ground to ask.
- Budget: 24,000 characters across the documents, cut at a line boundary,
  the first document kept whole where possible. When cut, the state says
  so in `note_on_instructions`, in the shape `note_on_diff` already uses.

The commit state in `src/state.ts` gains:

```
instructions: [ { file: "AGENTS.md", text: "..." }, ... ]
```

and its `reviewing` line says the diff is judged against the instructions
rather than against a message.

## 3. The rule

`rules/git/diff-follows-instructions/rule.yml`, `subject: change`,
`kind: noul`, `state` is not applicable (a commit state has no arms).

The sentence, in substance:

> This change does something the project's own written instructions forbid,
> or leaves out something they require of a change like this one.

`criteria.true` names the shape of the violation: the change uses a
construct, dependency, path or pattern the instructions name and rule out;
it edits a file the instructions call generated or owned elsewhere; it
makes a change of a kind the instructions require something alongside (a
test, a changelog entry, a type declaration) and that thing is absent from
the diff.

`criteria.false` carries the boundary, and is the half that decides whether
this rule is usable:

- An instruction about *how the work was done* rather than what the change
  contains -- "develop with TDD", "ask when the instruction is unclear",
  "read the skill before starting" -- is not judged here. The diff cannot
  show it.
- An instruction whose terms the change cannot be checked against -- "keep
  it readable", "separate concerns" -- is not judged here. Wanting it to
  be true is not evidence that it is false.
- An instruction a conventional tool already enforces -- formatting, lint,
  types -- is not judged here.
- A change that simply does not touch the subject of any instruction is
  clean, not unverified.

`note` says the instructions are the standard and the diff is the
evidence: whether the instructions are good ones is not the question.

`at:` is fitted from the rule's own evals, not guessed. The first
committed value carries the run it came from, as every shipped rule's
does.

## 4. The attribution pass

A finding that says "this violates the instructions" without naming which
instruction is not actionable. The pass runs after the verdicts, on
findings of `change` rules only, and is modelled on `explainFindings`
(`src/run.ts:666`): same state, a request of its own, nothing cached.

**Splitting.** The documents are split into directives mechanically, no
model involved:

- Headings are not directives. Each heading becomes part of the breadcrumb
  prefixed to the directives under it (`# コード設計 > `).
- A top-level list item is one directive; its nested children are folded
  into it, because a nested bullet is usually a qualification of its
  parent and splitting them makes both unanswerable.
- A paragraph outside a list is one directive.
- A fenced code block attaches to the directive above it.
- Every directive keeps `file` and the line it started on.

**Asking.** One `noul` per directive, all of them in one request against
the batch's existing state, which already holds the diff and the
documents. The question is the generic one with the directive supplied as
the thing to check; splitting is by `askSplitting` as everywhere else.

**Deciding.** Directives at or over the rule's cutoff are attached to the
finding as `violates: [{ file, line, text, p }]`, and the report prints
them under the finding. If no directive clears the cutoff, **the finding is
retracted to `review`**: the first pass is a cheap gate, and a violation
nobody can point at is not one worth reporting. This trades recall in the
first pass for precision in what is printed, deliberately.

The pass is not optional for this rule, because the finding is not useful
without it. Its cost is one extra request per flagged commit; clean commits
pay nothing.

## 5. Fixtures

`rules/git/diff-follows-instructions/fixtures/<case>/{message,before/,after/}`,
the existing commit-fixture shape. What is new is that each case puts its
own `AGENTS.md` in `before/` and `after/`, so a case defines the policy it
is judged under and the cases stay independent of one another.

Defects to cover: a forbidden dependency added; a generated file edited by
hand; a required companion (test, changelog line) missing from a change
that the instructions say requires it; an instruction added in the same
commit that the rest of the commit already violates.

Hard cleans to cover: a change that touches the subject of an instruction
and honours it; a document made mostly of procedural instructions over a
diff that has nothing to do with them; an instruction a linter already
enforces; a change to `AGENTS.md` itself.

`jev-lint eval rules/git/diff-follows-instructions --repeat 3 --accept`
fits `at:` and writes `baseline.json`.

## 6. Hooks under `.jev-lint/hooks/`

`init --pre-commit` and `init --pre-push` today write the whole script into
git's hooks directory, where it is untracked and invisible to review. They
will instead write the body into the repository and leave a shim behind:

```
.jev-lint/hooks/pre-commit      the script, tracked, reviewable
.jev-lint/hooks/pre-push
<git hooks dir>/pre-commit      exec the above, if it is there
```

The shim:

```sh
#!/bin/sh
hook="$(git rev-parse --show-toplevel)/.jev-lint/hooks/$(basename "$0")"
[ -x "$hook" ] || exit 0
exec "$hook" "$@"
```

- A missing or non-executable body exits 0 silently. A fresh clone has the
  body and no shim, which is the state `init` fixes; a shim left behind
  after the body is deleted must not break committing.
- `--force` and the "already exists, add this line" path keep their
  current meaning, and now name `.jev-lint/hooks/<name>` as the thing to
  call.
- Bodies:
  - `pre-commit`: `jev-lint review --staged --fail-on error`, then
    `jev-lint commits --staged --fail-on error`.
  - `pre-push`: `jev-lint commits '@{upstream}..HEAD' --fail-on error`.
- Both keep today's behaviour of stepping aside with no API key.

## Testing

- `commits.ts`: `change` subjects from a range and from the index;
  instruction discovery, the duplicate drop, the budget cut, and the
  no-document case producing no subject.
- The splitter: nested bullets folded, code fences attached, breadcrumbs,
  line numbers preserved, a document with no directives.
- `state.ts`: `instructions` present, `note_on_instructions` on a cut.
- `run.ts`: attribution attaches `violates`; a finding with no directive
  over the cutoff is retracted to `review`.
- `rules.ts`: `subject: change` loads and validates; a `change` rule with
  a matcher is a load error.
- `init`: the body lands under `.jev-lint/hooks/`, the shim is written and
  is executable, the shim exits 0 with no body.
- The rule's own evals, which is what decides whether it works at all.

## Out of scope

Nested `AGENTS.md`; instruction documents named anything else; a `sync`
command that translates instructions into concrete rules the way jev-pref
does; judging pull-request descriptions against instructions.
