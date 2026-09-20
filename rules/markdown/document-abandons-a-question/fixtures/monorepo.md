# What a monorepo actually buys you

Every argument for a monorepo I have heard reduces to one sentence: a change that touches two packages is one change. Every argument against reduces to another: a change that touches two packages is one change, and now everyone has to wait for it.

## One lockfile

Two packages, two lockfiles. Package A pins `left-pad` at 1.3.0. Package B pins it at 1.3.1. Both build. Both pass. Ship A and B together and the runtime has two copies, and the one that loads first wins. Nobody chose 1.3.0. It won.

One lockfile removes the choice. There is one version of `left-pad`, and a bump is a diff that every package sees. The bump might break B. That is the point: B was already broken; it was running a version its tests had never seen.

The cost is the bump itself. A version that A needs and B cannot take is a conflict that a single lockfile refuses to hide. It has to be resolved, in the open, before anything merges.

## The build graph

There is no better place to see what a monorepo buys you than the build graph. Every package declares what it depends on, and the graph is the union. A change to a leaf rebuilds the leaf. A change to a root rebuilds everything.

The number that matters is how often a change hits a root. I may be wrong about this, but in every repository I have measured, the answer was "more often than the layout suggests": a shared `utils` package, imported everywhere, edited weekly. The graph does not make that cheaper. It makes it visible, and the visible cost is what finally gets `utils` split.

Splitting `utils` is the work. The monorepo did not do it. It made it obvious enough that someone did.

## What it costs

This section covers CI time, disk usage, and onboarding.

CI time grows with the graph, not with the change. A one-line fix in a root package runs every test in the repository, and the only ways out are a cache that is trusted and a graph that is honest. Neither comes free. The cache is the previous section's problem; an honest graph means every package declares every import, and a package that reaches into a sibling's source without declaring it breaks the cache silently.

Disk usage is the least interesting cost and the one people mention first. A clone that takes a minute instead of ten seconds is a number, and numbers get quoted.

We will come back to onboarding.
