# jev-lint as a git hook

Two hooks, two different questions.

| | what it judges | what it costs | `jev-lint init` |
| --- | --- | --- | --- |
| `pre-commit` | the staged diff, with the file rules | a fraction of a cent per commit | `--pre-commit` |
| `pre-push` | each commit's message against its diff | a fraction of a cent per commit pushed | `--pre-push` |

Both print what they find. **Neither blocks**, until you decide one of your
rules has earned it. That is the whole posture: a probabilistic reviewer
that can fail a build is a probabilistic reviewer that gets switched off.

## Install

```bash
export TYPESAFE_API_KEY=...        # or TYPESAFEAI_API_KEY
npx -y jev-lint init --pre-commit
npx -y jev-lint init --pre-push
```

Each writes one script into the repository's hooks directory. The directory
is asked of git (`git rev-parse --git-path hooks`) rather than assumed to be
`.git/hooks`, so a worktree's hooks land in the main repository and
`core.hooksPath` is honoured.

An existing hook is never overwritten without `--force`. It is probably
husky's or a task runner's, and the right move there is one line added to
it, which `init` prints for you:

```
.git/hooks/pre-commit already exists; pass --force to overwrite it, or add this line to it:
  npx -y jev-lint review --staged --fail-on error
```

The hooks are not tracked by git, so every clone installs them again. If
that matters, call `jev-lint` from whatever your repository already uses to
manage hooks (below) instead of installing these.

## What each one does

### `pre-commit`

```sh
npx -y jev-lint review --staged --fail-on error
```

`review --staged` scans only the files the commit will contain and keeps
only the matches whose subject overlaps a changed line. On a repository
where `check` would cost dollars, this costs a fraction of a cent, because
almost nothing in a commit is a subject.

Two things to know about `--staged`:

- It judges a **partially staged file as it is on disk**. The matcher reads
  files, not the index, so a file you staged half of is judged whole. The
  finding may be about a line you did not stage.
- Untracked files are not in it. A new file you have not `git add`ed is
  invisible to the hook and will be judged by the next commit that adds it.

### `pre-push`

```sh
npx -y jev-lint commits '@{upstream}..HEAD' --fail-on error
```

This is the other question: does each commit's message tell the truth about
its diff. One request per commit, and the verdict cache keys on the message
and the diff together, so amending a message re-asks and rebasing without
changing anything does not.

`@{upstream}` is the current branch's upstream **as it is now**. A branch
that has never been pushed has none, and the hook steps aside rather than
block the first push of every branch. That means the first push of a branch
is never judged; the second one judges everything on it.

## When it does nothing

Both hooks exit 0 and say why, rather than failing, when:

- **there is no API key in the environment.** `TYPESAFE_API_KEY` or
  `TYPESAFEAI_API_KEY`. A contributor without a key can still commit.
- **(pre-push only) the branch has no upstream yet.**

Both are deliberate. A hook that breaks committing for anyone who has not
set up an API key is a hook the team removes.

## When it blocks

Only `--fail-on error`, and **no shipped rule ships at `severity: error`**.
So out of the box, nothing blocks: you get the findings printed and the
commit goes through.

To make a rule blocking, give it `error` in `.jev-lint.yaml` — after it has
earned it on your own code, not before:

```yaml
rules:
  comment-describes-declaration: { at: 0.7, severity: error }
```

Read [calibration](../.claude/skills/jev-lint/references/calibration.md)
before you do. About one finding in five was wrong on measured code, and a
rule at its shipped cutoff is fitted to *this* package's corpus, not yours.

Skip a hook once:

```bash
git commit --no-verify
git push --no-verify
```

Remove one by deleting the file.

## Exit codes

| | |
| --- | --- |
| 0 | clean, or nothing over `--fail-on` |
| 1 | something was reported at or above `--fail-on` |
| 2 | configuration error — a bad config, an unknown rule id, no range |
| 3 | requests failed; **this is not a clean run** |

### Exit 3 blocks the hook, and that is worth knowing before you install one

A run whose requests failed has no verdict about your code, and it must not
read as approval — hence 3 rather than 0. But git blocks on *any* non-zero
exit, and the hooks these commands are installed as end in `exec`, so **a
failed request stops the commit or the push**:

```
$ jev-lint review --staged --fail-on error   # with an expired key
0 finding(s), 68 subject(s), 68 without a verdict
1 request(s) failed:
  src/instructions.ts (1 subject(s)): HTTP 401: ...
$ echo $?
3
```

Offline, an expired key, a rate-limit storm, the service down: all of them
are exit 3, and all of them stop you committing. A missing key steps aside;
a *broken* one does not.

Until that is fixed in the shipped hook, if this matters to you, install a
body that lets 3 through and keeps the rest:

```sh
#!/bin/sh
if [ -z "$TYPESAFE_API_KEY" ] && [ -z "$TYPESAFEAI_API_KEY" ]; then
  exit 0
fi
npx -y jev-lint review --staged --fail-on error
status=$?
# 3 is "the requests failed", which is not a verdict about this commit.
# Blocking on it means being unable to commit while offline.
[ "$status" -eq 3 ] && exit 0
exit "$status"
```

The output still says `N without a verdict`, and that line is never noise:
it is how you know the run had nothing to say rather than nothing to
report.

## Hooks you already have

If the repository uses husky, lefthook, pre-commit, pkfire or a Makefile,
do not install these scripts. Add the command:

```yaml
# lefthook.yml
pre-commit:
  commands:
    jev-lint:
      run: npx -y jev-lint review --staged --fail-on error
pre-push:
  commands:
    jev-lint:
      run: npx -y jev-lint commits '@{upstream}..HEAD' --fail-on error
```

```pkl
// Taskfile.pkl
hooks {
  ["pre-commit"] { "npx -y jev-lint review --staged --fail-on error" }
  ["pre-push"] { "npx -y jev-lint commits '@{upstream}..HEAD' --fail-on error" }
}
```

```json
// package.json, with husky
{ "scripts": { "lint:jev": "jev-lint review --staged --fail-on error" } }
```

`npx -y` fetches the published package. Inside a repository that depends on
`jev-lint`, drop the `npx -y` and let the local install answer, so the hook
and CI agree on a version.

## Making it cheaper, or quieter

**Narrow the rules.** A config with no `rules:` runs nothing; the starter
`jev-lint init` writes lists every shipped rule, which is a catalogue to
prune, not a recommendation. Hooks are where an over-broad list is felt.

**Narrow the paths.** `files:` in `.jev-lint.yaml` applies to `review` too:
the hook scans only the changed files under those paths.

**Check the price before you feel it.** `--dry-run` makes no request:

```bash
git add -A && npx -y jev-lint review --staged --dry-run
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
