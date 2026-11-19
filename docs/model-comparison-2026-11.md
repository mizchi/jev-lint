# Decision-model comparison, November 2026

Jev remains the default. Perplexity's free decision model is promising for two
TypeScript starter rules, but it over-selected rules in automatic initialization.
Liquid D1.2 Ultra and Mammoth also gained some detections and lost others. None
has earned a catalog-wide replacement recommendation at the shipped cutoffs.

## Selecting a model

Use the existing `--model`, configuration `model:`, or `JEV_LINT_MODEL` with an
explicit `openrouter:` prefix. Supported native IDs are:

| Model ID after `openrouter:` | Listed input USD/M tokens | Evaluation outcome |
| --- | ---: | --- |
| `typesafe/jev-1.14` | 0.042 | Default Jev when an OpenRouter key is set |
| `liquid/d1.2-ultra` | 0.042 | Strong on naming and case review; more comment misses, a test-name false positive and one HTTP 504 |
| `liquid/d1.2` | 0.020 | Three misses on the initial 35-case function screen; stopped there |
| `baseten/mammoth-1` | 0.100 | Some improvements, but extra misses or false positives and higher measured cost |
| `perplexity/pplx-decider-v1.3:free` | 0 | Same aggregate results as Jev on 146 naming cases; failed the conservative starter-selection policy |

Rates and availability are a **2026-11-18 snapshot**, not a future price promise.
The listed models had free output in the public catalog. Live cost uses the response's
actual `usage.cost`, including a legitimate zero, rather than multiplying tokens
by a guessed price. Jev's existing accounting remains unchanged.

```bash
export OPENROUTER_API_KEY='<your-api-key>'
npx jev-lint run typescript/fn-name-promises src \
  --model openrouter:perplexity/pplx-decider-v1.3:free --cache none
```

When the CLI detects `OPENROUTER_API_KEY`, it asks before using Jev 1.14 through OpenRouter, even with a TypeSafe key present. To select the route in CI, set `model: openrouter:typesafe/jev-1.14` in the config or pass that model with `--model`. The free trial uses the Decider for both starter selection and lint. Other OpenRouter models use Jev for selection and the requested model for checking. The OpenRouter
key covers both phases. Standalone introspection supports Jev on either provider.

The fixed native endpoint is `https://openrouter.ai/api/alpha/decisions`.
`--base-url` cannot redirect native credentials. Unknown native model IDs are
errors; there is no fallback to another provider or chat-completion endpoint.

Perplexity free requests are spaced 3.2 seconds apart per client. OpenRouter
documents 20 free requests/minute and daily limits of 50, or 1,000 after at least
$10 in lifetime purchased credits. Daily exhaustion stays a failed request, not
a clean result. Queuing does not consume each request's network timeout;
overall cancellation and time budgets still apply.

## Measurements

All accuracy rows use existing labelled fixtures, unchanged rule text, state,
grouping and **shipped cutoffs**. Each model ran three fresh passes without a
verdict cache, with concurrency four and a fresh Jev control in each stage.
The unit is a subject classified by its mean answer, not three independent
examples. Fixtures include bad cases, hard cleans and unrelated controls.

The stages were a sequential screen, not a balanced tournament. The comparison
does not establish production accuracy, a new calibrated cutoff, or unbiased
holdout performance. A refitted result in raw records is diagnostic only; no
accepted baseline was replaced.

### Function naming: 35 TypeScript subjects

| Model | TP / FP / FN / TN | Requests | Billed USD | Wall seconds |
| --- | --- | ---: | ---: | ---: |
| Jev 1.14.0 | 11 / 0 / 0 / 24 | 12 | 0.002786868 | 0.705 |
| D1.2 Ultra | 11 / 0 / 0 / 24 | 12 | 0.002603664 | 5.019 |
| D1.2 | 8 / 0 / 3 / 24 | 12 | 0.001239840 | 1.825 |
| Mammoth 1 | 11 / 0 / 0 / 24 | 27 | 0.008537400 | 4.547 |
| Perplexity free | 11 / 0 / 0 / 24 | 12 | 0 | 35.750 |

Time is the runner's API-phase wall time, including transport, scheduling and
free-model pacing. It excludes AST extraction and does not measure complete
command startup or isolated model inference. Native request traces separately
retain HTTP latency. The larger Mammoth request count comes from the
conservative context guard splitting batches and repeating state.

### Broader checks

| Suite / subjects | Jev TP / FP / FN / TN | D1.2 Ultra TP / FP / FN / TN | Mammoth TP / FP / FN / TN |
| --- | --- | --- | --- |
| Shared comments / 157 | 68 / 0 / 3 / 86 | 64 / 0 / 6 / 86 on **156 paired**, one subject missing | 66 / 0 / 5 / 86 |
| Rust function naming / 39 | 9 / 0 / 1 / 29 | 10 / 0 / 0 / 29 | 10 / 1 / 0 / 28 |
| Rule-case review / 11 | 4 / 0 / 1 / 6 | 5 / 0 / 0 / 6 | 5 / 0 / 0 / 6 |
| TypeScript test claims / 111 | 42 / 0 / 1 / 68 | 42 / 1 / 1 / 67 | 42 / 0 / 1 / 68 |

The Ultra comment row is incomplete after a 504. On those same 156 paired
subjects, Jev was 67 / 0 / 3 / 86; Ultra introduced three regressions and no
improvements. Do not treat the missing subject as clean or compare its total
against all 157 Jev answers. Mammoth's comments had three regressions and one
improvement; aggregate counts alone hide that distinction.

| Suite | Jev USD / seconds | D1.2 Ultra USD / seconds | Mammoth USD / seconds |
| --- | --- | --- | --- |
| Shared comments | 0.024832584 / 17.622 | 0.020568954 / 117.333 | 0.049854900 / 47.224 |
| Rust function naming | 0.003051846 / 0.691 | 0.002885400 / 2.001 | 0.009540300 / 5.228 |
| Rule-case review | 0.001765890 / 1.678 | 0.001473822 / 4.524 | 0.003570600 / 4.057 |
| TypeScript test claims | 0.012235482 / 1.505 | 0.012134052 / 6.952 | 0.048883500 / 22.242 |

Successful responses establish the native billed cost. The failed Ultra request
may have an unreported charge, so its cost is a known lower bound. Exact values
and per-request traces live in the experiment records.

### Free-model follow-up: 111 TypeScript test claims

A new control was necessary: Jev itself varied between stages. In this follow-up,
both Jev and Perplexity were **41 / 0 / 2 / 68**, but Perplexity lost one Jev
detection and gained another. It had zero pass-to-pass classification flips;
Jev had three. Equal aggregate accuracy does not mean equal answers.

| Model | Requests | Input tokens | Billed USD | Wall seconds |
| --- | ---: | ---: | ---: | ---: |
| Fresh Jev 1.14.0 | 30 | 291,321 | 0.012235482 | 1.682 |
| Perplexity free | 30 | 258,939 | 0 | 93.327 |

Combined with the first screen, both were TP 52, FP 0, FN 2, TN 92 on **146
subjects in only these two naming families**: fixture precision 100%, recall
96.3%, F1 98.1%. Perplexity's total billed cost was $0 versus $0.015022350 for
the matching Jev controls, with much slower throughput under free-tier pacing.
This warrants optional trials on those families, not general adoption.

### Starter-selection check

In the one-shot TypeScript project, Perplexity enabled **10 rules**, including
rules the starter policy says to defer. The expected conservative starter had
two. Keeping Jev as selector produced exactly
`typescript/fn-name-promises` and `typescript/test-name-verifies-claim`.
Perplexity then checked four subjects and found the intended defect. The
guarded run cost $0.000941304 for selection and $0 for checking.

This is one functional trial, not a starter-selection accuracy benchmark. It
is enough evidence to keep native models out of automatic selection for now.
Both the failed selection trial and guarded run are preserved.

## Runtime safeguards and remaining limits

- Native replies must contain structured answers, reported model identity and
  valid measured token/cost fields. Invalid or missing verdicts remain missing.
- Before sending, serialized UTF-8 bytes must fit within the provider context
  limit minus 1,024; question count is capped at 128 for Liquid and 64 for the
  other two providers. Oversized question sets are recursively split. An
  oversized single state fails rather than being sent for possible truncation.
  The byte guard deliberately underuses context and is not a provider-tokenizer
  estimate or proof that the provider never truncates internally.
- Native verdict-cache **filenames** are scoped by endpoint and requested model,
  so they do not reuse Jev or another native model's verdicts. Legacy Jev cache
  behavior is unchanged: alternate Jev endpoints/models still need separate
  `--cache` paths. Use `--cache none` for a fresh comparison.
- Dry-run cost uses the existing Jev token estimator and listed input rate
  **before native splitting**. Repeated state can increase actual input. Live
  budget settlement uses measured `usage.cost`; a budget estimate is not a hard
  guarantee against a provider's unexpectedly large final charge.
- Records preserve requested and reported model names. A returned name is not
  cryptographic evidence of an immutable model version. These APIs remain
  experimental and can change.

## Research sources and evidence

[OpenRouter decisions](https://openrouter.ai/docs/guides/features/decisions)
documents the native request/answer contract;
[multimodal decisions](https://openrouter.ai/docs/guides/community/multimodal-decisions)
describes the common interface. The
[Liquid model docs](https://docs.liquid.ai/lfm/models/decision-models),
[Perplexity quickstart](https://docs.perplexity.ai/docs/decisions/quickstart.md),
and [Cloudflare Clef-flash docs](https://developers.cloudflare.com/workers-ai/models/clef-flash/)
were checked as primary sources. GLiDE and SubQ were researched but not trialled:
they were absent from the captured native catalog and no separate credentials
were available. DeepSeek remained excluded. The older
[Clef comparison](clef-evaluation.md) is historical, not a current ranking.

[Public DecisionIndex scores](https://huggingface.co/spaces/multimodalart/jev-decision-index/resolve/de702e1991869d7970f95798b6368a0db4606c1e/data/index.json)
helped shortlist models, but are not accuracy
percentages on these lint rules. Index versions and private-task changes must
not be mixed. The measured results are in the [trial summary](../experiments/models/2026-11-decision-models/summary.json).
