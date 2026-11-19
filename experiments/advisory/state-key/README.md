# Visited keys and future behavior

The collector joins a checked membership guard to providers through the TypeScript interface, and includes the key projections, the provider's input and callback types, source ranges, the consumer and applicable instructions mentioning the qualified member. This case was used during development. It measures regression behavior on a known defect.

On mizchi/idealis at `d147550c80d814e23f5d76f8ded25e30bf190da4`, the shipped manifest generated two inputs without hand-picked excerpts. The complete string key in `createFiniteModel` stayed below cutoff. The composite provider's key includes both child state keys but leaves out the observations carried alongside them. Product callbacks may inspect those observations. All three live decisions for the composite provider exceeded 0.84. The synthetic suite's three-pass calibration and separate acceptance runs are in `fit.json` and the rule's baseline. The hint evaluation pairs the rendered follow-up with a generic instruction over identical evidence.

Run `npm run eval:advisories` for offline checks. To repeat the behavior test with Node 24 and a checkout containing the pinned revision:

```sh
work=$(mktemp -d)
git -C /path/to/idealis archive d147550c80d814e23f5d76f8ded25e30bf190da4 src/checker.ts src/compose.ts | tar -x -C "$work"
node experiments/advisory/state-key/composition-check.mjs "$work"
```

The two seed orders return `complete` and `violation` respectively. The control key that also includes the varying observation returns `violation`. The witness and source excerpts are covered by the accompanying MIT license.
