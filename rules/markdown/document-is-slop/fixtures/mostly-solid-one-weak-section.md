# Debugging a Memory Leak in Our Notification Worker

Last week we tracked down a slow memory leak in the background worker that processes push notifications. Here's what the investigation looked like and what fixed it.

## Symptom

The worker's RSS climbed steadily from about 180MB at startup to over 1.4GB after 18 hours, at which point Kubernetes OOM-killed the pod and it restarted. This had apparently been happening for at least two weeks based on the restart count in our metrics, but nobody had connected it to a leak until the on-call engineer noticed the sawtooth pattern in the memory graph.

## Investigation

We took a heap snapshot with `node --inspect` at hour 12 and again at hour 16, then diffed the two with Chrome DevTools' comparison view. The diff showed 340,000 retained instances of a `NotificationBatch` class that should have been short-lived — created per batch of 500 notifications, processed, and discarded.

Grepping for `NotificationBatch` usage turned up the cause: a `Map<string, NotificationBatch>` keyed by batch ID, used to deduplicate retries, that was populated on every batch but only ever cleared on successful send. A batch that failed and was abandoned (about 0.3% of them, based on our dead-letter queue count) stayed in the map forever.

## Fix

We added a 10-minute TTL to entries in the map, checked on a timer, and switched the retry-dedup logic to also check the dead-letter queue directly instead of relying solely on the in-memory map. Memory has been flat at around 210MB for the five days since deploying the fix.

## A note on process

Debugging memory leaks is a valuable skill for any backend engineer to have, and there's a lot of good material out there on heap snapshots, retained size, and the general workflow for tracking these things down. It's worth taking the time to get comfortable with your runtime's profiling tools before you need them in an emergency.
