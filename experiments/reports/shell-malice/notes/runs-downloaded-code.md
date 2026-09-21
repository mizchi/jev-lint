# runs-downloaded-code — SHIP, at 0.40

The first rule of the pack, and the one whose three attempts found the
subject shape the other seven started from.

**Rule**: [`rules/shell/runs-downloaded-code/rule.yml`](../../../../rules/shell/runs-downloaded-code/rule.yml).
Port of the `dynamic_code` check from is-malicious.

**Corpus**: 11 fixtures, 14 subjects, 5 bad, 9 clean of which 6 hard.

Defects: two downloads piped into `bash` and `sh` in a worker bootstrap; an
`eval` of a base64 blob fetched from a paste service; an `eval` of the body
of a remote HTTP response in a container entrypoint; a `chmod +x` on a
binary downloaded with no checksum, whose `--self-check` reads as a check
until you notice it tests that the binary runs rather than what it is.

Hard cleans, each the defect's own shape done right: the same `chmod +x`
three lines after `sha256sum -c` against a literal in the script; the same
`chmod +x` after `gpg --verify` against a named keyring; three `eval "$(...)"`
of local shell hooks (`ssh-agent`, `direnv`, `starship`) -- the syntax of
the defect with nothing from outside; a pinned `apt-get` and a
`--require-hashes` pip install; three `curl` pipelines ending in `jq`,
`grep` and `head`.

## Attempts

| # | shape | gaps | result |
| --- | --- | --- | --- |
| 1 | `subject: file`, "fetches code and runs it without establishing what arrived" | rewrite, gap 0.08, head +0.01 | P 0.50 / R 0.25. The verified installer answered **0.77**, the pastebin `eval` **0.46**. |
| 2 | `subject: file`, "a reader cannot tell what code it will run" | — | worse: three cleans over the cutoff, including a `curl` that only POSTs to an API (0.73). |
| 3 | `subject: node`, `state: located`, "the bytes THIS command runs came from outside, and nothing in the script establishes what arrived" | works, gap 0.55 | P 1.00 / R 1.00. |

Attempt 1 is the measurement worth keeping. Asked about a whole script the
model answers a question about atmosphere: this file downloads things and
runs them, and that is what the bad ones do. The checksum is right there in
the text and it does not help, because the question was not about any
particular bytes. Attempt 3 changed no evidence -- `located` puts the same
file in the state -- and moved the same corpus by 0.47 of gap.

The matcher had to be rebuilt for the corpus, not only the sentence: with
an execution-shaped matcher the clean cases became invisible (an installer
that downloads and verifies has no pipeline into a shell), so five fixtures
were rewritten to put a matched construct on the clean side -- a `chmod +x`
after the checksum, curl pipelines that end in data tools. A clean case the
matcher cannot see is not a clean case.

## Fit

`at: 0.40`, the midpoint. 3 passes, tp 5 / fp 0 / fn 0, P 1.00, R 1.00, 0
flips. Cleans top at 0.11, defects start at 0.66, headroom 0.29 below and
0.26 above. The first guess, 0.70, sat inside the defect band and lost the
dropper on two passes of three.

## Verdict

**SHIP.** Widest gap in the pack, and the only rule with real-code
findings: 15 subjects over 40 scripts from this machine, 5 reported, top
clean 0.16, head +0.24.

## What I would change

The `aria2c`/`fetch` branches have no labelled case. The rule cannot see a
download whose URL is assembled at runtime from parts, and it says nothing
about a script that downloads into a directory another script later
executes -- provenance across files is not a question a single subject can
carry.

## Cost

55 requests over four paid runs (one `gaps`, one `eval --repeat 1`, two
`eval --repeat 3`), ~$0.003.
