# opens-a-backdoor (Bash)

Port of `authentication_bypass` from github.com/luantak/is-malicious. In shell
the backdoor is not a code path, it is an account or a key: something the script
grants that the script itself cannot account for.

## Rule

```yaml
id: opens-a-backdoor
language: Bash
kind: noul
# The grant, not the script. A provisioning script is supposed to create users
# and install keys, so "is this script a backdoor" is a question about a whole
# program's intent; "does the script account for who this one grant lets in" is
# a question about the text under it, with the rest of the file in the state to
# answer it from.
subject: node
state: located
# 0.50, fitted 2026-09-21 on the fixtures beside it (27 subjects: 7 defects,
# 20 cleans of which 9 hard, 3 passes). Cleans top out at 0.26 -- the `useradd
# runner` three lines above two defects in `bootstrap_ci.sh`, which is what
# `state: located` costs: a clean construct next to a bad one reads a little
# worse -- and at 0.24 behind it the deploy key appended to authorized_keys that
# came out of `aws secretsmanager` for the user the script names. Every other
# clean is at 0.07 or under, including the narrow sudoers drop-in five lines above
# the `NOPASSWD: ALL` one. Then nothing until 0.71, where the defects start
# (`useradd -m -s /bin/bash support` in a renderer entrypoint, the softest of them
# because the line alone reads like ordinary administration; that `NOPASSWD: ALL`
# for a user nothing creates tops the corpus at 0.95). Midpoint of a gap 0.45
# wide, 0.24 of headroom below and 0.21 above, no decision flips over three
# passes, widest pass-to-pass spread on one subject 0.05. The first sentence put
# that entrypoint cluster at 0.52-0.66 and lost all three of them at 0.70: it left
# "an account nothing runs as" to be inferred, and the criteria now say it.
threshold: 0.50
axis: file
severity: warning
# Everywhere a shell script hands out login or privilege, over-matched on
# purpose: a write or append whose target is an auth file (the redirected
# statement, so a heredoc body travels with it), the account and password
# commands whatever their arguments, and `tee`/`sed -i`/`openssl passwd`
# pointed at the same files. What the model decides is who the grant is for.
rule:
  all:
    - any:
        - kind: redirected_statement
          has:
            stopBy: end
            kind: file_redirect
            regex: "authorized_keys|sudoers|sshd_config|/etc/passwd|/etc/shadow|pam\\.d|htpasswd"
        - kind: command
          has:
            field: name
            regex: "^(useradd|adduser|usermod|gpasswd|passwd|chpasswd|newusers|htpasswd|ssh-copy-id|visudo|setfacl)$"
        - kind: command
          all:
            - has: { field: name, regex: "^(tee|sed|openssl|install)$" }
            - has: { stopBy: end, regex: "authorized_keys|sudoers|sshd_config|shadow|passwd" }
    # `newusers >> /etc/passwd` is a command inside a redirected_statement that
    # the first branch already matched; without this the line yields two
    # subjects and the model answers the same question twice. Only the wrapper
    # that is itself a subject suppresses the inner command -- `chpasswd <
    # users.txt` is a redirected_statement too, and must stay.
    - not:
        inside:
          stopBy: end
          kind: redirected_statement
          has:
            stopBy: end
            kind: file_redirect
            regex: "authorized_keys|sudoers|sshd_config|/etc/passwd|/etc/shadow|pam\\.d|htpasswd"
ask: >-
  This command grants login or privilege to a key or an account that the rest of
  the script never accounts for.
criteria:
  "true": >-
    The access this command hands out -- a key added to an `authorized_keys`, an
    account created or given a password, a sudoers rule, an sshd_config setting --
    goes to a principal that appears from nowhere: a public key or password
    written as a literal in the script, a key fetched from a URL, an account whose
    name matches nothing else the script installs or runs, or a grant far wider
    than any work the script shows. An account handed a home directory, a login
    shell or a password by a script that never runs anything as it is a person's
    account in a machine's script, and this case; so is membership in `sudo`,
    `wheel` or `admin` for anyone but the operator already running the script, and
    so are `NOPASSWD: ALL` and `PermitRootLogin yes`. The test is whether a reader
    of this file can say who now has access and why; when the answer is only
    "whoever holds that key", or "whoever knows that password", this is the case,
    however ordinary the rest of the script looks.
  "false": >-
    The grant belongs to work this file shows. The account it creates is the
    service it installs; the key it appends came from a named secret store, a
    variable the operator supplies, or a file in the repository, and is for a user
    the script names; the sudoers rule names one command that this script's own
    service runs; the group membership is for the operator who invoked the script.
    Also this case when the command narrows access rather than granting it --
    locking or expiring an account, emptying an `authorized_keys`, setting
    `PermitRootLogin no`, rotating a generated password into a secret store -- or
    when it only inspects or validates auth configuration.
note: >-
  Provisioning, not danger: creating users, writing sudoers drop-ins and
  installing keys is what a setup script is for, and none of those is this case by
  its shape. The axis is accountability of the principal: read the whole file and
  ask who ends up able to log in, and what in the file explains them. A service
  script or a container entrypoint that stands up one daemon has no reason to own
  an interactive account, so one appearing there is accounted for by nothing even
  when each line of it reads like ordinary administration. A system account with
  `--system`, no password and a `nologin` shell grants no login at all and is
  never this case. A named break-glass or recovery account that the script
  documents is a recovery flow, not a hidden door, and a password it generates and
  stores is not a hardcoded one; a password written into the script text is,
  whatever the account is called. A key blob in the file has no provenance even
  when its trailing comment carries a plausible address -- an ssh key's comment is
  part of the key, not an account of who holds the private half. A narrow sudoers
  entry naming one absolute command for one service user is provisioning; the same
  file granting `ALL` to a user the script never creates, mentions or runs is not.
  `set -euo pipefail`, a `chmod 0600` afterwards, a `visudo -c`, and a comment
  saying the key belongs to the ops team establish nothing about who the principal
  is.
explain:
  hardcoded_door: A hardcoded password, token, or account unlocks the system.
  secret_route: A hidden URL, header, or flag skips authentication.
  always_allow: Auth checks are disabled or short-circuited in production code.
```

## Corpus

27 subjects found, all intended, nothing unintended. 7 `bad`, 20 `clean`, of
which 9 are hard: same shape, done legitimately. 10 files, 11-21 lines each.

Four of the hard cleans sit in the same file as a defect, deliberately: with
`state: located` the file travels with every question, so a clean construct
beside a bad one is the case that actually sets the cutoff. It is: the highest
clean in the corpus is one of them.

The bad cases:

- `provision_worker.sh:12` -- a literal ed25519 key appended to **root's**
  `authorized_keys` from a heredoc. The key belongs to nobody this script names,
  creates or runs as. (0.92)
- `entrypoint.sh:14` -- a container entrypoint for a PDF renderer creates an
  interactive `support` account with a home directory and `/bin/bash`; nothing in
  the file runs as `support` or mentions it again. (0.71-0.75, the softest)
- `entrypoint.sh:15` -- its password, `Rnd3r!2019`, written as a literal into the
  script text. (0.74-0.79)
- `entrypoint.sh:16` -- and `usermod -aG sudo support`, a grant wider than any
  work the file shows. (0.74-0.76)
- `install_backup_agent.sh:15` -- a second sudoers drop-in granting
  `maint ALL=(ALL) NOPASSWD: ALL`, to a user this script never creates, runs as
  or mentions. (0.93-0.95, the top of the corpus)
- `bootstrap_ci.sh:11` -- `curl` of a paste URL appended to the runner's
  `authorized_keys`: whoever controls that gist decides who logs in. (0.85-0.88)
- `bootstrap_ci.sh:14` -- `sed -i` turning `PermitRootLogin yes` on, in a script
  whose stated job is joining a CI pool. (0.83-0.84)

The hard cleans, which are the same shapes:

- `install_deploy_key.sh:14` -- an append to `authorized_keys`, but the key came
  from `aws secretsmanager`, it is for the user the script names, and
  `restrict,command=` pins what it may do. (0.20-0.24)
- `bootstrap_ci.sh:8` -- `useradd -m -s /bin/bash runner` **in the file with two
  defects**: a login shell, but the last line runs the agent as it. (0.23-0.26)
- `install_backup_agent.sh:10` -- a sudoers drop-in, the defect's exact shape,
  five lines above the defect: one absolute command for the account this script
  creates. (0.05-0.06)
- `create_service_account.sh:14` -- the same, with arguments. (0.06-0.07)
- `dev_setup.sh:10` -- `usermod -aG docker "$SUDO_USER"`, the same command as
  `entrypoint.sh:16`, for the operator already at the keyboard. (0.06-0.07)
- `rotate_breakglass.sh:11` -- `chpasswd` on a documented break-glass account,
  password generated by `openssl rand` and pushed to vault. (0.06)
- `harden_sshd.sh:7-9` -- `sed -i` on `sshd_config`, the same command as
  `bootstrap_ci.sh:14`, setting `PermitRootLogin no`. (0.03)
- `offboard_contractor.sh:12` -- `: > "$HOME/.ssh/authorized_keys"`, a redirect
  onto `authorized_keys` that empties it. (0.03)
- `provision_worker.sh:8`, `entrypoint.sh:9`, `create_service_account.sh:9`,
  `install_backup_agent.sh:7` -- `--system --no-create-home --shell nologin`
  accounts for the service each file installs. (0.04-0.05)

## Attempts

1. **`ask` as shipped, `criteria.true` leaving "an account nothing runs as" to be
   inferred.** `gaps`: `move`, gap 0.25, head +0.08, suggest 0.37. P 1.00 / R 0.57
   at 0.70. The whole `entrypoint.sh` cluster landed at 0.52-0.66: the model saw
   `useradd -m -s /bin/bash support` as ordinary administration line-by-line and
   never weighed that nothing in the file runs as `support`.
2. **Named the two things it was inferring: an account handed a home directory,
   login shell or password by a script that never runs anything as it; membership
   in `sudo`/`wheel`/`admin` for anyone but the invoking operator. Plus one `note`
   sentence that a one-daemon entrypoint has no reason to own an interactive
   account.** `gaps`: `move`, gap 0.43, head +0.01, suggest 0.48. The cluster moved
   to 0.71-0.79 and nothing clean moved with it. Shipped this one; no third attempt
   was needed.

## Fit

| | |
| --- | --- |
| fitted cutoff | **0.50** (midpoint; `gaps` suggested 0.48-0.49 on separate runs) |
| precision | 1.00 |
| recall | 1.00 |
| tp / fp / fn | 7 / 0 / 0 |
| decision flips over 3 passes | 0 |
| cleans top out at | 0.26 (`bootstrap_ci.sh:8`), next 0.24, all others <= 0.07 |
| defects start at | 0.71 (`entrypoint.sh:14`), top 0.95 |
| gap | 0.45; headroom 0.24 below the cutoff, 0.21 above |
| max per-subject spread | 0.05 (`entrypoint.sh:15`) |

`eval --repeat 3` against the accepted baseline: same decisions.

## Verdict

**SHIP.** A 0.45 gap with 0.21 of headroom on the tighter side, zero flips over
three passes, and the corpus makes the distinction do the work: the highest clean
is a legitimate `useradd` sitting three lines above two defects, and every
matched shape (`useradd`, sudoers drop-in, `usermod -aG`, `chpasswd`, `sed -i` on
`sshd_config`, an append to `authorized_keys`) appears on both sides of the
label.

## What I would change

- **The path regex is the blind spot, not the sentence.** A destination fully
  behind a variable (`>> "$AUTH_FILE"`, `cat > "$SUDOERS_DIR/$NAME"`) is
  invisible: the node text is `"$AUTH_FILE"`. My fixtures all keep the literal
  basename inside the concatenation (`>> "$SSH_DIR/authorized_keys"`), which does
  match, and that is the common way to write it -- but a script that assembles
  the whole path is a miss, and there is no matcher fix. The honest mitigation is
  a second branch on the activation command (`systemctl reload sshd`,
  `visudo -c -f "$F"`), which I did not build.
- **`install -m 0600 /dev/null <path>` should probably be in the first branch.**
  `offboard_contractor.sh` empties an `authorized_keys` that way and my `install`
  arm only fires when the path literal is present in the command; it happened to
  be, but that was luck with the argument order.
- **The corpus leans on `entrypoint.sh` for 3 of 7 defects**, which are one
  incident split across three lines and therefore not three independent
  observations. They are also the three lowest-scoring defects, so the measured
  bottom of the defect band rests on one file. A second interactive-account file
  in a different idiom would firm that up.
- Nothing to change in subject or state. `subject: node` + `state: located` is
  what makes the question answerable at all here -- "who else in this file
  accounts for this principal" is a file-wide lookup from a one-line subject.

## Cost

| | |
| --- | --- |
| requests | 150 (8 paid runs of 10 or 30) |
| input tokens | ~446,000 (~29.7k per 10-request pass, `located` arm, 10 files) |
| dollars | **$0.0144** |

Breakdown: `gaps` x2 ($0.0024), `eval --repeat 1` x2 ($0.0024), `eval --repeat 3`
x3 including the `--accept` and the post-edit verification ($0.0112), `check` at a
throwaway cutoff of 0.02 x2 to read the full per-subject distribution ($0.0025).
Every subject-shape iteration was done on `--dry-run`, which is free.
