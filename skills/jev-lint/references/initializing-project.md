# Suggesting initial rules

Use this workflow when initializing jev-lint or recommending which rules to
enable. Ground the proposal in actual project files and the installed catalog.
The CLI can do the initial selection using Jev directly, without a separate
LLM, agent runtime or hand-written YAML generation. Live requests need
`TYPESAFE_API_KEY` or `TYPESAFEAI_API_KEY` in the environment.

## Inspect and recommend

```sh
jev-lint introspect --dry-run
jev-lint introspect --record .jev-lint/introspection.json
jev-lint init --introspect --record .jev-lint/introspection.json
jev-lint check --dry-run --show-subjects --cache none
```

`introspect [directory]` accepts a project directory, defaulting to the current
directory. Without `--write` it prints recommendations and a proposed config.
`--write` creates a new `.jev-lint.yaml` in that project. `--json` emits the
versioned report instead of text. Plain `init` still enables all shipped rules;
it does not perform introspection.

`init --introspect [directory]` is the initialization form of `introspect --write`;
it creates the recommended config without a separate `--write` flag.
`init --introspect --dry-run` only displays the metadata plan, with no requests
or writes. Its `--config <new.yaml>` selects a new output file, as `--output`
does; neither loads existing settings. Choose one output flag. Hook installation
(`--pre-commit` or `--pre-push`) is a separate init mode.

For an existing config, generate a separate proposal:

```sh
jev-lint introspect --write --output .jev-lint.proposed.yaml
# Equivalent initialization form:
jev-lint init --introspect --config .jev-lint.proposed.yaml
```

The command refuses to replace an existing config, even with `--force`.
Preserve explicit rule choices, calibrated cutoffs, exclusions, custom parser
declarations and hook settings when applying a proposal. A recommendation-only
request calls for the proposal, while a setup request authorizes creating the
new config. Install hooks or change CI when that is part of the requested setup.

The model receives eligible file paths, package script/dependency names and
catalog descriptions. Source bodies, script commands, dependency versions,
environment values and hidden-file contents are not sent. It does not execute
project scripts or load custom parser libraries. Rule YAML and explicit rule
context are read as policy data by the normal loader. `-R` can select a trusted
alternative catalog; ordinary `.jev-lint.yaml` settings are not loaded.

## Explain the proposal

Distinguish these decisions and show representative file paths for each rule:

| decision | meaning |
| --- | --- |
| `enable` | belongs in the conservative starter given the visible metadata |
| `defer` | potentially useful after inspecting claims, conventions or workflow |
| `skip` | the observed scope or document genre makes it unsuitable |
| `insufficient_context` | missing information prevents a usable recommendation |

The current core consists of `fn-name-promises` for observed source languages,
`test-name-verifies-claim` for behavior-test paths, and the two agent-instruction
rules for `AGENTS.md`. Check the installed catalog rather than assuming a variant
exists in every language. Both a JavaScript file and a TypeScript file can use
the ECMAScript variants under `typescript/`.

Explain conditional candidates by the evidence still needed:

| family | evidence before adding it |
| --- | --- |
| comments, safe/pure/idempotent names, logs and errors | actual source claims and behavior |
| mocks, snapshots and paired failure paths | assertions and verified test relationships; a test directory alone is insufficient |
| variable/module naming | the project's naming conventions and a reviewed sample |
| prose rules | an appropriate editorial genre; technical references, instruction manuals and historical measurements are controls |
| npm script names | commands behind the script names |
| Git rules | the intended commit/change review workflow and applicable instructions |

Avoid duplicate initial test-name checks: prefer `test-name-verifies-claim` and
defer `test-name-describes-code`. Preserve shipped severities and cutoffs; model
preferences do not calibrate new cutoffs or justify making findings blocking.

## Verify before adopting more rules

The metadata inventory establishes file eligibility, not actual matcher hits
or evidence that a defect exists. After creating a config, inspect
`check --dry-run --show-subjects --cache none`: explain selected targets, matched
subjects, planned requests and cost. Investigate unmatched and unpaired results.
Do not call zero matches a successful coverage check. A paid sample can then
establish whether conditional rules fit; record it and inspect findings against
the code before changing thresholds or severities.

Use `introspect --replay .jev-lint/introspection.json` from the same project
directory with the same `--exclude` and `-R` choices to validate a recorded
recommendation without requests. Hidden output paths are already excluded; repeat
an exclusion for any non-hidden proposal path. Replay binds
metadata, rule policy and question identity; it does not retest model behavior.
File contents that were never model input are outside that freshness claim.

Inventory and model failures remain partial or failed and cannot create a config.
Missing parsers, entry/file/metadata budgets and stale inventories are visible.
Defaults bound the inventory to 10,000 walked entries, 500 visible paths and
24,000 path characters, with at most ten 64 kB package manifests and 128 rule
candidates. Serialized model metadata is capped at 60,000 characters. Live
requests also have request, token, time and cost limits. Narrow the project
directory or exclusions when a bounded inventory is incomplete.
The report stays `UNREVIEWED`; even a complete starter is not quality approval.
See `jev-lint introspect --help` for the command surface.
