# Post-mortem: the 41-minute checkout outage on March 14

This is the write-up of the checkout outage from Thursday. I was the on-call engineer, so what follows is mostly what I saw and did, with the timeline reconstructed from the alert log and the deploy history afterwards.

## Impact

From 14:07 to 14:48 UTC, every request to `POST /checkout` returned a 502. That is 41 minutes. The order table shows 0 rows inserted in that window against a typical Thursday afternoon rate of about 340 orders per 10 minutes, so roughly 1,400 orders were lost or delayed. Support logged 63 tickets, 58 of them the same "payment page shows an error" complaint. Browsing, cart and login were unaffected.

## Timeline

- **13:52** Deploy 4d1e9f goes out. It bumps the `payments-client` library from 2.8.1 to 2.9.0 and nothing else. CI green, canary green for 10 minutes on 5% of traffic.
- **14:02** Canary promoted to 100%.
- **14:07** First alert: `checkout_5xx_ratio > 0.05` for 2 minutes. I acknowledge at 14:09.
- **14:09–14:18** I look at the checkout service logs. Every request dies with `TypeError: Cannot read properties of undefined (reading 'currency')` in `payments-client/lib/normalize.js:88`. I assume a bad payload from the payment provider and start reading their status page. It is green. This is the nine minutes I would most like to have back.
- **14:18** A colleague on the thread points out that the canary ran at 5% and the error is on 100% of requests, and asks what the deploy changed. I open the diff. It is the library bump.
- **14:21** I start a rollback to 3b77c0. Rollback takes 7 minutes because the checkout service has a 90-second graceful shutdown per pod and there are 12 pods rolling 2 at a time.
- **14:28** Rollback complete. Error ratio still 100%.
- **14:28–14:40** This was the part that made no sense. The old code was running. I confirmed the image digest on three pods by hand. Then I looked at the request bodies instead of the stack trace: every request carried `"currency": null`. The front end had been sending `null` for currency since 13:52, because 2.9.0 of the same client library also ships in the web bundle, and the web bundle was deployed by the same commit. Rolling back the service did not roll back the bundle.
- **14:40** Rolled back the web deploy. CDN cache has a 5-minute TTL on the bundle.
- **14:48** Error ratio drops to 0. Alert resolves at 14:50.

## Why the canary passed

The canary served 5% of traffic for 10 minutes, but the web bundle was already at 100% at that point, so both the canary and the 95% were receiving `currency: null`. The old service code (2.8.1) tolerated a null currency by falling back to the account default. The new service code (2.9.0) does not. In other words the canary was comparing new-server-plus-new-client against old-server-plus-new-client, and only the first combination breaks. The canary could never have caught this, because the thing it varied was not the thing that mattered.

## What was wrong, precisely

Two things, and they are separate.

1. `payments-client` 2.9.0 changed `normalize()` to throw on a missing currency instead of defaulting. The changelog entry says "stricter validation of currency", which is true and did not sound like a breaking change. It is one.
2. Our deploy pipeline deploys the web bundle and the checkout service from the same commit but as two independent steps, and `rollback` only knows about the service. Nobody had rolled back a commit that touched both before.

## What we changed

- The web bundle now pins `payments-client` separately (`2.8.1`, with a comment pointing at this document), so a server-side bump cannot change what the client sends. This went out on March 15.
- `rollback` now refuses to run if the target commit touched `web/` and prints the command for the web rollback. A proper combined rollback is a bigger change; the refusal is the cheap version and it would have saved 12 minutes here.
- The `checkout_5xx_ratio` alert threshold moves from 5% over 2 minutes to 5% over 1 minute. It would have fired at 14:05 instead of 14:07. Small, but free.
- I added a canary check that compares the canary's error ratio against the baseline's, not against a fixed threshold. It would not have helped here (both were at 100%), and I am listing it because it was on the list already and this was the moment to do it.

## What I would do differently

Read the deploy diff before the provider status page. The deploy was 15 minutes old when the alert fired; that should have been the first thing I looked at, and it was the fourth. The rule I am taking from this is simple: if something deployed in the last hour, it is the suspect until the diff clears it.

At the end of the day, the library did what its changelog said, and the pipeline did what it was built to do. The failure was in the gap between two things that were each fine on their own, which is where most of ours seem to live.
