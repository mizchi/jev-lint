# Rewriting a branch with interactive rebase, one operation at a time

This tutorial walks through `git rebase -i` by doing the same thing five times: start from a known branch, run one rebase operation, look at the log, and check that the tree at the tip is unchanged. Each round introduces one more operation. Do them in order; every round assumes the branch state the previous one left.

## Setup

Make a throwaway repository with five commits on a branch:

```
git init rebase-lab && cd rebase-lab
git commit --allow-empty -m "root"
git switch -c feature
for n in 1 2 3 4 5; do echo "line $n" >> notes.txt; git add notes.txt; git commit -m "add line $n"; done
git log --oneline
```

You should see six lines: `add line 5` at the top, `root` at the bottom. Record the tree hash of the tip; we will compare against it after every round:

```
git rev-parse HEAD^{tree}
```

Write that hash down. Call it `T`.

## Round 1: reorder

Open the last five commits:

```
git rebase -i HEAD~5
```

The editor shows five `pick` lines, oldest first. Move the line for `add line 3` below `add line 4`, save, quit.

Check the log: `add line 3` now sits above `add line 4`. Check the tree:

```
git rev-parse HEAD^{tree}
```

It equals `T`. Reordering commits that touch different lines of the same file does not change the final content, only the history. If you had reordered two commits that edit the same line, git would have stopped with a conflict, and the tree would only match `T` after you resolved it the same way.

## Round 2: reword

Open the last five commits again. Change `pick` to `reword` on the `add line 1` line, save, quit. A second editor opens with the message `add line 1`; change it to `add the first line`, save, quit.

Check the log: the message changed, and so did every commit hash above it, because each commit's hash includes its parent. Check the tree: still `T`. Reword changes a message and nothing else, but it rewrites every descendant.

## Round 3: squash

Open the last five commits. Change `pick` to `squash` on the `add line 5` line, which is the last one. Save, quit. An editor opens with both messages, `add line 4` and `add line 5`; replace them with `add lines 4 and 5`, save, quit.

Check the log: four commits above `root` instead of five. Check the tree: still `T`. Squash folds a commit into the one above it in the list, keeping both changes and letting you write one message. The difference from `fixup` is only that `fixup` discards the folded commit's message without asking.

## Round 4: edit

Open the last four commits. Change `pick` to `edit` on the `add line 2` line. Save, quit. The rebase stops with `add line 2` checked out and prints `Stopped at ... add line 2`.

Now amend that commit:

```
sed -i.bak 's/^line 2$/line 2 (amended)/' notes.txt && rm notes.txt.bak
git add notes.txt
git commit --amend --no-edit
git rebase --continue
```

Check the log: same four commits. Check the tree: it is **not** `T`. `edit` is the one operation in this tutorial that changes content, and the tree hash is how you know. Every later commit was replayed on top of the amended one, and since they append lines rather than touching line 2, there was no conflict. If there had been one, `git rebase --continue` would have stopped again and asked you to resolve it.

Set a new reference tree:

```
git rev-parse HEAD^{tree}
```

Call this `T2`.

## Round 5: drop

Open the last four commits. Delete the line for `add line 3` entirely, or change `pick` to `drop`. Save, quit.

Check the log: three commits above `root`. Check the tree: not `T2`, because `line 3` is gone from the file. Dropping a commit removes its change from every later state. Look at the file:

```
cat notes.txt
```

You should see `line 1`, `line 2 (amended)`, `line 4`, `line 5`. If a dropped commit's change had been depended on by a later commit, the replay of that later commit would have conflicted, and the conflict is git telling you the drop was not clean.

## Getting back

Every round rewrote history, and every previous tip is still in the reflog:

```
git reflog
git reset --hard feature@{5}
```

`feature@{5}` is where the branch pointed five reflog entries ago. Verify with `git rev-parse HEAD^{tree}`, which should be `T` again. Nothing a rebase does is lost until the reflog expires, which by default is 90 days.

## Summary of what each operation does to the tree

| operation | changes messages | changes order | changes content | tree hash after |
| --- | --- | --- | --- | --- |
| reorder | no | yes | no (unless conflict) | same |
| reword | yes | no | no | same |
| squash | yes | no | no | same |
| edit | optional | no | yes | different |
| drop | no | no | yes | different |

The "check the tree" step is the point of doing this five times: it is a one-line test that tells you whether a rebase touched content, and it is worth running after every real rebase, not just these.
