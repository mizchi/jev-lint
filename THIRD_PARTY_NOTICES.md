# Third-party notices

The accepted-finding multiset, conservative baseline maintenance, file-scope
explanation, suppression-directive diagnostics and regression scenario design
were informed by [scanaislop/aislop](https://github.com/scanaislop/aislop), revision
`2f785c8f7e4be4492731bd5b0b577df489819a5d`.

Relevant upstream modules are `src/baseline/match.ts`,
`src/utils/scope-explanation.ts`, `src/output/sarif.ts`, and
`src/engines/ai-slop/suppression-directives.ts`; the incomplete-baseline tests
also informed the failure scenarios. The implementation here uses jev-lint's
existing contracts and dependencies. No upstream runtime package is required.

The upstream MIT notice is preserved in [licenses/aislop-MIT.txt](licenses/aislop-MIT.txt).
