# captures-what-the-user-does

A port of `surveillance` from [luantak/is-malicious](https://github.com/luantak/is-malicious)
onto shell, built to the shape the eight shipped `rules/shell/` rules found:
one construct at a time, `subject: node`, `state: located`, the rest of the
script as the evidence.

## Rule

```yaml
id: captures-what-the-user-does
language: Bash
kind: noul
subject: node
state: located
at: 0.50
axis: file
severity: warning
utils:
  captures_the_user:
    kind: command
    any:
      - has:
          stopBy: end
          regex: "^(pbpaste|xclip|xsel|wl-paste|screencapture|scrot|grim|maim|spectacle|import|script|ttyrec|asciinema|xinput|evtest|libinput|logkeys|arecord|parecord|rec|imagesnap|CoreLocationCLI|whereami|tcpdump|tshark|dumpcap)$"
      - all:
          - has: { stopBy: end, regex: "^(ffmpeg|ffplay|gst-launch-1\\.0)$" }
          - has: { stopBy: end, regex: "avfoundation|x11grab|gdigrab|dshow|v4l2|alsa|pulse|screen-capture|kmsgrab" }
      - has:
          stopBy: end
          regex: "bash_history|zsh_history|sh_history|\\.histfile|HISTFILE|python_history|node_repl_history|psql_history|mysql_history|places\\.sqlite|History\\b|Cookies\\b"
rule:
  any:
    - kind: pipeline
      has: { stopBy: end, matches: captures_the_user }
    - all:
        - matches: captures_the_user
        - not: { inside: { stopBy: end, kind: pipeline } }
ask: >-
  This command captures the user -- what they type, copy, see, say or where they
  are -- beyond anything the script tells them it does, or puts what it captured
  somewhere they cannot see it.
```

`criteria`, `note` and `explain` are in `rule.yml`; the `true` limb is a
three-way disjunction (hidden / broader than the stated feature / leaves) and
the `note` is where the destination half of the axis lives.

## Corpus

22 subjects over 14 fixtures: **7 bad**, 15 clean, of which 11 are hard --
the defect's own command, or its own shape, done legitimately.

The seven defects:

| subject | defect |
| --- | --- |
| `onboard.sh:18` | `pbpaste` every two seconds from a disowned background function of a laptop-onboarding script, into `~/.cache/devtools/.pb`, which the EXIT trap POSTs to a telemetry host |
| `support_agent.sh:20` | `screencapture -x` on a five-minute timer into a dotted staging cache that the `tar`+`curl` four lines down uploads; the usage line offers one screenshot on request |
| `support_agent.sh:21` | `CoreLocationCLI` appending coordinates to the same staged bundle on the same timer; no stated feature needs where the user is |
| `lowlat.sh:16` | `nohup xinput test-xi2 --root` -- a raw event stream for every device -- into a hidden file that the crontab line installed two lines later rsyncs off-box |
| `devstats.sh:16` | 5,000 lines of `~/.zsh_history` into the POST body of a "productivity dashboard" on a launchd timer |
| `sound_doctor.sh:14` | 900 seconds of microphone piped straight into a POST after announcing "a short sample"; the audio never touches a file the user could hear or refuse |
| `focustime.sh:12` | a screenshot every 60s from a pomodoro timer's background ticker into `.frames`, silent, never mentioned -- and **never uploaded**: the one defect whose whole case is hidden-and-broader, with the destination limb absent |

The hard cleans, roughly hardest first: `whichkey.sh:17` (`xinput test` on a
keyboard -- the `lowlat` defect's exact binary and subcommand -- as the entire
advertised job of a keycode helper, printed to the user's terminal);
`clipd.sh:18`/`:25` (a one-second poll loop over the X clipboard AND the primary
selection, i.e. the `onboard` defect's shape, in the clipboard-history daemon
the user installed); `rec_standup.sh:13` (ffmpeg on avfoundation capturing the
screen *and* the mic for 90 minutes -- the broadest capture in the corpus, and
clean); `hist_top.sh:14` (`~/.zsh_history`, the `devstats` defect's own source,
as a frequency table on stdout); `voice_note.sh:11`, `debug_registry.sh:9`
(tcpdump bounded to loopback, 200 packets, one port), `build_session.sh:11`
(`script` transcript into the build dir), `capture_bug.sh:12`/`:16`.

Four cleans sit in the same file as a defect, which is the case the pack's
report says usually sets the cutoff: `onboard.sh:11`, `support_agent.sh:14`,
`lowlat.sh:9`, `sound_doctor.sh:9`.

No `# DEFECT` / `# CLEAN` markers anywhere; the labels and their arguments are
in `expect.yml`.

## Attempts

One attempt at the sentence, and one at the corpus.

| # | change | result |
| --- | --- | --- |
| 1 | `subject: node`, `state: located`, three-limb `true` (hidden / broader / leaves), destination reasoning in `note:` | `gaps`: gap **0.38**, suggest 0.49, verdict **move** (the uncalibrated 0.70 was outside the gap, not a sentence problem). `eval --repeat 1`: P 1.00, R 0.83, cleanTop 0.28, one defect at 0.69 under the 0.70 guess |
| 1b | same sentence, `at:` moved into the gap | `eval --repeat 3` at 0.50: P/R 1.00, 0 flips, cleanTop 0.30, gap 0.39 |
| 2 | **corpus**, not sentence: the 19-subject corpus separated on the first try, which is the failure mode the brief warns about, so I added the two hardest cases I could construct -- a covert capture that never leaves (`focustime`) and `xinput test` as a legitimate whole job (`whichkey`) | both landed right: 0.80 and 0.09. cleanTop 0.31, defect floor 0.68, P/R 1.00, 0 flips |

Nothing was rewritten because nothing failed; the honest summary is that the
sentence was written after reading `runs-downloaded-code` and
`reads-secrets-it-does-not-own` and inherited their shape, so the attempt
budget went into making the corpus harder instead. Both hardening cases were
built to break it and did not.

## Fit

Fitted cutoff **0.50** (the gap's midpoint; `eval` fits 0.50-0.51 depending on
pass). Precision **1.00**, recall **1.00**, tp 7 / fp 0 / fn 0, **0 decision
flips** over three passes, max pass-to-pass spread **0.03**.

```
0.96  support_agent.sh:20   bad
0.96  support_agent.sh:21   bad
0.95  onboard.sh:18         bad
0.93  devstats.sh:16        bad
0.91  lowlat.sh:16          bad
0.81  focustime.sh:12       bad   (hidden, never uploaded)
0.68  sound_doctor.sh:14    bad   <- defect floor
        ---- at: 0.50 ----
0.31  sound_doctor.sh:9     clean (adjacent, 5 lines above the defect)
0.28  onboard.sh:11         clean (adjacent)
0.25  clipd.sh:25           clean (hard: the daemon's own poll loop)
0.23  clipd.sh:18           clean (hard)
0.12  rec_standup.sh:13     clean (hard: screen + mic, 90 minutes)
0.10  support_agent.sh:14   clean (adjacent: same binary as the 0.96 defect)
0.10  build_session.sh:11   clean
0.09  whichkey.sh:17        clean (hard: `xinput test`, the defect's subcommand)
0.09  lowlat.sh:9           clean (adjacent: same binary as the 0.91 defect)
0.09  debug_registry.sh:9   clean
0.08  capture_bug.sh:16     clean
0.06  hist_top.sh:14        clean
0.05  voice_note.sh:11      clean
0.04  whichkey.sh:10        clean
```

Gap **0.37** wide, headroom 0.19 below and 0.18 above the cutoff.

Three measurements worth having:

1. **Adjacency costs about 0.18 here, and only for a construct of a different
   kind than the defect.** The same `script -q <log> <build command>` reads
   0.10 in `build_session.sh` and 0.28 four lines above a clipboard exfil in
   `onboard.sh`. But `screencapture -i` in `support_agent.sh` reads 0.10 six
   lines above a `screencapture -x` that reads 0.96, and `xinput list` reads
   0.09 seven lines above an `xinput test-xi2` at 0.91. So when the model can
   tell two branches apart it does, decisively; the contamination shows up on
   the construct it has no local story for.
2. **The "leaves" limb is not load-bearing.** `focustime.sh:12` captures the
   screen every minute, keeps it forever, and sends nothing: 0.81, sixth of
   seven. A rule that only asked "is it uploaded" would have missed it.
3. **Destination is what separates the two `arecord`s.** The corpus's two
   closest neighbours are `sound_doctor.sh:9` (2s, prompted, played back:
   0.31) and `:14` (900s, piped into a POST: 0.68) -- same binary, same file,
   eleven lines apart, and they are the two subjects that set both edges of
   the gap.

## Verdict

**SHIP.** It separates by 0.37 with 0.18 of headroom on the tighter side and no
flips, over a corpus where the nine designed-hard cleans include the defects'
own commands (`xinput test`, `pbpaste` in a poll loop, `arecord`, a
`~/.zsh_history` read) and where one defect deliberately lacks the upload the
other six have.

The caveat I would want a reader to carry: every defect above 0.90 is a
background timer in a file that also has a suspicious hostname in it, and the
one defect that is genuinely a judgement call (`sound_doctor`, 0.68) sits
0.18 above the cutoff, not 0.40. The rule's real working margin is that one
case, not the five easy ones.

## What I would change

- **Matcher, likely over-broad in the wild.** `script` is the riskiest entry in
  the word list: it appears as a command name and in `$(...)`-free contexts
  rarely, but `import` (ImageMagick) is a word that also starts a Python line
  inside a heredoc, and `rec` is a plausible function name. `History\b` and
  `Cookies\b` will hit `~/Library/.../History` but also any argument containing
  the word. None of these fired on 14 fixtures; they have never been tested on
  real scripts, which the pack's report says is the state of three of the
  shipped eight too. A run over the same 40 repository scripts is the next
  cheap thing to do and I did not do it -- the write scope is this directory.
- **Matcher, known blind spots.** The capture whose target is behind a variable
  (`$CAP_TOOL -x "$OUT"`) is invisible, same as the pack's redirect-behind-a-
  variable hole. `defaults read`/`sqlite3` against a browser history DB, AppleScript
  `osascript -e 'the clipboard'`, `/dev/input/event*` read directly with `cat`,
  and `dtrace`/`bpftrace` probes are all real shell surveillance shapes that
  this matcher does not see.
- **Corpus.** The gap is set by one pair of `arecord`s; a second genuinely
  contested pair (a session recorder recording an interactive login shell into
  a shared directory; a `tcpdump` on a real interface with no port filter
  "for support") would test the cutoff where it actually lives. I would also
  like a defect whose capture is disclosed but whose destination is wrong --
  a screenshot the user framed themselves, silently mirrored to a vendor --
  since that is the one corner of the three-limb `true` with no case behind it.
- **`explain:` labels.** Ported verbatim, and they do partition this corpus
  (keylog: `lowlat`, `devstats`; clipboard_or_screen: `onboard`,
  `support_agent:20`, `focustime`; mic_cam_or_location: `support_agent:21`,
  `sound_doctor`) -- but `keylog` is a poor name for "read the shell history
  file", and the labels were never asked for (`--explain` costs a request and
  I did not spend one).

## Cost

| run | requests | $ |
| --- | --- | --- |
| `gaps` (19 subjects) | 12 | 0.00104 |
| `eval --repeat 1` | 12 | 0.00104 |
| two `check --at ... --format json` distribution attempts (both returned no verdicts -- `--at <id>=n` did not take with `-R` on a candidate dir; wasted) | ~24 | ~0.0021 |
| `eval --repeat 3` | 36 | 0.00312 |
| `eval --repeat 3 --accept` | 36 | 0.00312 |
| `eval --repeat 3` (22-subject corpus) | 42 | 0.00363 |
| `eval --repeat 3 --accept` (final baseline) | 35 | 0.00306 |

Total **~197 requests, ~73k input tokens on the final pass, ~$0.016** -- under
the $0.10 budget. Every `--dry-run` was free; the matcher was correct on the
first `--show-subjects` (19/19 intended subjects, no duplicates, all 12 files
present) and again after the two fixtures were added (22/22).

One tool note for whoever reads the baseline: in both accepted runs a handful
of subjects carry `value: null` for one or two passes (35 calls where 42 were
planned). `eval`'s own tp/fp/fn/flips are computed correctly around it, but a
mean taken naively over `baseline.json` will read low for those subjects.
