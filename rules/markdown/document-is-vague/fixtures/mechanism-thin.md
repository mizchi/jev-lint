# Why We Stopped Retrying Failed Webhooks Immediately

Most webhook systems retry a failed delivery right away, on the theory that failures are usually transient. We used to do this too, and it caused more problems than it solved.

The issue is what an immediate retry does when the failure isn't transient but structural — the receiving endpoint is down, or rate-limiting every request from us. An instant retry hits the same broken endpoint again, gets the same failure, and retries again immediately, all while the endpoint is still in exactly the state that caused the first failure. If the receiving server is down because it's overloaded, a fleet of clients all retrying it immediately is the opposite of helpful: it's more load, delivered at the worst possible moment, from every sender that just failed against it.

We switched to exponential backoff with jitter instead: a failed delivery waits before its first retry, waits longer before its second, and the exact wait time is randomized within a window rather than fixed, so that a batch of webhooks that all failed at the same moment don't all retry at the same moment either. The jitter matters specifically because without it, every client backs off in lockstep and then hits the endpoint again in the same synchronized burst, which reproduces the original overload problem one retry cycle later.

We also gave up retrying forever. A webhook that keeps failing past a certain number of attempts gets moved to a dead-letter queue instead of retried indefinitely, because a receiving endpoint that's been broken for a long time is a receiving endpoint that needs a human to look at it, not one more automated attempt.
