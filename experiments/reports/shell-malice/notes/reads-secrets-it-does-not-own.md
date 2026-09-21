# reads-secrets-it-does-not-own (Bash)

## Rule

```yaml
id: reads-secrets-it-does-not-own
language: Bash
kind: noul
# The command, not the script. "Is this script stealing credentials" is a
# question about a whole program's intent, and every deploy script that touches
# `~/.aws/credentials` answers yes to it; "is the secret under this command one
# the script was given, and is this where it belongs" is a question about the
# text under it, with the rest of the file in the state to say what the script
# was given and what it is for.
subject: node
state: located
# 0.62, fitted 2026-09-21 on the fixtures beside it (28 subjects: 9 defects,
# 19 cleans of which 13 hard, 3 passes). Cleans top out at 0.43 -- an `scp` of
# `.gitconfig` to the same hardcoded host the line above sent a private key to,
# which is contamination from `state: located` and not a property of the command;
# every other clean is at 0.20 or below, including the deploy that reads its own
# `~/.aws/credentials`, the `curl -d` that carries the script's own bearer token,
# and the private key written to `~/.ssh` from a value the workflow handed over.
# Defects start at 0.80 (`dotfiles.sh`, the private key `scp`'d to a mirror,
# which reads as a team sync until you notice the half that leaves is the secret
# one). Midpoint of a gap 0.37 wide, 0.18 of headroom on each side, no decision
# flips over three passes, max pass-to-pass spread 0.03. The first guess, 0.70,
# sat inside the defect band and lost the `scp` on the sentence's first two
# attempts, when the question weighed whose secret it was and not where it went.
at: 0.62
axis: file
severity: warning
# Two halves of the same defect, over-matched on purpose and joined by `any:`:
# a command that names a credential store, and a command that carries a body
# off the box. A pipeline is matched whole so that `env | curl --data-binary @-`
# is one question rather than two, and the commands inside one are left to it.
# What the model decides is whose secret it is and where it is going.
utils:
  touches_or_sends_secrets:
    kind: command
    any:
      # an argument, a redirect target or a trap body that names a credential store
      - has:
          stopBy: end
          regex: "\\.ssh|id_rsa|id_ed25519|id_ecdsa|\\.aws/credentials|\\.netrc|\\.npmrc|\\.pypirc|\\.docker/config\\.json|\\.git-credentials|\\.env|kubeconfig|[Kk]eychain|\\.gnupg|/etc/shadow|ssl/private|\\.pem|cookies\\.sqlite|Cookies"
      # the whole environment, with nothing selected out of it. Written as a
      # regex over the command's own text rather than `not: {has: argument}`,
      # because ast-grep rejects a `not:` anywhere inside a `utils:` entry --
      # "Rule must have one positive matcher", pointed at `utils`, not at the rule.
      - regex: "^(env|printenv)$"
      # an HTTP client given a body or a file to upload
      - all:
          - has: { field: name, regex: "^(curl|wget|http|https)$" }
          - has:
              stopBy: end
              regex: "^(-d|--data|--data-raw|--data-binary|--data-urlencode|-F|--form|-T|--upload-file|--post-file|--post-data)$"
      # a command whose whole job is to move bytes to another host or mailbox
      - has:
          field: name
          regex: "^(nc|ncat|socat|scp|sftp|rsync|mail|mailx|sendmail|ftp|tftp)$"
      # an object-store copy
      - all:
          - has: { field: name, regex: "^(aws|gsutil|az|rclone|b2)$" }
          - has: { stopBy: end, regex: "^(s3|cp|copy|sync|storage)$" }
rule:
  any:
    - kind: pipeline
      has: { stopBy: end, matches: touches_or_sends_secrets }
    # A redirect target is NOT inside the `command` node in this grammar -- it is
    # a sibling of it under `redirected_statement` -- so `printf "$KEY" >
    # ~/.ssh/id_ed25519` is invisible to any rule that only looks at commands,
    # and that is the whole `unexpected_secret_write` shape. Matched on the
    # `redirect` field only, so a command that already matched on its arguments
    # and happens to carry a `2>/dev/null` is still one subject, not two.
    - all:
        - kind: redirected_statement
          has:
            field: redirect
            regex: "\\.ssh|id_rsa|id_ed25519|id_ecdsa|\\.aws/credentials|\\.netrc|\\.npmrc|\\.pypirc|\\.docker/config\\.json|\\.git-credentials|\\.env|kubeconfig|[Kk]eychain|\\.gnupg|/etc/shadow|ssl/private|\\.pem"
        - not: { inside: { stopBy: end, kind: pipeline } }
    - all:
        - matches: touches_or_sends_secrets
        - not: { inside: { stopBy: end, kind: pipeline } }
ask: >-
  A secret ends up somewhere it does not belong: this command either takes
  credentials the script was never given, or leaves credentials it was given
  where the job it was given them for does not put them.
criteria:
  "true": >-
    Either half is enough. (a) What this command reads, collects or forwards is
    a credential belonging to the user or the machine rather than to this script
    -- the contents of `~/.ssh`, a private key, `.aws/credentials`, `.netrc`,
    `.npmrc`, `.git-credentials`, a keychain, a cookie store, or the whole
    environment with nothing selected out of it -- and the script moves it:
    posts it, uploads it, pipes it to another host, mails it, or gathers it with
    others into one place to send. (b) Or the secret is one the script is
    entitled to, and this command leaves it somewhere the job does not put it --
    a log or a report other people read, a build artifact, a file in the working
    tree, anything version control will take, a world-readable path, a bucket or
    a host outside the pipeline it belongs to. Rendering a credential out of a
    tool that was keeping it (`--raw`, `config view`, `env` with nothing
    selected) and writing the result down is this case, and so is staging or
    committing the file that was written. What decides (b) is where the secret
    comes to rest and who can read it there, not whether the script was entitled
    to hold it. A private key leaving the machine that holds it is this case
    however the destination is described -- a mirror, a sync target, a team
    host, a backup -- unless what leaves is encrypted or is the public half. A
    plausible-looking analytics, telemetry, sync or backup destination is not
    thereby an expected one, and a comment calling it a diagnostics bundle is
    not either.
  "false": >-
    Either the secret is the script's own and this is the place it goes -- a
    token read from the environment or a project `.env` and put in an
    `Authorization` header to the service this script talks to; `~/.aws/credentials`
    read so the `aws` CLI can do the deploy this script exists for; a deploy key
    or an `.npmrc` written from a value the workflow handed over, into the file
    the tool reads it from, with the permissions and the cleanup that go with it;
    a credential obtained for the job by the tool that issues it; TLS material
    backed up encrypted to the estate that owns it -- or nothing here is a secret
    at all: a count of variables, a host report, a config file with no credential
    in it, a public key, a known_hosts entry, an artifact copied to the project's
    own bucket. A credential used, stored or moved for the one purpose the
    surrounding script exists for is not misplaced, however sensitive the file it
    came from is.
note: >-
  Where it comes to rest decides as much as where it came from. Reading a
  credential is what credentials are for -- `aws s3 cp` on the machine's own
  profile, `curl -d` with the script's own bearer token, `scp` into the estate's
  backup host are the normal shape of this, not the defect -- so the question is
  never "did it touch a secret" but "whose secret, and where has it ended up".
  Read the rest of the file for what this script is for and what it was handed: a
  value the workflow injected and the script immediately uses is owned; a store
  the script goes and finds under `$HOME` is not. `env` or `printenv` with no
  argument is this case only when the whole dump comes to rest somewhere that
  keeps it -- a count, a line number, a `grep -c` is not a payload, and the same
  `env` in a POST body or appended to a log under a web root is. Writing a secret
  to disk is this case when the location is wrong for it, not when it is the file
  the tool reads it from; a credential file that reaches the working tree, an
  artifact or a commit is in the wrong location however short the path is.
  Reading or writing a private key is not this case when the same script
  installed it, and obtaining a credential is not taking one. Judge this command
  and not its neighbours: a file with no credential in it going to the very
  destination the line above sent a key to is still a file with no credential in
  it, and a command beside a defect does not inherit it. `set -euo pipefail`, a
  `chmod 600`, a `trap ... rm`, a reputable hostname, and a comment describing
  the send as telemetry, diagnostics or sync establish nothing.
explain:
  env_exfil: Harvests environment or credential stores and sends them off-box.
  browser_or_token_steal: Reads cookies, tokens, or keychains and copies them elsewhere.
  unexpected_secret_write: Writes secrets to a location a user would not expect.
```

## Corpus

11 shell scripts, 18-21 lines each, of the kind that sit in a real repository:
an npm postinstall, a CI runner report, a dotfile sync, a build-cache warmer, a
cluster bootstrap, a site deploy, a status-API notifier, a TLS backup, a runner
env check, a deploy-key provisioner, an npm publish. No markers in the files --
this rule reads the whole file through `state: located`, so every label lives in
`expect.yml`.

**28 subjects found / 9 bad / 19 clean, of which 13 are hard.**

The nine bad cases:

- `postinstall.sh:8` -- copies the whole of `~/.ssh` into a bundle it is about
  to upload; a package installer has no business in the user's key directory.
- `postinstall.sh:9` -- the user's `~/.aws/credentials`, into the same bundle.
  Not credentials the script was handed; ones it went and found.
- `postinstall.sh:10` -- `.npmrc` and `.git-credentials`, same collection.
  Three stores gathered into one directory is the harvest.
- `postinstall.sh:14` -- `curl -F` of the archive to a third-party endpoint.
  The send half of the same defect.
- `ci_report.sh:13` -- `env | curl --data-binary @-`: the entire environment,
  unfiltered, as a POST body to a host that is not the pipeline's. On a CI
  runner that is every injected secret.
- `dotfiles.sh:14` -- `scp` of `~/.ssh/id_ed25519` to a hardcoded IP. A dotfile
  sync needs the public half at most.
- `cache_warm.sh:11` -- `env | grep '^AWS_'` appended to a log under
  `/var/www/html`. The script's own credentials, come to rest where anyone who
  can reach the box reads them.
- `k8s_bootstrap.sh:13` -- `kubectl config view --raw` redirected into the
  working tree. `--raw` is the flag that keeps the secret in.
- `k8s_bootstrap.sh:15` -- `git add` of that rendered kubeconfig, two lines
  before the commit. A production cluster credential into version control.

The thirteen hard cleans are the same shapes done legitimately, and four of them
sit in the same file as a defect, which is what actually sets `cleanTop`:

- `deploy.sh:9` / `deploy.sh:17` -- reads its own `~/.aws/credentials`, then
  `aws s3 cp` to the project's bucket. The exfil-shaped sink doing its job.
- `notify_api.sh:6` / `:16` -- sources the project's `.env`, puts the token in
  an `Authorization` header to the API that same `.env` names.
- `backup_certs.sh:10` / `:15` -- tars `/etc/ssl/private` and `scp`s it off the
  box: private keys leaving the machine, encrypted, to the estate that owns them.
- `ci_env_check.sh:7` -- two argument-less `env` pipelines, the matched shape of
  the `ci_report.sh` defect, producing `wc -l` and `grep -c`.
- `ci_report.sh:15` -- the identical `curl --data-binary` upload to the identical
  host, two lines after the defect, carrying `uname`/`df`/`nproc` output.
- `dotfiles.sh:16` -- the identical `scp` to the identical hardcoded IP, two
  lines after the key, carrying `.gitconfig`.
- `cache_warm.sh:14` / `:17` -- `aws s3 cp` beside the `env` dump that is the
  defect.
- `k8s_bootstrap.sh:8` -- `aws eks update-kubeconfig`: obtaining a credential
  for the job, which is not taking one.
- `npm_publish.sh:11` -- writes `NPM_TOKEN` into `~/.npmrc`: a secret written to
  disk, and the file npm reads it from, under `umask 077`, removed by a trap.
- `provision_key.sh:9` -- writes a private key to `~/.ssh/id_ed25519` by
  redirect, from a value the workflow injected.

## Attempts

1. `ask`: "The secret this command handles is not one this script was given to
   use, or it is going somewhere the work this script describes does not need it
   to go." -- `gaps`: **rewrite**, gap **0.18**, head +0.01, cleanTop 0.42.
   P 1.00 / R 0.67 at 0.70; no separating cutoff. The ownership clause led and
   the destination clause trailed, so the three defects where the script *owns*
   the secret and merely misplaces it sank into the clean band: the AWS dump to
   the web-root log at 0.63, the raw kubeconfig at 0.42, the `git add` at 0.35.
2. Same subject and state; the sentence rebuilt as two equal halves -- "either
   takes credentials the script was never given, or leaves credentials it was
   given where the job it was given them for does not put them" -- with
   `criteria.true` split into a lettered (a) take and (b) misplace, and the note
   given "where it comes to rest decides as much as where it came from".
   Gap **0.21** (0.48 -> 0.69), P 1.00 / R 0.89 at 0.70, fitted 0.59, 0 flips.
   All three (b) defects rose to 0.82-0.84. The remaining miss was the private
   key `scp` at 0.69 -- an (a) defect the model read as a team mirror.
3. Two sentences added, both general rather than corpus-shaped: to
   `criteria.true`, that a private key leaving the machine that holds it is this
   case however the destination is described, unless what leaves is encrypted or
   is the public half; to `note`, that this command is judged and not its
   neighbours. Gap **0.37** (0.43 -> 0.80), P 1.00 / R 1.00, fitted 0.62.
   The key `scp` moved 0.69 -> 0.80 and the `.gitconfig` beside it 0.48 -> 0.43.

## Fit

Fitted cutoff **0.62**, three passes, 28 subjects.

| | |
| --- | --- |
| precision | 1.00 |
| recall | 1.00 |
| tp / fp / fn | 9 / 0 / 0 |
| decision flips over 3 passes | 0 |
| max pass-to-pass spread | 0.03 |
| cleanTop | 0.43 |
| lowest defect | 0.80 |
| gap | 0.37, headroom 0.19 below / 0.18 above |

The clean band is 0.04-0.20 for eighteen of nineteen cleans; the nineteenth,
`dotfiles.sh:16`, is at 0.43 on its own. That subject is `scp .gitconfig` to the
same hardcoded host the line above sent a private key to -- `state: located`
contamination, not a property of the command, and the real `cleanTop` for this
rule. A corpus without an adjacent clean would have reported 0.20 here and fitted
a cutoff near 0.50 that the first two-command file would have broken.

## Verdict

**SHIP** -- 0.37 of separation with 0.18 of headroom on each side, no flips and
a 0.03 maximum spread, on a corpus where thirteen of nineteen cleans are the
defect's own shapes (`aws s3 cp`, `curl -d` with a bearer token, `scp` of private
keys off the box, `env` with no argument, a private key written to `~/.ssh`) done
for the job the script exists for.

## What I would change

- **The matcher's blind spot is the variable redirect.** `cat > "$CRED_DIR/token"`
  carries no credential path in its text, so the `redirected_statement` arm never
  sees it. Everything the arm catches in this corpus has a literal path. A rule
  that has to catch that shape needs a different hook -- the command that later
  reads the variable, or the assignment.
- **The `explain:` labels do not partition this corpus cleanly.** `env_exfil` and
  `browser_or_token_steal` both describe `postinstall.sh` (it takes `~/.ssh` and
  `.npmrc` in one sweep), and `unexpected_secret_write` is the only label for
  `cache_warm.sh` and both `k8s_bootstrap.sh` defects. Ported verbatim as
  instructed; with overlapping options splitting the mass I would expect low
  confidences on the first two, and would collapse them to one `credential_theft`
  label before shipping `--explain` on this rule.
- **The corpus has no macOS case.** `security find-generic-password` and
  `login.keychain` are in the regex and in the criteria but are never exercised.
  So is the browser-cookie shape (`cookies.sqlite`). Both are in the original
  check's reasons; both are untested here.
- **`postinstall.sh` contributes four of the nine defects**, which weights the
  fit toward one file. Two more files at the `unexpected_secret_write` end would
  balance it better than three more `cp` lines would.

## Cost

| run | requests | dollars |
| --- | --- | --- |
| `gaps`, attempt 1 | 11 | $0.00127 |
| `eval --repeat 1`, attempt 1 | 11 | $0.00127 |
| `eval --repeat 1`, attempt 2 | 11 | $0.00150 |
| `eval --repeat 1`, attempt 3 | 11 | $0.00160 |
| `eval --repeat 3`, attempt 3 | 33 | $0.00481 |
| `eval --repeat 3 --accept` | 33 | $0.00481 |
| **total** | **110** | **$0.01526** |

Roughly 33,100 input tokens per pass at the final matcher (the tool's `--dry-run`
estimate; the paid summaries report dollars, not tokens), so about 331,000 input
tokens over the ten passes. Every matcher iteration was done on `--dry-run`, at
no cost.
