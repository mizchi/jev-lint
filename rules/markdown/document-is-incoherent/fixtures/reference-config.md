# `queue.toml` reference

Every setting the worker reads, with its type, default, and the consequence of changing it. Settings are grouped by the table they live in. A setting marked *restart* is read once at startup; everything else is reloaded on `SIGHUP`.

## `[broker]`

**`url`** (string, required, *restart*)
Connection string. `amqp://` and `amqps://` are accepted. The worker resolves the host once at startup; if DNS changes, restart. A URL with a vhost that does not exist fails at startup with `ACCESS_REFUSED`, not later.

**`heartbeat`** (duration, default `30s`)
Interval at which the worker sends a heartbeat frame. The broker closes the connection after missing two. Setting this below `5s` is refused at load time. Values above `120s` make a dead broker take that long to notice; the default is a compromise between chatter and detection time.

**`prefetch`** (integer, default `16`, *restart*)
How many unacknowledged messages the worker will hold at once. This is the real concurrency limit: `[worker].concurrency` cannot exceed it. Set it to `1` to process strictly one message at a time, at the cost of a round trip per message.

**`reconnect_backoff`** (duration list, default `["1s", "2s", "5s", "10s", "30s"]`)
Delays between reconnection attempts after a dropped connection. The last value repeats forever. An empty list means "do not reconnect": the worker exits with status 4 on the first drop.

## `[worker]`

**`concurrency`** (integer, default `8`)
Number of messages processed in parallel. Capped at `[broker].prefetch`; a value above it is clamped and logged at startup. Raising this above the number of CPU cores helps only if handlers spend most of their time waiting on I/O.

**`handler_timeout`** (duration, default `60s`)
A handler that runs longer than this is cancelled and the message is nacked with `requeue = false`, so it goes to the dead-letter queue if one is configured and is dropped otherwise. This timeout does not cover the time a message waits in the prefetch buffer.

**`shutdown_grace`** (duration, default `30s`)
On `SIGTERM`, the worker stops taking new messages and waits up to this long for in-flight handlers. Anything still running at the deadline is cancelled and nacked with `requeue = true`. Set this above your longest expected handler if losing a message is worse than a slow shutdown.

**`max_retries`** (integer, default `3`)
A handler that raises a retryable error has its message requeued up to this many times. The count is carried in the `x-attempt` header, so it survives a worker restart but not a manual republish. `0` disables retries.

**`retry_backoff`** (duration, default `2s`)
Base delay before a retry; doubled per attempt. With the default three retries the delays are 2, 4 and 8 seconds. Delay is implemented by publishing to a per-delay wait queue with a TTL, so the queues `wait.2000`, `wait.4000` and `wait.8000` appear on the broker the first time each delay is used. They are not deleted automatically.

## `[queues]`

A table per queue. The table name is the queue name.

**`handler`** (string, required)
Dotted path to the callable, `module.submodule:function`. Import failures are reported at startup for every queue before the worker connects, so a typo fails fast.

**`dead_letter`** (string, optional)
Name of the queue that receives messages nacked without requeue. If the named queue does not exist it is declared at startup as durable. If omitted, such messages are dropped and a counter `queue_dropped_total{queue=...}` is incremented.

**`durable`** (bool, default `true`)
Whether the queue survives a broker restart. Changing this on an existing queue fails at startup with `PRECONDITION_FAILED`; delete the queue first.

**`consumers`** (integer, default `1`)
Number of consumer registrations on this queue from this worker. More than one is only useful to raise this queue's share of `[worker].concurrency` relative to other queues; total parallelism is still bounded by `concurrency`.

## `[metrics]`

**`listen`** (string, default `"127.0.0.1:9464"`)
Address for the Prometheus endpoint. `""` disables it. Binding `0.0.0.0` is allowed and not the default because the endpoint is unauthenticated.

**`path`** (string, default `"/metrics"`)

**`histogram_buckets`** (float list, default `[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]`)
Bucket boundaries in seconds for `handler_duration_seconds`. Changing this changes the series' label set, so dashboards that hardcode `le` values break.

## `[logging]`

**`level`** (string, default `"info"`)
One of `debug`, `info`, `warn`, `error`. At `debug` every message body is logged up to `body_limit` bytes; do not run `debug` in production if bodies carry personal data.

**`format`** (string, default `"json"`)
`json` or `text`. `text` is meant for a terminal and includes ANSI colour when stdout is a TTY.

**`body_limit`** (integer, default `1024`)
Bytes of message body included in a log line at `debug`. `0` logs no body.

## Environment overrides

Any setting can be overridden by an environment variable named `QUEUE_<TABLE>_<KEY>` in upper case, with the queue name for the `[queues]` table: `QUEUE_BROKER_URL`, `QUEUE_WORKER_CONCURRENCY`, `QUEUE_QUEUES_ORDERS_HANDLER`. Lists are comma-separated. An environment override of a *restart* setting still needs a restart.

## Precedence

Command-line flag, then environment, then `queue.toml`, then the default. `queue-worker config --resolved` prints the merged result with the source of each value, and is the first thing to run when a setting seems to be ignored.

## Validation errors

The worker validates the whole file before connecting and prints every error, not just the first. Errors name the table and key (`[worker].concurrency: expected integer, got "eight"`). Unknown keys are errors, so a misspelt key cannot silently take its default.
