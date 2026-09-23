# jev-lint as a git hook

Two hooks, two different questions.

| | what it judges | what it costs | `jev-lint init` |
| --- | --- | --- | --- |
| `pre-commit` | the staged diff against the file rules, and against the project's own instructions (AGENTS.md / CLAUDE.md) | a fraction of a cent per commit | `--pre-commit` |
| `pre-push` | each commit's message against its diff, and each commit's change against the project's instructions | a fraction of a cent per commit pushed | `--pre-push` |

Both print what they find. **Neither blocks**, until you decide one of your
rules has earned it. That is the whole posture: a probabilistic reviewer
that can fail a build is a probabilistic reviewer that gets switched off.

## Install

```bash
export TYPESAFE_API_KEY=...        # or TYPESAFEAI_API_KEY
npx -y jev-lint init --pre-commit
npx -y jev-lint init --pre-push
```

Each writes **two files**: the hook itself, into the repository at
`.jev-lint/hooks/<name>`, tracked and reviewable like any other file; and a
four-line shim at `<git hooks dir>/<name>` that finds it and runs it. The
shim is the only thing `init` ever writes outside the repository, and it
holds no policy of its own -- delete `.jev-lint/hooks/pre-commit` and the
shim exits 0 and says nothing, rather than failing every commit.

Both paths are asked of git (`git rev-parse --git-path hooks`, `git
rev-parse --show-toplevel`) rather than assumed to be `.git/hooks` and the
current directory, so a worktree's hooks land in the main repository and
`core.hooksPath` is honoured.

The **hook** -- `.jev-lint/hooks/<name>` -- is never overwritten without
`--force`; it is the file someone may have hand-edited.

The **shim** is a separate question, and `--force` does not reach it. `init`
writes it whenever it is missing, which is the case this solves: a fresh
clone has the tracked hook and none of git's own hooks, because git does not
clone those. If a shim is already there and is not this tool's -- it is
probably husky's or a task runner's -- it is left alone and the one line to
add to it is printed, **with or without `--force`**. Git's hooks directory
is shared, `--force` is about the body, and someone refreshing their own
hand-edited body has not agreed to lose another tool's. Replacing it is a
deletion you do yourself:

```
.git/hooks/pre-commit already exists and was left alone; add this line to it:
  "$(git rev-parse --show-toplevel)"/.jev-lint/hooks/pre-commit
```

Committing `.jev-lint/hooks/` means every clone gets the hook back the
moment someone there runs `jev-lint init --pre-commit` again -- no shared
hook-manager config to keep in sync, just a file in the tree.

## What each one does

### `pre-commit`

`.jev-lint/hooks/pre-commit` runs two checks against what is staged:

```sh
npx -y jev-lint review --staged --fail-on error
npx -y jev-lint commits --staged --fail-on error
```

`review --staged` scans only the files the commit will contain and keeps
only the matches whose subject overlaps a changed line. `commits --staged`
asks the other question `--staged` can ask: does this change break an
instruction the repository wrote for itself, in AGENTS.md or CLAUDE.md. On
a repository where `check` would cost dollars, each of these costs a
fraction of a cent, because almost nothing in a commit is a subject.

Two things to know about `--staged`:

- **`review --staged` judges a partially staged file as it is on disk.**
  Its matcher reads files, not the index, so a file you staged half of is
  judged whole. The finding may be about a line you did not stage.
  `commits --staged` does not share this: its subject is the diff itself,
  read from the index (`git diff --cached`), so it sees exactly what would
  be committed.
- **Untracked files are not in either one.** Both stay inside `git diff
  --cached`'s view. A new file you have not `git add`ed is invisible to the
  hook and will be judged by the next commit that adds it.

### `pre-push`

`.jev-lint/hooks/pre-push` runs:

```sh
npx -y jev-lint commits '@{upstream}..HEAD' --fail-on error
```

This is the other question: does each commit's message tell the truth about
its diff. One request per commit, and the verdict cache keys on the message
and the diff together, so amending a message re-asks and rebasing without
changing anything does not. A `commit`-subject rule and a `change`-subject
rule both run per commit off this one call -- with the shipped rules, that
is the message-vs-diff question above and the same AGENTS.md / CLAUDE.md
question `pre-commit` asks, now asked of every commit about to be pushed
rather than only what is staged right now.

`@{upstream}` is the current branch's upstream **as it is now**. A branch
that has never been pushed has none, and the hook steps aside rather than
block the first push of every branch. That means the first push of a branch
is never judged; the second one judges everything on it.

## When it does nothing

Both hooks exit 0 and say why, rather than failing, when:

- **there is no API key in the environment.** `TYPESAFE_API_KEY` or
  `TYPESAFEAI_API_KEY`. A contributor without a key can still commit.
- **a request fails outright** -- offline, an expired key, a rate-limit
  storm, the service down. See below.
- **(pre-push only) the branch has no upstream yet.**
- **(both, at the shim) `.jev-lint/hooks/<name>` is missing or not
  executable.** A fresh clone, or one where the hook was deleted on
  purpose, can still commit and push.

All of these are deliberate. A hook that breaks committing for anyone who
has not set up an API key, or whose key has expired, or who cloned before
running `init`, is a hook the team removes.

## When it blocks

Only `--fail-on error`, and **no shipped rule ships at `severity: error`**.
So out of the box, nothing blocks: you get the findings printed and the
commit goes through.

To make a rule blocking, give it `error` in `.jev-lint.yaml` — after it has
earned it on your own code, not before:

```yaml
rules:
  typescript/comment-describes-declaration: { at: 0.7, severity: error }
```

Read [calibration](../.claude/skills/jev-lint/references/calibration.md)
before you do. About one finding in five was wrong on measured code, and a
rule at its shipped cutoff is fitted to *this* package's corpus, not yours.

Skip a hook once:

```bash
git commit --no-verify
git push --no-verify
```

Remove one by deleting `.jev-lint/hooks/<name>`; the shim left behind in
git's hooks directory exits 0 on its own once the file it looks for is gone.

## Exit codes

| | |
| --- | --- |
| 0 | clean, or nothing over `--fail-on` |
| 1 | something was reported at or above `--fail-on` |
| 2 | configuration error — a bad config, an unknown rule id, no range |
| 3 | requests failed; **this is not a clean run** |

### Exit 3 does not block the shipped hook

A run whose requests failed has no verdict about your code, and it must not
read as approval — hence 3 rather than 0:

```
$ jev-lint review --staged --fail-on error   # with an expired key
0 finding(s), 68 subject(s), 68 without a verdict
1 request(s) failed:
  src/instructions.ts (1 subject(s)): HTTP 401: ...
$ echo $?
3
```

git fails a hook on *any* non-zero exit, so a body that simply `exec`s the
command would let a failed request stop every commit -- offline, an expired
key, a rate-limit storm, the service down, all of them. The body `init`
writes checks the exit code itself and lets a 3 through while still
blocking on a real 1 or 2:

```sh
npx -y jev-lint review --staged --fail-on error
status=$?
if [ "$status" -ne 0 ] && [ "$status" -ne 3 ]; then
  exit "$status"
fi
```

The output still says `N without a verdict`, and that line is never noise:
it is how you know the run had nothing to say rather than nothing to
report.

## Hooks you already have

If the repository uses husky, lefthook, pre-commit, pkfire or a Makefile,
do not run `jev-lint init --pre-commit` / `--pre-push` -- those write into
git's own hooks directory, which your hook manager already owns. Add the
command instead, pointing it at the same two checks:

```yaml
# lefthook.yml
pre-commit:
  commands:
    jev-lint:
      run: npx -y jev-lint review --staged --fail-on error && npx -y jev-lint commits --staged --fail-on error
pre-push:
  commands:
    jev-lint:
      run: npx -y jev-lint commits '@{upstream}..HEAD' --fail-on error
```

```pkl
// Taskfile.pkl
hooks {
  ["pre-commit"] { "npx -y jev-lint review --staged --fail-on error && npx -y jev-lint commits --staged --fail-on error" }
  ["pre-push"] { "npx -y jev-lint commits '@{upstream}..HEAD' --fail-on error" }
}
```

```json
// package.json, with husky
{ "scripts": { "lint:jev": "jev-lint review --staged --fail-on error" } }
```

`npx -y` fetches the published package. Inside a repository that depends on
`jev-lint`, drop the `npx -y` and let the local install answer, so the hook
and CI agree on a version. Written this way, exit 3 does block -- the
exit-3 handling above is what `.jev-lint/hooks/` carries, not something
`&&`-chained commands get for free; if that matters to your hook manager,
check `$?` the same way the shipped body does.

## Making it cheaper, or quieter

**Narrow the rules.** A config with no `rules:` runs nothing; the starter
`jev-lint init` writes lists every shipped rule, which is a catalogue to
prune, not a recommendation. Hooks are where an over-broad list is felt.

**Narrow the paths.** `files:` in `.jev-lint.yaml` applies to `review` too:
the hook scans only the changed files under those paths.

**Check the price before you feel it.** `--dry-run` makes no request:

```bash
git add -A && npx -y jev-lint review --staged --dry-run
npx -y jev-lint commits --staged --dry-run
npx -y jev-lint commits '@{upstream}..HEAD' --dry-run
```

**Suppress what you have judged.** Any comment syntax, first thing on the
line:

```ts
// jev-lint-ignore-next-line fn-name-promises
// jev-lint-ignore-file
```

A suppressed subject is never sent, so it also saves its tokens. Every run
prints how many were skipped, and calls out a suppression naming a rule id
that does not exist.

**Keep the cache.** `.jev-lint/baseline.json` by default. A subject whose
text and rule have not changed is not re-asked, which is most of a second
commit touching the same file. Do not commit it; it is a cache, not a
baseline of accepted findings.

## Hooks are not CI

A hook judges what one person is about to do, on their machine, with their
API key. CI judges what arrives on the branch, once, for everyone:

```yaml
- run: npx -y jev-lint review --base "$GITHUB_BASE_REF" --format github
  env:
    TYPESAFE_API_KEY: ${{ secrets.TYPESAFE_API_KEY }}
```

`--format github` annotates the diff. It emits `warning` unless the rule
says `severity: error`, which is the same default the hooks have.

Use both, or use CI alone. The argument for the hook is that a finding
about a comment you just wrote is worth more while you still remember
writing it. The argument against is that it spends someone else's money on
every commit.

<!-- jev-lint-ignore-next-line section-opens-with-an-agenda -->
## See also

- [reference.md](reference.md) — every flag, every config key
- [the jev-lint skill](../.claude/skills/jev-lint/SKILL.md) — writing rules,
  judging findings
- [calibration](../.claude/skills/jev-lint/references/calibration.md) —
  before you give a rule `severity: error`
