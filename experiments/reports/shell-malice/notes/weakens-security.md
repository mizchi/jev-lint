# weakens-security (Bash)

## Rule

```yaml
id: weakens-security
language: Bash
kind: noul
# The command, not the script. "Is this script hostile" is a question about a
# program's intent and answers itself with the file's tone; "is this defence
# off for a reason this file shows" is a question about the words under the
# cursor, with the rest of the script in the state to find the reason in.
subject: node
state: located
# 0.66, fitted 2026-09-21 on the fixtures beside it (22 subjects: 10 defects,
# 12 cleans of which 10 hard, 3 passes). Cleans top out at 0.53 -- `--privileged`
# on a `--rm` container the command creates and destroys to partition a loop
# image -- and below it a long tail at 0.05-0.19: `curl -k` at a listener the
# script started on loopback with a certificate it generated, `iptables -F` in a
# namespace it added, `chmod 777` inside a tmpfs it mounted,
# `StrictHostKeyChecking=no` at a VM it launched. Defects start at 0.78
# (`staging_seed.sh`, whose `-k` reaches a shared staging host while an
# `openssl req -x509` four lines up makes a client certificate that establishes
# nothing about the server). Midpoint of a gap 0.25 wide, 0.13 of headroom below
# and 0.12 above, no decision flips over three passes and no subject moving more
# than 0.04. The first guess, 0.70, also scored 1.00/1.00, but it sits 0.08 under
# the lowest defect and the eval fits 0.66 from the corpus, so take the fit.
# `located` does not bleed here: the clean loopback health check three lines under
# `run_worker.sh`'s privileged container answers 0.12, and the clean at the foot of
# `provision_agent.sh` 0.11, both in files whose other subjects are defects.
at: 0.66
axis: file
severity: warning
# Four places a shell script can take a guard off, over-matched on purpose:
# a flag that names the check it skips, a setting written as `key=value`,
# a protection service stopped or a filter flushed, and a world-writable mode.
# Matching is by token, not by command name, so `ip netns exec ns iptables -F`
# and a bare `iptables -F` both arrive. What the model decides is what the
# defence was protecting and whether the script bounded it.
rule:
  any:
    - kind: command
      has:
        stopBy: end
        regex: "^(--insecure|--no-check-certificate|--no-verify|--no-verify-peer|--skip-verify|--insecure-skip-tls-verify|--no-signature|--skip-signature|--trusted-host|--allow-unauthenticated|--allow-untrusted|--force-yes|--nogpgcheck|--no-gpg-checks|--disable-gpg-check|--no-sandbox|--disable-web-security|--privileged|--disable-security|--no-verify-ssl)$"
    - kind: command
      all:
        - has: { field: name, regex: "^(curl|wget)$" }
        - has: { stopBy: end, regex: "^-[A-Za-z]*k[A-Za-z]*$" }
    - kind: command
      has:
        stopBy: end
        regex: "(sslVerify=[Ff]alse|StrictHostKeyChecking=no|UserKnownHostsFile=/dev/null|^strict-ssl$|NODE_TLS_REJECT_UNAUTHORIZED=0|PYTHONHTTPSVERIFY=0|GIT_SSL_NO_VERIFY=|^CURL_CA_BUNDLE=$|^REQUESTS_CA_BUNDLE=$|seccomp=unconfined|apparmor[:=]unconfined|insecure_skip_verify|verify=[Ff]alse)"
    - kind: variable_assignment
      all:
        - regex: "^(NODE_TLS_REJECT_UNAUTHORIZED=0|PYTHONHTTPSVERIFY=0|GIT_SSL_NO_VERIFY=.+|CURL_CA_BUNDLE=|REQUESTS_CA_BUNDLE=)$"
        - not: { inside: { kind: command } }
    - kind: command
      all:
        - has: { stopBy: end, regex: "^(systemctl|service|rc-service|chkconfig|setenforce|aa-complain|aa-disable|ufw|iptables|ip6tables|nft|spctl|csrutil|defender|clamscan|freshclam)$" }
        - has: { stopBy: end, regex: "^(stop|disable|mask|-F|--flush|flush|0|permissive|off|--add-exclusion|--disable)$" }
    - kind: command
      all:
        - has: { field: name, regex: "^(chmod|setfacl)$" }
        - has: { stopBy: end, regex: "^(777|0777|666|0666|a\\+rwx|o\\+w)$" }
ask: >-
  This command takes a security check or a host defence off, and nothing in the
  script confines it to something the script itself put there.
criteria:
  "true": >-
    Certificate or signature verification, a sandbox or isolation boundary, a
    packet filter, SELinux or AppArmor, antivirus, or automatic updates is
    switched off, skipped or gutted here -- and what it was guarding is a real
    one: a public or shared endpoint, a package feed the internet serves, a
    machine that outlives this run, or the host's own configuration. No reason
    for it appears anywhere in the file. Relaxations that persist after the
    script exits are this case even when a reason is offered, because the next
    program to run on that host inherits them: a global `npm config set
    strict-ssl false`, an edited `/etc/selinux/config`, a stopped, disabled or
    masked firewall, antivirus or updater, a container given `--privileged` or
    an unconfined seccomp profile for a service that keeps running.
  "false": >-
    The script shows what the relaxation is bounded to, and the bound is
    something this same script created and can throw away: the address is
    `localhost`, `127.0.0.1`, or one the script just read back from a container,
    namespace or VM it launched; the certificate it declines to verify is one
    the script generated a few lines up; the flushed rules, the loosened mode or
    the disabled isolation apply inside a namespace, a temporary mount or a
    directory this script made and removes on exit. One command, one disposable
    target, and the file says which. A documented insecure-development flag or
    an administrator policy the script names is also this case.
note: >-
  Scope and lifetime, not danger: `curl -k` is the defect against a vendor's CDN
  and clean against a listener this script started on loopback two lines earlier,
  and the flag is identical in both. Read outward from the command for the bound
  -- a `mktemp -d` that is trapped for removal, an `openssl req -x509` that made
  the certificate, an `ip netns add`, a `docker run` bound to `127.0.0.1`, a
  `mount -t tmpfs` -- and if one is there, the answer is false however alarming
  the token is. A private or internal-looking hostname is not a bound: `10.0.0.5`
  and `internal.corp` are real machines that outlive the run. Neither is a
  variable name, a `set -euo pipefail`, a `--force` somewhere else, or a comment
  asserting the source is trusted; a comment that states the mechanism -- which
  certificate, whose machine -- is evidence, a comment that states a conclusion
  is not. Turning a protection off for the length of one command weighs less than
  writing the same relaxation into a config file or a unit, and a permanent one
  is this rule's case even where a single call would not have been.
explain:
  tls_or_signature: Skips certificate, TLS, or code-signature verification.
  sandbox_off: Disables a sandbox, CSP, or isolation boundary.
  defense_tamper: Stops, excludes, or reconfigures antivirus, firewall, or updates to hide activity.
```

## Corpus

22 subjects found, 10 labelled `bad`, 12 `clean` -- 10 of the cleans are the
defect's own syntax done legitimately. 11 files, 16-21 lines each, no markers.

The bad cases:

- `provision_agent.sh:9` -- `curl -k` at a vendor's public CDN on a production
  worker; TLS off for the one fetch whose bytes become a root-owned binary, with
  no reason anywhere in the file. The same file's line 19 is a labelled clean.
- `ci_image.sh:10` -- `npm config set strict-ssl false --global`, baked into a
  CI runner image, so every later job's `npm install` inherits it; no mirror or
  proxy is mentioned.
- `ci_image.sh:13` -- `--trusted-host pypi.org --trusted-host
  files.pythonhosted.org`: TLS validation dropped against the *real* public
  index, which is the opposite of pinning to an internal one.
- `db_connectivity_fix.sh:7` -- `iptables -F` on the primary itself, the whole
  packet filter removed to get one replica connecting.
- `db_connectivity_fix.sh:8` -- `systemctl disable --now firewalld`, so the host
  also comes back with no firewall; the CIDR five lines up is exactly what a
  rule would have allowed.
- `db_connectivity_fix.sh:10` -- `setenforce 0` plus a `sed -i` into
  `/etc/selinux/config`: off now and off after reboot, instead of a port label.
- `run_worker.sh:7` -- `systemctl mask unattended-upgrades`: security updates
  stopped on the encoder box, unrelated to anything the worker needs.
- `run_worker.sh:9` -- `--privileged --security-opt seccomp=unconfined` on a
  `--restart unless-stopped` production container; the boundary is gone for the
  life of the host. Three lines under it sits a labelled clean.
- `staging_seed.sh:16` -- the trap case. `curl -k` at a shared staging host on a
  public name, in a file that *does* contain an `openssl req -x509` and a
  trapped `mktemp -d` four lines up -- but the certificate it generates is a
  client certificate, which establishes nothing about the server.
- `staging_seed.sh:19` -- the same `-k` on the health check.

The hard cleans: `curl -k` at a loopback listener the script started with a
certificate it generated (`tls_listener_smoke.sh:15,19`, `importer_e2e.sh:15`),
`NODE_TLS_REJECT_UNAUTHORIZED=0` as a one-command prefix at that same listener
(`:21`), `git -c http.sslVerify=false` scoped to one clone from a localhost
fixture registry (`importer_e2e.sh:17`), `StrictHostKeyChecking=no` at a VM the
script launched and purges (`vm_image_smoke.sh:11,14`), `chmod 777` inside a
tmpfs it mounted and unmounts (`spool_permissions_fixture.sh:11`), `iptables -F`
inside a namespace it added and deletes (`netns_rules_test.sh:11`),
`--privileged` on a `--rm` container that partitions a loop image
(`build_disk_image.sh:10`), and two adjacency cases: `curl -fsSk` at
`127.0.0.1:9100` for the agent the script just installed, ten lines under
`provision_agent.sh`'s defect, and `curl -fsSk` at `127.0.0.1:8099` three lines
under `run_worker.sh`'s privileged container. Both sit in files whose every other
subject is a defect, which is the `state: located` contamination test.

## Attempts

One attempt. The sentence separated first try; the second round of work was the
corpus, not the wording.

- **Attempt 1** (`subject: node`, `state: located`, the sentence above, 18
  subjects): `gaps` = `works`, gap **0.65**, head +0.50, suggest 0.53. Cleans
  0.05-0.19, defects 0.82-0.95. Too easy: every clean sat in the bottom fifth,
  which is the shape `calibration.md` warns produces a cutoff that fails on the
  first unseen file.
- **Corpus round 2** (same sentence, +`staging_seed.sh` as a defect that carries
  the decoy evidence a lazy reading would take as a bound, +`build_disk_image.sh`
  as `--privileged` that really is bounded; 21 subjects): gap **0.24**, cleans
  top 0.54, defects start 0.78. Still `works`, and now the gap is one a real
  file can fall into. No sentence change was made between these two runs, so the
  difference is entirely the corpus.
- **Corpus round 3** (same sentence, +a clean loopback health check three lines
  under `run_worker.sh`'s privileged container, on the pack coordinator's note
  that an adjacent clean is often the real cleanTop under `state: located`; 22
  subjects): the adjacent clean answered **0.12**, not near the top, so this
  rule's cleanTop is still the `--privileged` case at 0.53. Gap **0.25**, no
  flips. The contamination the note warns about is not present here -- worth
  saying, because it means the sentence is reading the construct and not the
  file's tone, which was the whole reason for `subject: node`.

## Fit

| | |
| --- | --- |
| fitted cutoff | **0.66** (midpoint of 0.53 / 0.78) |
| precision | 1.00 |
| recall | 1.00 |
| tp / fp / fn | 10 / 0 / 0 |
| decision flips over 3 passes | 0 |
| max per-subject spread | 0.04 |
| cleanTop | 0.53 (0.55 on its highest pass) |
| lowest defect | 0.78 (0.76 on its lowest pass) |
| headroom | 0.13 below, 0.12 above; 0.11 / 0.10 against worst-pass bounds |
| adjacent-clean contamination | none: 0.12 and 0.11, in defect-bearing files |

## Verdict

**SHIP.** Separates with 0.12 of headroom on both sides and no flips, on a
corpus whose cleans are the defects' own syntax -- including one clean that the
model itself only clears by 0.12, and one defect that is deliberately dressed in
a clean case's evidence.

## What I would change

- The contested label is `build_disk_image.sh:10` (`--privileged` on a `--rm`
  container), the only subject the fit actually fights over at 0.53. I argue it
  clean: the container is created and destroyed by that one command and loop
  partitioning genuinely needs the capability. A reviewer who thinks
  `--privileged` is never clean would move it to `bad`, the defect band would
  then run 0.53-0.95 against cleans topping at 0.19, and the cutoff would want to
  be ~0.36. If
  this rule ever produces a disputed finding in the field, that is the label to
  re-argue first, not the sentence.
- The matcher's fifth arm (`systemctl|iptables|...` × `stop|disable|mask|-F|0`)
  is a token-pair, not a command shape, so it is the one most likely to
  over-match on real scripts -- `nft flush ruleset` is in, but so is any command
  that happens to mention `systemctl` and `0`. That is the intended direction of
  error, but it is where the first unwanted subject will come from.
- `chmod 777` currently only matches a literal mode. `chmod -R 0777` is in;
  `chmod a=rwx` is not.
- Worth a second copy for PowerShell (`Set-MpPreference -DisableRealtimeMonitoring`,
  `[ServicePointManager]::ServerCertificateValidationCallback`) if the pack ever
  grows one; the sentence would carry over unchanged, the matcher would not.

## Cost

171 requests over seven runs (one `gaps`, one `eval --repeat 1`, five
`eval --repeat 3`), ~390,000 input tokens, **$0.0152** by the tool's own
summaries. Budget was $0.10.
