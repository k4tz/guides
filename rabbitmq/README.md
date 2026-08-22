# RabbitMQ

A message broker used to decouple services in a microservices architecture — producers publish messages without knowing who (if anyone) consumes them, and consumers process work at their own pace.

| File | Contents |
|---|---|
| [`basic.md`](./basic.md) | Install, the core mental model (producer → exchange → queue → consumer), exchange types, and the task-queue/fanout/topic patterns you'll use 90% of the time. |
| [`advanced.md`](./advanced.md) | Durability guarantees, dead-letter queues, retry-with-backoff, clustering/HA, monitoring, and the production checklist. |
| [`hands-on.md`](./hands-on.md) | A working order-processing system (`hands-on-project/`) — one event fanned out to three services, with retry + DLQ built in — that you run locally and deliberately break to see the patterns in action. |

## How to use this

- New to RabbitMQ? Start with `basic.md`.
- Comfortable with the basics, want to do it right in production? Read `advanced.md`.
- Want to actually build something instead of just reading? Follow `hands-on.md` — the project folder is ready to run.
