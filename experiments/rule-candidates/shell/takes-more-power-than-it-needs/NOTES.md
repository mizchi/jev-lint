# takes-more-power-than-it-needs (Bash)

A port of `permission_abuse` from [luantak/is-malicious](https://github.com/luantak/is-malicious),
built to the shape the shell pack settled on: `subject: node`, `state: located`,
one verdict per command with the whole script behind it.

## Rule

```yaml
id: takes-more-power-than-it-needs
language: Bash
kind: noul
# The command, not the script. An installer is supposed to use sudo, so "does
# this script abuse privilege" is a question about a whole program's intent
# and answers itself with the file's tone; "does the work this one command
# does need the power it takes" is a question about the text under the cursor,
# with the rest of the script in the state to say what the work is.
subject: node
state: located
# 0.54, fitted 2026-09-21 on the fixtures beside it (32 subjects: 8 defects,
# 24 cleans of which 11 hard, 3 passes). Cleans top out at 0.37 -- `docker run
# --rm --user root -v "$PWD:/w"` two lines above the privileged container that
# is a defect in the same file, which is both the adjacency cost and a real
# argument, since container root is still root -- and at 0.32 behind it a
# `sudo systemctl status` that only reads. Every other clean is 0.25 or under,
# including two that are a defect's exact shape done right: `sudo chown -R
# root:root` at a system path a bad global install left operator-owned (0.25),
# and `exec sudo -E "$0" "$@"` in a provisioner whose whole body is apt-get and
# /etc (0.11) -- the same text as the defect at 0.76 in `render_thumbnails.sh`,
# 0.65 apart on the file alone. Then nothing until 0.72, where the defects
# start (`setcap cap_sys_admin,cap_dac_override` on a latency probe, the
# softest because a probe does legitimately need capabilities -- just not
# those). Midpoint of a gap 0.36 wide, 0.17 of headroom below and 0.18 above,
# no decision flips over three passes, widest pass-to-pass spread 0.04.
threshold: 0.54
axis: file
severity: warning
# Five places a shell script can acquire power, over-matched on purpose: a
# command run under another identity, a bit left on a file after the process
# exits, a capability set, a container handed the host, and group membership
# that carries root with it. Matching is by token rather than by command
# name, because `sudo rm -rf` and `exec sudo "$0" "$@"` are ONE command node
# named `sudo` and `exec`, so a `field: name` regex finds neither. Every
# branch is `kind: command`, so a node that trips two of them is still one
# subject and a pipeline or a redirect around it adds none.
rule:
  any:
    - kind: command
      has: { stopBy: end, regex: "^(sudo|doas|su|pkexec|runuser|gosu|setpriv|chroot)$" }
    - kind: command
      all:
        - has: { stopBy: end, regex: "^(chmod|install|chown|chgrp)$" }
        - has: { stopBy: end, regex: "(\\+s$|^0?[2-7][0-7]{3}$|^root(:[A-Za-z0-9_-]+)?$|^0:0$)" }
    - kind: command
      has: { stopBy: end, regex: "^(setcap|capsh)$" }
    - kind: command
      all:
        - has: { stopBy: end, regex: "^(docker|podman|nerdctl)$" }
        - has: { stopBy: end, regex: "(^--privileged$|^--pid=host$|^--ipc=host$|^--userns=host$|^--cap-add|^--security-opt$|^--user(=root)?$|^-u$|^root$|^/:/)" }
    - kind: command
      all:
        - has: { stopBy: end, regex: "^(usermod|gpasswd|adduser|dseditgroup)$" }
        - has: { stopBy: end, regex: "(^-aG$|^-G$|sudo|wheel|admin|docker|root)" }
ask: >-
  This command takes more power than the work the rest of the script shows it
  doing, takes it without the operator being asked, or leaves it behind on the
  machine after the script exits.
criteria:
  "true": >-
    The privilege acquired here is wider than the step it is acquired for, or it
    outlives the run. A script that re-execs itself as root while everything it
    then does happens under the invoking user's own directories; a `sudo` on a
    step -- a build, a test, a copy into the working tree, a download -- that has
    no reason to need it; root handed to bytes the script did not check, as in a
    download piped into `sudo sh`; a setuid or setgid bit, a `4755`-style mode, or
    a capability set far wider than the one thing the binary needs; a container
    given `--privileged`, the host's PID namespace, or `/` as a volume in order to
    do work that its own filesystem could do; the invoking account added to
    `sudo`, `wheel` or `admin` by a script whose job was something else; the
    product's own data left owned by root so that the non-root program that owns
    it can no longer write it. Escalation that the file never explains is this
    case even when each line reads like ordinary administration, and so is
    escalation at the top of a script that goes on to need none of it.
  "false": >-
    The power matches the work this file shows. An installer, a provisioner, a
    service roll or a package step takes root because it writes `/etc`, `/opt`,
    `/usr/local` or the package database, and the file shows it doing exactly
    that; a single escalation at the top of a script whose whole body is
    privileged work; `sudo systemctl restart` of the unit this script installs.
    Also this case when the command gives power UP rather than taking it: running
    the payload as a service account through `su -`, `sudo -u`, `setpriv`,
    `runuser` or `gosu`; `install -o root -m 0755` of a binary into a system path,
    which makes the file unwritable rather than the process powerful; a capability
    granted so the program does NOT have to be root; a probe such as `sudo -n
    true` used to decide whether to ask; group membership that is the host's
    declared purpose; a throwaway container given kernel privilege because the
    work inside it IS kernel work. And this case when the command only inspects
    -- `id`, `getcap`, a status read.
note: >-
  `opens-a-backdoor` is about granting access to somebody ELSE -- a key, an
  account, a sudoers entry that lets a principal in. This rule is about the power
  THIS script takes for its own work: escalating without the operator asking,
  taking root for steps that do not need it, or leaving the machine more powerful
  than it found it. A line can be both; answer only the second question here.
  Privilege, not danger: `sudo` is the ordinary way a shell script writes a system
  path, and a file full of it is not this case by its shape. Read what the
  command's own step does and ask what of it required the power -- the answer is
  in the paths it touches and in what the rest of the file then does with root.
  Scope the judgement to the target, not to what the script calls itself: a header
  comment saying "provisioning" establishes nothing, and neither does `set -euo
  pipefail`, an interactive password prompt, a `-n`/`--non-interactive` flag, a
  `trap` that cleans up, or a comment saying the step needs root. Escalation that
  is announced in the line above it and then used for privileged work is the
  announced case; escalation that is announced and then used for nothing is still
  this case. A capability is narrower than root and a setuid bit is not: prefer
  reading `cap_net_bind_service` as a reduction and `cap_sys_admin` or `+s` as a
  substitute for root. Judge a container by what it is handed and by what its own
  work needs, not by the flag: a `--rm` container that mounts only this step's
  inputs and outputs and is given kernel access because the work inside it is
  kernel work -- loop devices, filesystems, partitions, namespaces -- holds that
  power for its own step and gives it back when it exits. A container handed the
  host's root filesystem, the host's PID namespace or the host's user namespace
  has reached back out of the sandbox, and that is this case whatever the work
  is. Container root is not host root: `--user root` inside an image with no host
  mount stays inside the image.
explain:
  silent_escalate: Escalates privileges or writes authorization rules without a matching user action.
  oversized_scope: Requests broad access that the visible features do not need.
  persist_admin: Leaves lasting admin or root access the product does not require.
```

## Corpus

13 files, 32 subjects found: **8 bad**, 24 clean, of which **11 are hard** --
the defect's own shape done legitimately. No `# DEFECT` / `# CLEAN` markers
anywhere; `expect.yml` carries the labels and the arguments.

The eight defects:

| subject | defect |
| --- | --- |
| `render_thumbnails.sh:6` | `exec sudo "$0" "$@"` at the top of a script whose every path is a relative `./media` / `./thumbs` and whose only work is `convert`. Root is taken and never used for anything that needed it. `silent_escalate` |
| `render_thumbnails.sh:20` | `chown -R root:root` of the media library and the thumbnails, so the non-root service that owns those files can no longer write them. `persist_admin` |
| `install_metrics_agent.sh:16` | `chmod 4755` leaves the agent setuid root for every user on the box; the unit two lines below starts it as a service, so nothing in the file needs a user-triggered escalation. `persist_admin` |
| `ci_sandbox.sh:10` | `--privileged --pid=host -v /:/host` to run a unit test suite -- the container is handed the whole machine to do work an ordinary bind mount does. `oversized_scope` |
| `install_probe.sh:7` | `curl … \| sudo bash -`: root handed to bytes the script never sees, let alone checks. `silent_escalate` |
| `install_probe.sh:9` | `setcap cap_net_raw,cap_net_admin,cap_sys_admin,cap_dac_override+eip` on a latency probe. It needs the first; `cap_sys_admin` is root in all but name, permanently, on a file. `oversized_scope` |
| `publish_site.sh:10` | `sudo usermod -aG sudo,adm "$(whoami)"` while publishing a static site: nothing asked, nothing needs it, the membership outlives the run. `persist_admin` |
| `build_release.sh:13` | one unnecessary `sudo` on a `tar` of an operator-owned `mktemp -d` into `./dist`, which leaves the release artifact root-owned so the next non-root build of the same tree fails. The softest defect in the corpus, deliberately. `oversized_scope` |

The eleven hard cleans, each the shape of one of those defects:

- `provision_ci_host.sh:8` -- **the same text as `render_thumbnails.sh:6`**,
  `exec sudo -E "$0" "$@"`, with the reason in the two comment lines above and a
  body of `apt-get`, `/opt`, `/etc`, `systemctl`. The whole rule is this pair.
- `fix_node_prefix.sh:9` -- `sudo chown -R root:root`, the shape of
  `render_thumbnails.sh:20`, at `/usr/local/lib/node_modules`: a system path
  that is *supposed* to be root-owned, being restored.
- `install_gateway.sh:8` -- `setcap`, the shape of `install_probe.sh:9`, but
  `cap_net_bind_service=+ep` is granted so the gateway does **not** run as root.
- `build_image.sh:10` -- `docker run --rm --privileged`, the same flag as
  `ci_sandbox.sh:10`, for a recipe that runs `losetup` and `mkfs`.
- `ci_sandbox.sh:8` -- `docker run --user root` two lines above that defect, in
  the same file, with only `$PWD` mounted.
- `install_metrics_agent.sh:13` / `install_gateway.sh:7` -- `install -o root -g
  root -m 0755` into a system path: the mode makes the *file* unwritable, not
  the process powerful. The first sits three lines above the `chmod 4755`.
- `entrypoint_api.sh:13` / `:10` -- `setpriv --reuid=app` and `su - app -c`:
  privilege moving down.
- `backup_db.sh:9` -- `sudo su - postgres`, which reads as a double escalation
  and is a descent.
- `install_gateway.sh:10` -- `sudo -u gateway` to validate the config.
- `deploy_worker.sh:8` -- `sudo -n true`, a probe that takes nothing.
- `deploy_worker.sh:14` -- `sudo systemctl restart` of the unit the script exists
  to roll; `provision_ci_host.sh:16` -- `usermod -aG docker runner` on a CI host
  whose declared purpose is running containers as `runner`.

Four ordinary constructs sit two or three lines from a defect in the same file
(`install_metrics_agent.sh:18,19`, `publish_site.sh:12`, `install_probe.sh:11`)
to price the adjacency effect the pack reports.

## Attempts

| # | change | gaps verdict | gap | cleanTop | defect floor |
| --- | --- | --- | --- | --- | --- |
| 1 | first sentence, 28 subjects (10 files) | `works` | 0.38 | 0.35 | 0.72 |
| 1b | same sentence, corpus hardened to 32 subjects: the legitimate `--privileged` image build, the legitimate `chown -R root:root`, and one soft defect | — (eval) | **inverted** | **0.76** | 0.72 |
| 2 | `note:` clause on containers rescoped from the flag to what the container is handed; one clause added to `criteria.false` | — (eval) | 0.36 | 0.37 | 0.72 |

Attempt 1 separated cleanly, and it separated because the corpus was not hard
enough. Adding `build_image.sh` -- a `--rm` container given `--privileged`
because its recipe needs loop devices -- broke it: that clean answered **0.76**,
*above* two of the eight defects, and there was no separating cutoff.

The cause was in my own `note:`, which ended "`/` mounted in, the host's PID
namespace, or `--privileged` reaches back out". That is a rule about the flag,
and every `--privileged` in the corpus matches it. Rewritten as a property of
the **target** -- what the container is handed, and whether its own work is
kernel work -- exactly as `destroys-beyond-its-scope` reports for its garbage
collector: the image build fell **0.76 → 0.20**, and the `-v /:/host --pid=host`
defect stayed at **0.95**. One clause, one case moved, nothing else disturbed.

Only one sentence attempt was needed on `ask:` / `criteria:`; the second attempt
was spent entirely on the note. The third was not used.

## Fit

Fitted cutoff **0.54** (midpoint of the clean/violation gap), 32 subjects,
3 passes:

- precision **1.00**, recall **1.00** -- tp 8, fp 0, fn 0
- decision flips across the 3 passes: **0**
- widest pass-to-pass spread on any one subject: **0.04** (`build_release.sh:13`,
  `ci_sandbox.sh:8`, `fix_node_prefix.sh:10`, `install_metrics_agent.sh:19`)
- cleans top out at **0.37** (`ci_sandbox.sh:8`, the container-root install two
  lines above a defect), then 0.32, then nothing above 0.25
- defects start at **0.72** (`install_probe.sh:9`, the over-broad capability set)
  and run to 0.95
- gap **0.35**, headroom **0.17** below the cutoff and **0.18** above

Baseline accepted at draft `d9c2ae3a94c8`; `eval --replay` reproduces the same
decisions.

## Verdict

**SHIP.** The corpus contains three pairs where the defect and the clean case
are the *same command text* and only the file separates them -- `exec sudo "$0"
"$@"` (0.76 vs 0.11), `chown -R root:root` (0.79 vs 0.25), `setcap` (0.72 vs
0.12) -- and the rule puts 0.35 to 0.65 between each pair with no flips. The
cutoff at 0.54 is the third-highest in the pack, which is the corpus saying what
it should: `sudo` is not evidence, and the answer is always in the surroundings.

## What I would change

- **The `--user root` clean is my ceiling and it is only half clean.** At 0.37,
  `docker run --user root` in the same file as a privileged defect is both the
  adjacency cost the pack describes and a defensible finding in its own right --
  container root can still write a bind mount as root. If this rule's headroom
  ever needs widening, that subject is the one to split into two cases (with and
  without a writable host mount) rather than to argue down.
- **The `usermod` branch double-books with `opens-a-backdoor`.** Both matchers
  fire on `usermod -aG sudo X`. The notes divide them (somebody else vs. this
  script's own power) and the corpus shows the division holding, but a file that
  adds *another* account to `sudo` will now produce two findings that say almost
  the same thing. Worth measuring on real code before both ship together.
- **Four matcher branches have no labelled case behind them at all**: `doas`,
  `pkexec`, `capsh`, `dseditgroup`, and the `--security-opt` / `--userns=host` /
  `--cap-add` arms of the container branch. They are on the risk surface by
  argument, not by evidence.
- **Two regexes are load-bearing and fragile.** `^0?[2-7][0-7]{3}$` distinguishes
  `4755` from `0755` by arithmetic on the string (`0755` fails because the
  optional `0` leaves only three digits for a four-digit tail), which is correct
  but reads like an accident; and `^root(:[A-Za-z0-9_-]+)?$` misses
  `chown -R 0:0` spelled `--owner=root`. A `chown` whose target is behind a
  variable is invisible, the same blind spot the pack reports for redirects.
- **No real-code evidence yet.** This surface (`sudo`, `docker run`, `setcap`)
  is far more common in ordinary development scripts than the backdoor and
  reverse-shell surfaces that matched nothing in the pack's 40-script sweep, so
  this rule is the one most likely to produce the pack's first real false
  positive. Run it over those 40 scripts before promoting.

## Cost

127 model requests across 7 paid runs (`gaps` ×1, `eval --repeat 1` ×4,
`eval --repeat 3` ×2), ~39k input tokens per 32-subject pass, **$0.018 total**
by the tool's own summaries. The `--dry-run --show-subjects` iterations and the
final `--replay` were free.

One operational note for the pack: `eval` without `--cache none` returned
`0 request(s)` and a table of `null` values twice, once silently accepting a
baseline of nothing. Always pass `--cache none`, and check
`baseline.json` for nulls before believing an accept.
