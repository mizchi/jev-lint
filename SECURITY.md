# Security

jev-lint provides review suggestions. A clean run, a high-confidence answer,
or a finding attributed to a project instruction is not a security approval.
Keep authorization, secret detection, dependency checks, and release controls
independent of model verdicts.

## Model judgments and untrusted input

Source code, comments, test names, Markdown, commit messages, diffs, and
documents supplied as context can contain attacker-controlled text. That
text can try to direct the model to suppress a defect or invent a finding.
[Issue #18](https://github.com/mizchi/jev-lint/issues/18) describes this as
Jev Program Decision Hijacking (JPDH); it does not provide a repository-specific
exploit or reproduction.

The request separates `state` from `questions`, but this JSON structure is
not an isolation boundary for the model. Some subject text and matcher captures
also appear inside question instructions. The model can return a structurally
valid, in-range answer influenced by malicious text. Response validation cannot
detect that semantic manipulation. Repeated requests, confidence values,
fitted cutoffs, and a second model judgment do not establish independence from
the same malicious evidence.

## Trust boundaries

| Input | Role and required trust |
| --- | --- |
| Reviewed source, tests, prose, messages, and diffs | Evidence for a judgment; treat as untrusted even when it contains instructions. |
| `AGENTS.md`, `CLAUDE.md`, and rule `context:` documents | Standards or context presented to the model. Review changes to these documents alongside the code; their contents can influence the judgment. |
| Rules, configuration, suppressions, and the verdict cache | Control what is checked or reported. Review and protect them as policy; an author who can change them can bypass a check without attacking the model. |
| The runner, dependencies, scanner binary, and custom parser libraries | Executable tooling. Use trusted versions when reviewing an untrusted checkout. |
| Model responses | Fallible external input. Accept only usable answers for the requested question ids, kinds, numeric ranges, and explanation labels. |

The runner uses numeric answers with local thresholds to produce findings and
an exit code. It does not execute model-generated commands or automatically
apply fixes. Integrations that act on its output need their own authorization
and independent review.

## Operational safeguards

- Keep compiler, conventional linter, security scanner, tests, and human review
  as separate checks. Do not let a model verdict alone authorize a merge,
  deployment, access grant, or acceptance of untrusted content.
- Review untrusted changes with a trusted runner and protected policy. Do not
  run branch-controlled tooling or parser libraries with privileged CI secrets.
  Treat configuration, suppression, instruction-document, and cache edits as
  part of the review.
- Use `--cache none` or `--force` when a fresh model judgment is needed instead
  of a cached answer. A fresh judgment is still exposed to malicious evidence.
- Inspect missing verdicts and request errors. `check`, `review`, `commits`,
  and `run` exit `3` for an incomplete run when no finding meets `--fail-on`;
  blocking findings take precedence with exit `1`. `replay` also exits `3`
  for missing or unusable recorded verdicts when no finding blocks.
  The generated git hooks deliberately allow exit `3` through, as documented
  in [the hook guide](docs/use-hooks.md#exit-3-does-not-block-the-shipped-hook).
- Keep secrets out of reviewed material: selected source and context are sent
  to the configured model endpoint. Supply API credentials only through the
  environment, and trust the endpoint receiving them.

## Reporting

For a sensitive report, open an issue requesting a private contact channel and
omit exploit details and credentials until that channel is agreed. Include the
affected version and integration; privately shared reproduction steps should
identify the attacker-controlled input, expected judgment, observed judgment,
and consequential action taken by the integration.
