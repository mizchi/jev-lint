# We Cut Our CI Time in Half: Here's What We Learned

Continuous integration is one of those things every engineering team ends up caring about eventually. As a codebase and test suite grow, the feedback loop between opening a pull request and knowing whether it's safe to merge starts to matter more and more, and a slow CI pipeline has a way of quietly eating into how much a team can ship in a day.

There's no single right way to speed up a CI pipeline, and what works for one team's setup won't necessarily work for another's. Still, we figured it was worth writing up what we changed and what it actually got us, in case any of it is useful to teams facing a similar wall.

## Where we started

Our main pipeline ran as a single sequential job: `npm ci`, then unit tests, then the Playwright suite, then a production build. Wall-clock time was 34 minutes on a clean run, and closer to 40 when the shared runner was under load from other jobs.

## What we changed

1. **Sharded the Playwright suite across 8 runners.** The suite had 412 specs living in one `npx playwright test` invocation. We split it by spec file into 8 roughly equal shards using `--shard=$N/8`, run as separate jobs. The slowest shard finished in 6m40s; the whole suite used to take 21 minutes end to end.
2. **Keyed the dependency cache on the lockfile hash instead of the branch name.** Previously every new branch got a cold `npm ci`, about 90 seconds. Keying the cache on `hashFiles('package-lock.json')` meant only lockfile changes triggered a fresh install; branch switches with no dependency changes now restore from cache in about 8 seconds.
3. **Moved the production build off the critical path.** The build doesn't gate merges, only deploys, so it now runs in parallel with the test jobs instead of after them, saving its own 5-minute wall time from every PR's critical path.

## Results

| Stage | Before | After |
| --- | --- | --- |
| Install | 90s | 8s (cache hit) |
| Unit tests | 3m | 3m (unchanged) |
| Playwright | 21m | 6m40s (slowest shard) |
| Build | 5m (sequential) | 0 (parallel, off critical path) |
| **Total wall time** | **34m** | **16m** |

We measured this over 40 PRs merged in the two weeks after the change, compared against the 40 PRs merged in the two weeks before.

## What we'd do first if starting over

If you're on a single sequential job over 30 minutes, sharding the slowest suite is where most of the win is. The cache key change only started mattering once the pipeline was already parallel; before that, install time was a rounding error next to a 21-minute test run.
