# shell/hides-what-it-runs

Port of the `stealth` check from github.com/luantak/is-malicious, rewritten for
Bash and for one construct instead of a whole file.

## Rule

```yaml
id: hides-what-it-runs
language: Bash
kind: noul
subject: node
state: located
threshold: 0.30
axis: file
severity: warning
rule:
  any:
    - kind: command
      has: { field: name, regex: "^(base64|xxd|uudecode|openssl|history)$" }
    - kind: command
      all:
        - has: { field: name, regex: "^(printf|echo|set|tr)$" }
        - regex: "\\\\x[0-9a-fA-F]{2}|\\+o history|\\+H(\\s|$)"
    - kind: command
      all:
        - has:
            field: name
            has:
              stopBy: end
              any: [ { kind: simple_expansion }, { kind: expansion }, { kind: command_substitution } ]
        # tree-sitter-bash wraps a redirected command in a `redirected_statement`,
        # so `"$BIN" x >/dev/null` matches this branch and the redirect branch
        # both and reports one line twice. The redirect branch is the wider
        # subject, so it keeps the line.
        - not: { inside: { kind: redirected_statement, regex: "/dev/null" } }
    - kind: command
      regex: "\\$\\{?IFS\\}?|/dev/shm|/tmp/\\.[A-Za-z0-9]"
    - kind: redirected_statement
      regex: "/dev/null"
    - kind: variable_assignment
      regex: "^HIST"
    - kind: unset_command
      regex: "HIST"
    - kind: test_command
      regex: "dockerenv|/proc/1/cgroup|detect-virt|strace|ltrace|\\$\\{?CI\\}?(\\W|$)"
    - kind: command
      has: { field: name, regex: "^(systemd-detect-virt|strace|ltrace)$" }
ask: >-
  This step is here so that what the script does leaves no readable trace --
  not in the file for whoever reads it, not on the machine or in the log for
  whoever looks afterwards -- rather than to do ordinary work.
criteria:
  "true": >-
    The step takes the behaviour out of the text, and any one of these is
    enough. The name of the command being run is assembled at runtime -- from a
    variable the file never sets in view, an expansion, `${IFS}`, hex escapes --
    so the line does not say what executes. A payload is decoded out of base64,
    hex or a substitution cipher and what comes out is code, a command or a URL
    rather than data the script goes on to name. The shell's history is cleared
    or pointed at `/dev/null`, so the session leaves no record. A file is put
    where a reader would not look: a dot-name, a path under `/dev/shm` or
    `/tmp` the script never mentions again. A probe for a container, a VM, a CI
    environment or a tracer decides whether the real work happens at all, so the
    script behaves one way when it is watched and another when it is not. A
    step's output and its failure both go to `/dev/null` and are swallowed, and
    the script then carries on -- or writes to its own log or report that the
    thing happened -- as though it had worked, so nothing anywhere records that
    it did not. The step need not be the hostile act itself; being the reason
    nobody can see the hostile act is enough.
  "false": >-
    The construct is doing its ordinary job and the script stays readable. A
    `>/dev/null 2>&1` whose point is a probe's exit status, or which silences
    chatter from a step whose failure still stops the script or is handled on
    the next line. `base64` or `xxd` moving data the script names into or out
    of a request body, a file or a tool it then calls, where what comes out is
    used as data. Hex escapes that are terminal colours or a byte format
    string. A command run through a variable this file sets from a literal, a
    positional argument or an environment override with a visible default. A
    `/dev/shm` or temp path chosen for a reason the file gives -- speed, a
    secret that must not reach disk -- and cleaned up in view. A check for a
    container, CI or a platform that picks a config, a path or a flag, with
    both branches doing the work. Someone who knows shell can read the line and
    say what runs.
note: >-
  Concealment, not danger. A script that does something drastic in plain sight
  is not this case; a harmless step taken in a way that leaves no trace is.
  The rest of the file is evidence about why this step is here, and it is
  admissible: what the header comment claims, what the decoded bytes turn into
  two lines down, whether the path is ever named again, whether the branch that
  the probe guards is the only branch that does anything. Use it. But every
  shape this matcher finds is common and usually innocent -- shell redirects to
  `/dev/null`, base64s binaries and branches on the environment all day, and a
  rule that flags every `2>/dev/null` is worth nothing -- so ask what a reader
  loses, not what the shape could be used for. `set -e` above a silenced
  command means its failure still stops the script, so the silence costs the
  reader the output and nothing else; a `|| true` beside it means nothing
  will ever record the failure, and if the next lines announce the step as done
  the silence is not sloppiness, it is the whole point. A variable holding a
  command name hides nothing when the file sets it where you can see.
explain:
  string_hide: Hides URLs, commands, or payloads behind encoding meant to evade review.
  anti_analysis: Detects debuggers, VMs, or scanners in order to change or hide behavior.
  misleading_names: Uses decoy names or comments that contradict what the code does.
```

The cutoff comment in `rule.yml` carries the fit; it is not repeated here.

## Corpus

19 subjects the matcher finds across 8 fixtures: **8 bad, 11 clean, of which 9
hard**. Two of the hard cleans sit inside the hostile files, adjacent to
defects, because `state: located` puts the whole file in front of the model and
that is the only way to find out whether the file's character leaks onto an
honest line. It does not: those two are the highest cleans in the corpus, at
0.11 and 0.09, and the band still tops out under a fifth of the cutoff.

The bad cases:

- `telemetry_agent.sh:8` -- `C=$(printf '\x63\x75\x72\x6c')`. The command name
  is spelled in hex and assembled at runtime; the word `curl` is nowhere in the
  file.
- `telemetry_agent.sh:17` -- `"$C" -fsS "$BEACON" -d h=... -d u=... -d r=...`.
  Runs a name no reader can resolve, sending a host fingerprint that the header
  comment calls "re-registering this host".
- `telemetry_agent.sh:18` -- `history -c` after that beacon. Its only effect is
  that the session leaves no record.
- `runner_prepare.sh:11` -- `if [ -e /.dockerenv ]; then exit 0; fi`. A
  container probe whose only branch is to do nothing: the payload runs on bare
  hosts and stays quiet wherever someone is likely to be watching.
- `runner_prepare.sh:15` -- `W=$(mktemp /dev/shm/.hk-XXXXXX)`. A dot-named file
  on tmpfs, absent from the header comment, deleted four lines later.
- `runner_prepare.sh:16` -- `printf '%s' "$HOOK" | base64 -d > "$W"`. Decodes a
  base64 constant into a file that is then executed; the payload is a
  curl-pipe-sh the file never shows in readable form.
- `runner_prepare.sh:18` -- `"$W" --quiet`. Executes the decoded blob through a
  variable; the line names neither the program nor what it does.
- `nightly_maintenance.sh:12` -- `edge-migrate --apply >/dev/null 2>&1 || true`,
  with `echo "schema migrations applied" >> "$REPORT"` on the next line. Output
  and failure both discarded, and the only record of the step says it worked.

The hard cleans are the same shapes done honestly, deliberately paired with the
defects: `command -v` probes whose point is the exit status
(`preflight.sh:8`, `runner_prepare.sh:9`); `\x1b[32m` against the hex-spelled
`curl`; `base64 -w0` of a crash dump into a JSON field of a request to an API
the file names; a `/.dockerenv` test that picks a database host and echoes the
choice, against the one that gates a payload; `mktemp -d -p /dev/shm` for a
signing key that must not reach disk, with a shredding trap, against the
dot-named dropper file on the same tmpfs; a `>/dev/null 2>&1` under `set -e`
with no `|| true`, four lines above the one that has both; `$HELM` and
`$GZIP_BIN` as command names, each set from an env override with a literal
default in view.

## Attempts

| # | what changed | gaps | gap | head | cleanTop | lowest defect |
| - | - | - | - | - | - | - |
| 1 | "a reader ... cannot tell what it **ran**"; `note` said "do not convict a construct because the file around it is hostile" | `works` | 0.27 | +0.26 | 0.13 | 0.22 |
| 2 | ask widened to "keep what the **script does** out of view **rather than to do ordinary work**"; criteria opened with "any one of these is enough"; `note` clause telling the model to discount the file replaced with "the rest of the file is evidence and it is admissible" | -- | 0.17 | -- | 0.08 | 0.25 |
| 3 | ask to "leaves **no readable trace** -- not in the file, not on the machine or in the log"; the silenced-step clause extended to "and the script then writes to its own log that the thing happened" | `works` | 0.45 | +0.20 | 0.11 | 0.52 |

Attempt 1 separated (`works`, gap 0.27) but on the wrong axis: its gap was
*inside* the defect band, because only `history -c` reached 0.70 and six of
eight defects sat at 0.22-0.44. The single biggest lift came from deleting one
sentence of `note:` -- "do not convict a construct because the file around it
is hostile" was suppressing exactly the evidence that makes a dropper a
dropper. Attempt 3's ask reaches the case where the concealment is not in the
script's text but in what the machine is left holding afterwards.

Between attempts 3 and the fit, the corpus gained the two adjacent-in-hostile-
file cleans and the matcher gained the `redirected_statement` guard (below);
that configuration was re-measured at `--repeat 1` before the three-pass fit.

## Fit

Cutoff **0.30**. 19 subjects, 3 passes.

| | |
| - | - |
| precision | 1.00 |
| recall | 1.00 |
| tp / fp / fn | 8 / 0 / 0 |
| decision flips | 0 |
| cleanTop | 0.11 |
| lowest defect (mean) | 0.52 |
| gap | 0.41 |
| max spread, clean band | 0.02 |
| max spread, defect band | 0.09 |

```
clean  0.04  deploy.sh:11            bad  0.52  nightly_maintenance.sh:12
clean  0.04  preflight.sh:8          bad  0.59  runner_prepare.sh:11
clean  0.04  preflight.sh:23         bad  0.59  telemetry_agent.sh:17
clean  0.05  upload_crashdump.sh:12  bad  0.65  runner_prepare.sh:15
clean  0.06  upload_crashdump.sh:9   bad  0.71  telemetry_agent.sh:8
clean  0.06  deploy.sh:9             bad  0.73  runner_prepare.sh:18
clean  0.07  run_tests.sh:5          bad  0.73  runner_prepare.sh:16
clean  0.08  rotate_signing_key.sh:7 bad  0.82  telemetry_agent.sh:18
clean  0.09  runner_prepare.sh:9
clean  0.10  nightly_maintenance.sh:8
clean  0.11  telemetry_agent.sh:12
```

0.30 rather than the fitted midpoint 0.315: the clean band wobbles at most 0.02
while the laggard defect wobbles 0.08, so the room belongs under the defects.
At 0.30 the worst single pass of the lowest defect (0.49) still clears by 0.19,
and the highest clean clears by 0.19 the other way.

## Verdict

**SHIP.** Precision and recall 1.00 with a 0.41 gap and 0.19 of headroom on
each side, and the corpus is not an easy one: every hard clean is the defect's
own shape done honestly, two of them sit next to defects inside the hostile
files, and the model still answered them at 0.09 and 0.11.

## What I would change

- **The `/dev/null` branch is the noisiest thing here** and it is the one to
  watch on real code. Every `2>/dev/null` in a repository becomes a subject.
  The corpus says the sentence handles it -- four silenced commands answered
  0.04-0.10 -- but they are four, and a real repository has hundreds. If the
  request volume matters more than the recall on
  `nightly_maintenance.sh:12`-shaped cases, narrow the branch to
  `redirected_statement` that also has `|| true` or `|| :` beside it and take
  the cost in recall. I did not, because the design brief says the matcher
  over-matches and the sentence decides, and on this corpus it did.
- **The corpus has no case where the hiding is in a sourced or `eval`'d
  variable** -- a `$'\x..'` ANSI-C string used as a command word, and `${IFS}`
  as an argument separator, are both in the matcher and in neither class. They
  are guesses until something exercises them.
- `nightly_maintenance.sh:12` is the one label in this corpus a reasonable
  person could refuse, and the model's 0.52 is it saying so politely. If a
  reviewer calls that sloppy error handling rather than concealment, drop the
  case and the cutoff can move up to about 0.35 with more room, at the cost of
  the rule no longer seeing the shape at all.

## Cost

96 requests over 12 passes of the 19-subject corpus, ~300k input tokens,
**$0.0099** -- from the tool's own summaries: gaps $0.00082 + $0.00098, five
single-pass evals $0.00082 / $0.00086 / $0.00090 / $0.00094, two three-pass
evals $0.00282 each. Budget was $0.10.
