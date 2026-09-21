# The shell pack: what a script does that its reader cannot see

A port of the twenty checks in [luantak/is-malicious](https://github.com/luantak/is-malicious)
onto shell scripts. That project asks its questions of whole files in any
language; this pack asks eight of them of one construct at a time, in `sh`,
`bash` and `zsh`, with the rest of the script in the state.

Shell is where these questions pay. A shell script is the one artefact that
is routinely executed without being read -- piped from a URL into an
interpreter, pasted out of a README, run as a CI step nobody opened -- and
its dangerous constructs are one line long. `curl | sh`, `>> authorized_keys`,
`rm -rf "$PREFIX/"`, `curl -k`, `history -c`: a grep finds every one of them
and is useless, because each has a legitimate twin. The checksum three lines
above the `chmod +x`, the temp directory the `rm -rf` was given by `mktemp
-d`, the self-signed certificate this script generated for the localhost it
is about to curl -- those are what separate the defect from the ordinary
case, and they are in the file rather than in the line.

That is the whole argument for judging these with a model: the construct is
matched by ast-grep, cheaply and exactly, and what the rest of the file
establishes about it is the question.

## The subject, and the one that did not work

The first attempt ported the source project's shape directly: `subject:
file`, one verdict per script, the sentence asking whether the script as a
whole fetches and runs code. It does not work. Over the same 11 scripts the
gap was **0.08** -- `verdict: rewrite` -- and the way it failed is the
interesting part. A hardened installer that downloads a binary, checks it
against a literal SHA-256 and installs it answered **0.77**, higher than a
CI helper that base64-decodes a blob from a paste service and evals it
(0.46). Asked about a whole script, the model answers a question about
atmosphere: this file downloads things and runs them, and that is what the
bad ones do.

Rewriting the question as one about one command, with `state: located` so
the file is still there to answer from, moved the same corpus to a gap of
**0.55**. The checksum is now something the model goes looking for, because
the question is about the bytes this line runs. Every rule in the pack is
built that way, and the one that was not is the measurement that says why.

## The eight

Each rule's own report -- corpus, attempts, fit, caveats -- is in
[`notes/`](notes/), written by the agent that built it. Summary:

| rule | at | subjects | bad | cleanTop | defect floor | headroom | flips |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [`hides-what-it-runs`](notes/hides-what-it-runs.md) | 0.30 | 19 | 8 | 0.11 | 0.52 | 0.19 / 0.19 | 0 |
| [`runs-downloaded-code`](notes/runs-downloaded-code.md) | 0.40 | 14 | 5 | 0.11 | 0.66 | 0.29 / 0.26 | 0 |
| [`installs-persistence`](notes/installs-persistence.md) | 0.50 | 16 | 4 | 0.22 | 0.80 | 0.28 / 0.30 | 0 |
| [`opens-a-backdoor`](notes/opens-a-backdoor.md) | 0.50 | 27 | 7 | 0.26 | 0.71 | 0.24 / 0.21 | 0 |
| [`takes-remote-commands`](notes/takes-remote-commands.md) | 0.50 | 17 | 6 | 0.23 | 0.79 | 0.27 / 0.29 | 0 |
| [`reads-secrets-it-does-not-own`](notes/reads-secrets-it-does-not-own.md) | 0.62 | 28 | 9 | 0.43 | 0.80 | 0.19 / 0.18 | 0 |
| [`destroys-beyond-its-scope`](notes/destroys-beyond-its-scope.md) | 0.66 | 26 | 7 | 0.47 | 0.85 | 0.16 / 0.19 | 0 |
| [`weakens-security`](notes/weakens-security.md) | 0.66 | 22 | 10 | 0.53 | 0.78 | 0.13 / 0.12 | 0 |

All eight: precision 1.00, recall 1.00, no decision flips over three
passes. 159 subjects, 56 defects. Eight SHIP, no COOKBOOK, no DROP --
which is a suspiciously clean sweep, and the reason is the subject shape
above: the first rule spent its three attempts finding it, and the other
seven started from it.

The ordering of the cutoffs is the interesting part. The three rules whose
construct is unambiguous once you see it -- an encoded payload, a pipe into
a shell, a cron entry -- fit at 0.30-0.50 with a quarter of headroom. The
three that fit at 0.62-0.66 are the ones where the defect and the clean
case are the SAME command and only the surroundings differ: `curl -k` at a
real host versus at the localhost this script just issued a certificate
for, `aws s3 cp` of the machine's own profile versus of a harvested one,
`rm -rf` of a `mktemp -d` versus of an unset variable. A higher cutoff
there is the corpus saying the model is less sure, not that the rule is
worse.

## Three things the pack measured that generalise

**1. What sets the cutoff is not the hard clean you designed.** Five of the
eight report independently that their highest clean is an ORDINARY
construct a few lines from a defect in the same file -- a `daemon-reload`
above a malicious timer, a `useradd` above two backdoors, a bare `mkfifo`
above a reverse shell -- while every carefully built legitimate twin fell
to the bottom of the band. With `state: located`, adjacency costs about
0.10-0.20. Two rules measured the opposite (`weakens-security` planted two
and got 0.11 and 0.12), so it is sentence-dependent: where it shows up, it
means the sentence is asking about the file's intent rather than the
construct's.

**2. A `note:` exception scoped to the script leaks; scope it to the
target.** `destroys-beyond-its-scope` excused a garbage collector sweeping
"the rebuildable scratch of a host dedicated to the work this script does".
Every fixture header claims to be that, and two device-wiping defects fell
0.17. Rewritten as a property of what is being deleted -- what a tool
re-creates from a recorded source -- it excused the one case and left the
defects alone.

**3. Telling the model to ignore the file destroys the evidence.**
`hides-what-it-runs` began with "do not convict a construct because the
file around it is hostile". Six of eight defects sat at 0.22-0.44.
Replacing it with the opposite -- the rest of the file is admissible
evidence about why this step is here -- moved the defect band up ~0.20 and
lowered cleanTop from 0.13 to 0.08.

## On real code

40 shell scripts from this machine's own repositories, 4,237 lines, all
eight rules, one run:

| rule | matched | reported | top clean | head |
| --- | --- | --- | --- | --- |
| `hides-what-it-runs` | 132 | 0 | 0.15 | +0.15 |
| `destroys-beyond-its-scope` | 34 | 0 | 0.34 | +0.32 |
| `runs-downloaded-code` | 15 | 5 | 0.16 | +0.24 |
| `installs-persistence` | 13 | 0 | 0.08 | +0.42 |
| `reads-secrets-it-does-not-own` | 13 | 0 | 0.37 | +0.25 |
| `opens-a-backdoor` | 0 | 0 | -- | -- |
| `takes-remote-commands` | 0 | 0 | -- | -- |
| `weakens-security` | 0 | 0 | -- | -- |

The five findings are all the same shape and all real: four `install.sh`
that download a release binary from GitHub and `chmod +x` it with no
checksum, and one `source` of a file the script downloaded earlier. They
answer 0.54-0.55 against fixture defects at 0.66-0.97, which is the right
ordering -- a GitHub release is not a paste service, and nothing in the
script establishes what arrived either way.

Three rules matched nothing in 40 ordinary development scripts. That is the
honest state of their real-code evidence: none. Their surfaces -- a
sudoers write, a reverse shell, a disabled TLS check -- do not occur in
scripts that build and test software, which is either good news about the
corpus or a warning that those three have never been exercised outside
their own fixtures. Both readings are available; the fixtures are all
anyone has.

## What the pack does not cover

Twelve of the twenty source checks are not in this first tranche:
`data_exfiltration`, `hidden_network`, `permission_abuse`, `deception`,
`telemetry`, `surveillance`, `supply_chain`, `resource_abuse`,
`lateral_movement`, `anti_removal`, `covert_fingerprinting`,
`suspicious_ci`. Several have obvious shell shapes -- a miner, an `ssh`
spray, a `curl` of every `~/Library` -- and were left for a second tranche
rather than diluted into this one.

`suspicious_ci` is the one with no plausible port. It asks whether a build
step does something unrelated to building, and the answer lives in where
the file sits -- `.github/workflows/`, a `Dockerfile` stage, a `postinstall`
hook -- which a `subject: node` rule does not carry. The rules that would
have caught its cases catch them anyway: a CI step that curls a secret out
is `reads-secrets-it-does-not-own` wherever it sits.

Per-rule blind spots are in each `notes/` file; the ones that recur:
a redirect destination behind a variable (`cat > "$CRED_DIR/token"`) is
invisible to every path regex in the pack; `explain:` labels were ported
verbatim from the source project and two rules report that they do not
partition a shell corpus; and several matcher branches (`schtasks`,
`rsync --delete`, `${IFS}` as a separator) have no labelled case behind
them at all.
