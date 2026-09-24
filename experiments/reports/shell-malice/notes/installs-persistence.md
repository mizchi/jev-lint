# installs-persistence (Bash)

## Rule

See `rule.yml` beside this file; it is the complete YAML, reproduced here.

```yaml
id: installs-persistence
language: Bash
kind: noul
subject: node
state: located
threshold: 0.50
axis: file
severity: warning
rule:
  any:
    - kind: pipeline
      all:
        - not: { inside: { stopBy: end, kind: pipeline } }
        - has:
            stopBy: end
            kind: command
            has: { field: name, regex: "^(crontab|systemctl|launchctl|systemd-run|update-rc\\.d|chkconfig|schtasks|nohup|setsid|disown|at)$" }
    - kind: redirected_statement
      all:
        - not: { inside: { stopBy: end, kind: pipeline } }
        - any:
            - has: { stopBy: end, kind: file_redirect, regex: "^>>" }
            - has: { stopBy: end, kind: file_redirect, regex: "(/etc/cron|systemd/system|systemd/user|LaunchAgents|LaunchDaemons|/etc/init\\.d|/etc/profile\\.d|/etc/rc\\.local|autostart)" }
            - has:
                stopBy: end
                kind: command
                has: { field: name, regex: "^(crontab|systemctl|launchctl|systemd-run|update-rc\\.d|chkconfig|schtasks|nohup|setsid|disown|at)$" }
    - kind: command
      all:
        - not: { inside: { stopBy: end, any: [ { kind: pipeline }, { kind: redirected_statement } ] } }
        - any:
            - has: { field: name, regex: "^(crontab|systemctl|launchctl|systemd-run|update-rc\\.d|chkconfig|schtasks|nohup|setsid|disown|at)$" }
            - has: { stopBy: end, regex: "(/etc/cron|systemd/system|systemd/user|LaunchAgents|LaunchDaemons|/etc/init\\.d|/etc/profile\\.d|/etc/rc\\.local|autostart)" }
ask: >-
  What this command leaves on the machine keeps running or gets run again after
  the script has exited, and it belongs to something other than the program this
  script exists to install.
criteria:
  "true": >-
    This command registers, enables, appends or detaches something that outlives
    this process -- a crontab or `/etc/cron.d` entry, a systemd unit or timer, a
    launchd agent, an init or `rc.local` hook, a line in a shell rc or
    `profile.d` file, a `nohup`/`setsid` process -- and what it leaves behind is
    not the thing the rest of this file is about: it runs a different program, it
    fetches and executes something over the network, it relaunches itself, or it
    is filed under a name borrowed from the system (`ntp-sync`, `dbus-`,
    `com.apple.*`) while the body does something else. A payload in a unit file,
    a plist or a cron line that the entry's own name does not describe is this
    case, and so is an entry whose name matches the script while its body does
    not.
  "false": >-
    Either nothing here outlives the script -- `systemctl restart`, `is-active`,
    `status`, `crontab -l`, a `>>` onto a log file, a `nohup` the script itself
    waits on -- or what does outlive it is the script's own declared job: the
    unit, timer or cron entry runs the binary this file just installed or this
    script itself, under a name that says so, with its output going somewhere
    named; a provisioning script enabling the packages it just installed as
    dependencies; a setup script appending a labelled, greppable block of PATH
    and shell-init lines to a dotfile it names at the top. Persistence a reader
    of this file would predict from its first three lines is this case.
note: >-
  Persistence is not the defect -- an installer that did not install anything
  would be broken. The defect is a mismatch between what the file is for and
  what it leaves behind, or a name chosen so the reader will not look. Read the
  heredoc, the plist body and the cron line, not the path they are written to:
  `/etc/systemd/system/queue-worker.service` whose `ExecStart` is the binary two
  lines above is the clean case, and `~/.config/systemd/user/dbus-broker-refresh`
  whose `ExecStart` curls a URL is this case even though the directory is the
  user's own. Judge each append separately: four `>>` lines onto the same
  `.bashrc` are four subjects, and three of them being obvious PATH exports says
  nothing about the fourth. `sudo`, `set -euo pipefail`, a `Description=` field
  and a comment calling the agent a monitor establish nothing. An enable of a
  package the script installed for the service to use (docker, chrony) is the
  script's own job even though the unit is not named after the script.
explain:
  startup_hook: Adds a hidden login item, cron, systemd unit, or Run key.
  watchdog: Respawns itself after the user quits.
  implant: Installs a long-lived agent unrelated to the advertised program.
```

## Corpus

8 files, 16 subjects found: 4 `bad`, 12 `clean`, of which 10 are hard.

Bad cases:

- `provision_worker.sh:28` -- a worker provisioner that correctly installs and
  enables its own unit, then appends a five-minute `/etc/cron.d/ntp-sync` entry
  that pipes a CDN script into `sh`. Nothing else in the file is about time or
  about that host; the filename is the disguise.
- `prepare_mac_runner.sh:24` -- `launchctl load -w` on a LaunchAgent labelled
  `com.apple.diagnostics.reporter`, whose `ProgramArguments` is a `while :;` loop
  curling a relay into `bash`. A CI-prep script leaving a respawning implant
  under an Apple name.
- `devsetup.sh:10` -- the third of four `>>` appends to `.bashrc`. The other
  three are `DATA_HOME`, a PATH entry and an alias; this one starts a detached
  `/usr/lib/sysmond` on every login and relaunches it if `pgrep` misses it.
- `install_cli.sh:32` -- `systemctl --user enable --now dbus-broker-refresh.timer`
  in an installer for a CLI called `shipctl`. The unit this file wrote runs
  `curl ... | sh` against a telemetry host every 30 minutes; the name is
  borrowed from D-Bus and none of it is `shipctl`.

Hard cleans, in the order that matters:

- `install_cli.sh:31` and `provision_worker.sh:25`/`:31` -- clean constructs
  (`daemon-reload`, `is-active`) sitting one and three lines from a defect in the
  same file. The whole file is in the state, so these measure contamination
  directly.
- `devsetup.sh:8`, `:9`, `:11` -- three `>>` appends to `.bashrc` with the same
  syntax as the defect between them.
- `provision_worker.sh:26` -- `systemctl enable --now queue-worker.service`, the
  unit written four lines above, whose `ExecStart` is the binary installed six
  lines above. The defect's shape done right, in the file that also has the defect.
- `backup_cron.sh:11` -- `( crontab -l | grep -vF ) | crontab -`, a nightly
  entry that runs this same script with `--run` and appends to the log path the
  file names at the top.
- `dotfiles_install.sh:19` -- a block appended to `~/.zshrc` between greppable
  begin/end markers, guarded against a second write.
- `deploy_staging.sh:8` -- `nohup ./gradlew ... > "$LOG" 2>&1 &`, waited on by
  pid, log tailed on failure, `trap`-removed on exit.
- `bootstrap_host.sh:11`, `:12` -- `systemctl enable --now docker` / `chrony`:
  units NOT named after the script, which is the lazy rule's trap, but packages
  the script installed two lines above.

## Attempts

- **Attempt 1** (the sentence as shipped; `subject: node`, `state: located`):
  `gaps` verdict **works**, gap 0.66, head +0.53, 4 of 16 reported at the
  uncalibrated 0.70. No second attempt was needed.

## Fit

Fitted cutoff **0.50** (midpoint; the tool's own `fitted` came back 0.49/0.50 on
both three-pass runs).

- precision 1.00, recall 1.00 -- tp 4, fp 0, fn 0
- decision flips across 3 passes: 0
- max pass-to-pass spread: 0.06 (`install_cli.sh:31`, 0.16/0.22/0.20)
- cleans top out at 0.22, the rest at 0.10 and under; defects start at 0.80
- gap 0.58 wide, 0.28 of headroom below the cutoff and 0.30 above

Per-subject, three passes:

```
BAD   provision_worker.sh:28    0.97 0.97 0.97
BAD   prepare_mac_runner.sh:24  0.95 0.95 0.95
BAD   install_cli.sh:32         0.94 0.95 0.94
BAD   devsetup.sh:10            0.81 0.83 0.80
clean install_cli.sh:31         0.16 0.22 0.20
clean devsetup.sh:11            0.10 0.10 0.10
clean devsetup.sh:8             0.08 0.08 0.09
clean dotfiles_install.sh:19    0.08 0.08 0.07
clean devsetup.sh:9             0.07 0.08 0.08
clean deploy_staging.sh:8       0.07 0.07 0.07
clean provision_worker.sh:25    0.07 0.06 0.06
clean backup_cron.sh:11         0.05 0.05 0.05
clean provision_worker.sh:26    0.05 0.05 0.04
clean bootstrap_host.sh:11      0.05 0.05 0.04
clean bootstrap_host.sh:12      0.05 0.05 0.05
clean provision_worker.sh:31    0.04 0.04 0.04
```

## Verdict

**SHIP** -- 0.58 of gap with 0.28/0.30 of headroom and no flips, and the cleans
that came closest are the ones designed to be hardest (a clean construct beside a
defect in the same file, and `enable --now` of a unit not named after its script),
both of which stayed under 0.22.

## What I would change

- The matcher cannot see a background `&`: tree-sitter-bash carries it as an
  anonymous token on the statement, with no named node and no field, so
  `while true; do ...; done &` and `./agent & disown`-less detachment are
  invisible. Detachment is only reachable through `nohup`/`setsid`/`disown` as
  command names. A `regex` on `program`/`list` text would catch it and would also
  catch every `&&`; I left it out rather than buy recall with noise.
- A write into a persistence directory through a variable
  (`UNITS="$HOME/.config/systemd/user"; cat > "$UNITS/x.service"`) is not matched
  -- the redirect destination is `"$UNITS"`. Both bad files here are still caught,
  because the `systemctl`/`launchctl` line that activates the file is matched, but
  a script that only drops a unit and lets a later `daemon-reload` find it would
  slip through. Following the variable would need `utils` plus a
  `follows:`-style binding, not worth it while activation is always present.
- The corpus has no Windows-ish or `threshold`/`systemd-run` defect and no
  `/etc/rc.local` case; those branches of the matcher are untested against a
  labelled defect.
- If this rule and `runs-downloaded-code` ship together they will both fire on
  `provision_worker.sh:28` and on the unit bodies -- a cron line that curls into
  `sh` is two defects. That is correct but worth knowing before reading a report.

## Cost

56 requests, ~124,400 input tokens, **$0.0052** total:

- `gaps`, 1 pass: 8 requests, ~19,000 tokens, $0.00074
- `eval --repeat 3`: 24 requests, 52,701 tokens, $0.00221
- `eval --repeat 3 --accept`: 24 requests, 52,701 tokens, $0.00221
