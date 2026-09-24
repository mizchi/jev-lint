---
description: Run jev-lint review on the current branch's diff and read the findings against the code
argument-hint: "[--base <ref>] [paths...]"
---

Run jev-lint in review mode on this repository and report what it found,
judged, not just listed.

1. Confirm `TYPESAFE_API_KEY` (or `TYPESAFEAI_API_KEY`) is set in the
   environment. If not, stop and say so; nothing below can run without it.
2. Plan first, spend nothing:
   `npx -y jev-lint review $ARGUMENTS --dry-run`
   With no `--base`, this diffs the uncommitted changes including untracked
   files; `--staged` diffs what the next commit will contain; `--base main`
   (or the branch's merge base) reviews a branch. Report the subject count
   and price. If it is more than a few cents, ask before continuing.
3. Run it: `npx -y jev-lint review $ARGUMENTS --retry 3 --loose 10`
4. For every finding, open the code and decide which of three things it is,
   per the jev-lint skill: the code is wrong, the *name* (or comment) is wrong,
   or the rule is wrong. Say which, in one line each, with the file and line.
   A finding marked `1/3 passes` is a coin flip; say so rather than acting.
5. Then the section `under a cutoff but over its loose floor -- for a reader`:
   these are not findings and did not count. They answered under the rule's
   cutoff but over a floor no clean subject on the rule's own evals reached,
   so the rule cannot say and you can. Read them the same way, closest to the
   cutoff first, and report only the ones where the code or the name is
   actually wrong; say nothing about the rest. Never suggest lowering `threshold:`
   because of one of these.
6. Report the two lines that are never noise if they appeared: rules that
   matched nothing beyond the expected other-language variants, and subjects
   without a verdict.

Do not silence findings with `jev-lint-ignore` comments unless asked. Do not
edit `threshold:` in the rules to make a finding go away; propose a refit instead.
