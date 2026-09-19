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
   With no `--base`, this diffs the uncommitted changes; pass
   `--base main` (or the branch's merge base) to review a branch. Report the
   subject count and price. If it is more than a few cents, ask before
   continuing.
3. Run it: `npx -y jev-lint review $ARGUMENTS --retry 3`
4. For every finding, open the code and decide which of three things it is,
   per the jev-lint skill: the code is wrong, the *name* (or comment) is wrong,
   or the rule is wrong. Say which, in one line each, with the file and line.
   A finding marked `1/3 passes` is a coin flip; say so rather than acting.
5. Report the two lines that are never noise if they appeared: rules that
   matched nothing beyond the expected other-language variants, and subjects
   without a verdict.

Do not silence findings with `jev-lint-ignore` comments unless asked. Do not
edit `at:` in the rules to make a finding go away; propose a refit instead.
