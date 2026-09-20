---
description: Judge the commit messages on this branch against their diffs, and the PR description against the whole branch
argument-hint: "[--base <ref>] [--squash]"
---

Run jev-lint's commit rule on this repository and report what it found,
judged, not just listed.

1. Confirm `TYPESAFE_API_KEY` (or `TYPESAFEAI_API_KEY`) is set. If not, stop
   and say so.
2. Plan first, spend nothing: `npx -y jev-lint commits $ARGUMENTS --dry-run`.
   With no `--base`, this is `@{upstream}..HEAD`; `--base main` is the
   branch. Report the commit count and price; a commit marked `diff cut to
   fit` will be judged on its stat and the first hunks.
3. Run it: `npx -y jev-lint commits $ARGUMENTS --retry 3 --loose 5`.
4. For every finding, open the commit (`git show <sha>`) and say which it is:
   the message overclaims, the diff carries something the message should
   have said, or the rule is wrong. One line each, with the short sha.
   `1/3 passes` is a coin flip; say so.
5. If `--squash` was asked for, or the branch has a pull request, judge the
   description against the whole branch:
   `gh pr view --json title,body -q '.title + "\n\n" + .body' | npx -y jev-lint commits --squash --base <base> --message-file -`
   and report the same way. The subject there is the range, not a commit.
6. Do not rewrite pushed history to fix a message. Say what the message
   should have said.
