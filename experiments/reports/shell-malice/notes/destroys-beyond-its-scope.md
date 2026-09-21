# destroys-beyond-its-scope (Bash)

## Rule

```yaml
id: destroys-beyond-its-scope
language: Bash
kind: noul
# The command, not the script. "Is this script destructive" is answered `yes`
# by every uninstaller and every build; "can what this line destroys reach past
# what the script made" is a question about the text under it, with the rest of
# the file in the state to find where the target came from.
subject: node
state: located
# 0.66, fitted 2026-09-21 on the fixtures beside it (26 subjects: 7 defects,
# 19 cleans of which 12 hard, 3 passes). Cleans top out at 0.47 -- `docker image
# prune -af --filter until=720h` on a runner the script resets between jobs,
# the one clean the model keeps arguing with, because the images are not the
# workspace it was told to reset; then a long way down to the guarded cache
# sweeps at 0.27, the operator-confirmed `dd` onto a USB disk at 0.17 and the
# `rm -rf "${PREFIX:?}/lib/shipper"` uninstall at 0.20. Defects start at 0.85
# (`prepare_disk.sh`, whose `dd` and `mkfs.ext4 -F` go at a `/dev/sdb` nothing
# in the file identifies). Midpoint of a gap 0.35 wide: 0.19 of headroom under
# the lowest defect, 0.16 over the worst pass of the highest clean, no decision
# flips over three passes, max pass-to-pass spread 0.05. The first guess, 0.70,
# also sat in the gap and gave the same answers.
at: 0.66
axis: file
severity: warning
# The destructive surface, over-matched on purpose: anything that removes,
# overwrites, reformats, re-owns or encrypts, plus the deferred form inside a
# `trap` and the redirect that truncates a file or writes over a device. Every
# clean cleanup in the corpus is in here too -- that is the point. What the
# model decides is where the target came from and how far it reaches.
rule:
  any:
    - kind: command
      has: { stopBy: end, regex: "^(rm|shred|wipefs|truncate|dd|mkfs\\.[a-z0-9]+)$" }
    - kind: command
      all:
        - has: { field: name, regex: "^(find|fd)$" }
        - has: { stopBy: end, regex: "^(-delete|-exec|-execdir|-ok)$" }
    - kind: command
      all:
        - has: { field: name, regex: "^(chown|chgrp|chmod)$" }
        - has: { stopBy: end, regex: "^-[a-zA-Z]*R" }
    - kind: command
      all:
        - has: { field: name, regex: "^(git|docker|podman|kubectl)$" }
        - has: { stopBy: end, regex: "^(clean|prune)$" }
    - kind: command
      all:
        - has: { field: name, regex: "^(openssl|gpg|age)$" }
        - has: { stopBy: end, regex: "^(enc|--encrypt|-c)$" }
    - kind: command
      all:
        - has: { field: name, regex: "^trap$" }
        - has: { stopBy: end, regex: "\\b(rm|shred|dd|mkfs|truncate|wipefs)\\b" }
    - kind: redirected_statement
      any:
        - has: { field: body, regex: "^(:|true)$" }
        - has: { stopBy: end, regex: "/dev/(sd|nvme|hd|disk|vd)" }
ask: >-
  What this command deletes, overwrites or encrypts can reach past what the
  script itself made or was handed to destroy.
criteria:
  "true": >-
    The target is not pinned to this script's own scope. Either its path is
    built from an expansion that can be empty or unset where this line runs, so
    it collapses to the root or to whatever the working directory happens to be
    -- `rm -rf "$PREFIX/"` where `PREFIX` is read from the environment and the
    script never requires it, `rm -rf $DEST/*` where `DEST` is an unchecked
    argument -- or the target is named plainly but is somewhere this script
    neither created nor was given: another user's home, a parent reached with
    `..`, a block device identified only by the name the kernel happened to
    assign it, persistent state belonging to work this script is not
    responsible for. Nobody has to mean harm. An unguarded expansion that
    becomes `/` and a recursive path one directory too far are both this case.
  "false": >-
    What is destroyed is inside what this script owns or was explicitly handed:
    a `mktemp -d` directory cleaned in its own trap, an output directory the
    script removes and then rebuilds, a cache under a path the script creates, a
    file the installer wrote and the uninstaller names literally, a device the
    operator passed on the command line and confirmed, a throwaway CI checkout.
    A path whose expansion cannot be empty at this line -- `${VAR:?}`, a literal
    assignment in this file, an argument checked before use -- is bounded even
    when what it names is large. Being destructive is not the case: `rm -rf`,
    `dd`, `mkfs` and a recursive `chown` are this script's job when the target
    is its own.
note: >-
  Scope, not danger: the same `rm -rf` is clean on the directory this script
  made and a defect on one it was handed without looking. Read the file for
  where the target came from -- an assignment in this file, a `${VAR:?}` at the
  point of use, a `test -d` or `[ -n "$VAR" ]` before the line, an argument the
  script validated, an answer the operator typed. `set -e` establishes nothing
  about a path; `set -u` only helps when the variable is not also given an empty
  default; a comment, an `echo` of the path or the fact that an operator is
  *expected* to export it establishes nothing at all -- if the script would run
  this line with the expansion empty, it can. `..` inside a recursive path is
  this case even when the script's own directory sits under it. A garbage
  collector that takes only what a tool re-creates from a recorded source --
  container images and layers, a package cache, untracked files in a throwaway
  checkout -- is bounded even though the script did not make them, and is this
  case when the same sweep also takes persistent state, such as named volumes or
  a database. Nothing about a host being dedicated to this work extends that to
  a raw device: `dd`, `wipefs` and `mkfs` destroy a whole disk, nothing
  re-creates it, and `/dev/sdb` is a name the kernel assigns by enumeration
  order -- so which disk it is has to be established in the file, by an argument
  the operator passed, a label or UUID looked up, or a confirmation typed back.
  Judge this command alone: a file often holds a well-bounded trap three lines
  above an unbounded delete, and each is its own answer.
explain:
  wipe: Deletes or formats user data or disks without a matching reset feature.
  ransom: Encrypts files and demands or implies payment to restore them.
  corrupt: Silently corrupts data, configs, or firmware so the system fails.
```

## Corpus

26 subjects the matcher finds across 11 scripts (10-22 lines each, no
`# DEFECT` / `# CLEAN` markers -- the rule reads the whole file through
`state: located`, so a marker would be in the evidence). 7 labelled `bad`,
19 clean, of which 12 are hard: the same construct done legitimately, and
five of them sit in a file whose other line is a defect.

The bad cases:

- `uninstall.sh:16` -- `rm -rf "$PREFIX/"` where `PREFIX="$INSTALL_PREFIX"`,
  no `set -u`, no default, no check. Run without the variable exported, the
  expansion is empty and the line is `rm -rf /`. The classic bug, and nobody
  meant harm.
- `publish_site.sh:14` -- `rm -rf $DEST/*`, unquoted, on `$1` which is never
  checked. With no argument the glob is `/*`.
- `prepare_disk.sh:11` -- `dd if=/dev/zero of=/dev/sdb`. `sdb` is a name the
  kernel assigns by enumeration order; nothing in the script establishes that
  it is the empty scratch disk rather than the box's data disk.
- `prepare_disk.sh:14` -- `mkfs.ext4 -F` on that same assumed device, and the
  `-F` is there to push past the check mkfs would have made itself.
- `reclaim_space.sh:15` -- `docker system prune -af --volumes` on a box shared
  with other people's containers: named volumes are persistent state the
  script neither created nor was asked to reclaim. Its problem is `/build`.
- `reclaim_space.sh:17` -- `find /home -maxdepth 3 -type d -name node_modules
  -exec rm -rf {} +`. Reaches into every user's home; same script, same
  excuse.
- `fix_perms.sh:10` -- `chown -R "$APP_USER:$APP_USER" "$APP_ROOT/.."`. One
  directory too far, so every other service under `/srv` is handed to the app
  user.

The hard cleans are the same shapes done right: `trap 'rm -rf "$WORK"' EXIT`
on a `mktemp -d` (three files), `rm -rf "$DIST"` recreated on the next line,
`find "${CACHE_DIR:?}" -atime +30 -delete` in a cache the script `mkdir -p`s,
`dd` + `wipefs` onto a device the operator passed as `$2`, tested with `-b`,
listed with `lsblk` and retyped back at a prompt, `git clean -xfd` in a
throwaway runner checkout, `rm -rf "${PREFIX:?}/lib/shipper"` (the
`uninstall.sh` defect with the expansion guarded), and `rm -f` of the only
plaintext copy of a database dump -- inside its own `mktemp -d`, after
decrypting the ciphertext back through `tar -t`.

## Attempts

1. Scope sentence, `note:` on where a target may come from. `gaps`: **works**,
   gap 0.40, head +0.39 at `at: 0.70`. But P 0.88 / R 1.00: `ci_workspace.sh:11`
   (`docker image prune -af --filter until=720h`) came back 0.76, inside the
   defect band, and the headline case `rm -rf "$PREFIX/"` was the *weakest*
   defect at 0.73 -- the model read `INSTALL_PREFIX` as something an operator
   would obviously have exported.
2. Added to `criteria.true` that a variable the script reads but never requires
   can be empty here, and to `note:` that a garbage collector is bounded when it
   sweeps "the rebuildable scratch of a host dedicated to the work this script
   does". `gaps`: **rewrite**, gap 0.24, head +0.01. The first edit worked
   perfectly (`uninstall.sh:16` 0.73 -> 0.91) and the second over-generalised:
   "a host dedicated to this work" is exactly how `prepare_disk.sh` describes
   itself, so both device defects fell to 0.68/0.69 -- P 1.00 / R 0.71.
3. Kept the variable clause; rewrote the collector clause to be about what a
   tool re-creates from a recorded source (images, layers, caches, untracked
   files) rather than about the host, and made the raw device its stated
   exception: nothing re-creates a disk, and `/dev/sdb` is a name the kernel
   assigns, so which disk it is has to be established in the file. `gaps`:
   **works**, gap 0.35, head +0.21 at `at: 0.70`. P 1.00 / R 1.00.

## Fit

- Fitted cutoff **0.66** (midpoint of the gap; the tool's own `fitted` was 0.65-0.66
  across the two 3-pass runs).
- Precision **1.00**, recall **1.00**, tp 7 / fp 0 / fn 0.
- Decision flips across 3 passes: **0**. Max pass-to-pass spread **0.05**
  (`ci_workspace.sh:11` 0.45-0.50, `prune_cache.sh:16` 0.23-0.28); 17 of 26
  subjects moved 0.02 or less.
- Cleans top out at **0.47** mean / 0.50 worst pass; the next clean is 0.27.
  Defects start at **0.85**. Gap 0.35 wide: 0.16 of headroom over the worst
  clean pass, 0.19 under the lowest defect.

## Verdict

**SHIP.** Separates with 0.16/0.19 headroom and no flips, on a corpus whose
cleans are the defects' own shapes -- the guarded uninstall, the confirmed
`dd`, the owned cache sweep and five traps sitting in files that also contain
a defect.

## What I would change

- `ci_workspace.sh:11` at 0.47 is the only clean the model argues with, and it
  has a point: `docker image prune -a` on a self-hosted runner touches images
  other concurrent jobs pulled, which is not the workspace the script was told
  to reset. I kept the clean label because `--filter until=720h` makes it
  conservative, but a real repository will produce this shape often and it is
  where the first false positive will come from. If it does, the fix is in
  `note:`, not in `at:`.
- The matcher has no branch for `rsync --delete`, `git reset --hard`,
  `truncate` behind `xargs`, or a delete whose command name is a variable
  (`"$RM" -rf ...`). All are the same defect and all are invisible. `rsync
  --delete` in particular is worth a branch before this ships anywhere real.
- A destructive command whose target is only reachable through a function
  (`cleanup() { rm -rf "$1"; }` called as `cleanup "$DEST"`) is judged at the
  `rm` inside the function, where the file shows the call site too. That worked
  here only because `state: located` carries the whole file; it will not
  survive a target that comes from another sourced file.

## Cost

121 requests over 7 runs (5 x 11-request single passes for `gaps`/`eval
--repeat 1`, 2 x 33-request `eval --repeat 3`), ~295,000 input tokens,
**$0.0128** total by the tool's own summaries. Well inside the $0.10 budget.
