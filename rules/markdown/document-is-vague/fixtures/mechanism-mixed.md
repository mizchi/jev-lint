# Why We Moved Session Storage to Redis

Scaling an application horizontally eventually forces you to confront where session state lives. If sessions are stored in-process, a user's requests have to keep landing on the same server, which limits your options and adds operational complexity. Making the switch to a shared store is one of those changes that pays off in a lot of ways down the line.

The actual mechanism is straightforward: instead of keeping the session object in the worker process's memory, we serialize it and write it to Redis under a key derived from the session ID, with an expiry set to match the session's intended lifetime. On each request, the load balancer can route to any worker, because that worker reads the session from Redis rather than from its own memory — there's no dependency on which process handled the previous request.

This kind of architecture brings a lot of benefits to the table. It makes your system more resilient, more flexible, and easier to reason about. Teams that make this change often find that a whole class of scaling headaches simply goes away, and it opens the door to better infrastructure choices down the line.

We also get to take advantage of Redis's built-in expiry mechanism, which handles session cleanup for us: rather than running a separate sweep job to find and delete stale sessions, we let the TTL we set on write do that work, and an expired key simply stops existing.

Overall, this was a great change for our architecture and we're happy with how it turned out. It's the kind of infrastructure investment that keeps paying off as the system grows.
