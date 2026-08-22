# RabbitMQ — Advanced

Everything in `basic.md` gets you a working system. This is what separates "it runs on my machine" from "it survives production" — durability guarantees, failure handling, scaling, and the operational norms experienced teams follow by default.

## Durability, revisited (and where people get burned)

There are **three separate** durability switches, and missing any one of them silently breaks the guarantee you think you have:

1. **Queue durability** — `durable=True` on `queue_declare`. Survives broker restart, but only means the *queue itself* is redeclared — not that messages inside it survive.
2. **Message persistence** — `delivery_mode=2` in `BasicProperties`. Tells RabbitMQ to write the message to disk, not just keep it in memory.
3. **Publisher confirms** — without these, you don't actually know the broker received and persisted the message before your producer moves on.

You need **all three** for real durability. A durable queue with non-persistent messages loses everything on restart. Persistent messages without publisher confirms mean you might think a message was saved when it never left your producer's TCP buffer.

```python
channel.confirm_delivery()  # enable publisher confirms on this channel

if channel.basic_publish(
    exchange='orders',
    routing_key='order.placed',
    body=payload,
    properties=pika.BasicProperties(delivery_mode=2),
    mandatory=True
):
    print("confirmed")
else:
    print("nacked — broker couldn't handle it, retry or alert")
```

Note the real-world caveat: full durability costs throughput (every message hits disk before being confirmed). For high-volume, less-critical data (metrics, logs), many teams deliberately skip persistence and accept the small loss-on-restart risk in exchange for speed. This is a decision to make explicitly, not by default.

## Acknowledgment semantics you need to actually understand

- **`ack`** — "I'm done, discard it." 
- **`nack` / `reject` with `requeue=True`** — "I failed, but try again" (puts it back at the front or back of the queue depending on broker version/config).
- **`nack` / `reject` with `requeue=False`** — "I failed, and don't retry" — this is what routes to a dead-letter queue if one is configured (see below). Without a DLQ configured, `requeue=False` just **deletes the message**.

The failure mode nobody notices until it happens: **poison messages**. A malformed message that always throws an exception gets nacked, requeued, redelivered, thrown again — forever, hammering your consumer in an infinite loop, if you don't have a max-retry/DLQ strategy.

## Dead-letter queues (DLQ) — the pattern you need for any real system

A DLQ is just a normal queue that catches messages which fail, expire, or get rejected from another queue. Configure it via arguments on the *original* queue:

```python
channel.queue_declare(
    queue='orders',
    durable=True,
    arguments={
        'x-dead-letter-exchange': 'dlx',       # where failed messages go
        'x-dead-letter-routing-key': 'orders.failed',
        'x-message-ttl': 60000,                 # optional: messages older than 60s also die here
    }
)

channel.exchange_declare(exchange='dlx', exchange_type='direct', durable=True)
channel.queue_declare(queue='orders_dlq', durable=True)
channel.queue_bind(exchange='dlx', queue='orders_dlq', routing_key='orders.failed')
```

A message lands in the DLQ when: it's nacked/rejected with `requeue=False`, it expires (TTL), or the queue hits a max-length limit and evicts it.

### Retry with backoff (the pattern, since RabbitMQ has no native "retry in N seconds")

RabbitMQ doesn't have built-in delayed retry. The standard pattern is a **delay queue** with TTL that dead-letters back into the working queue after the delay expires:

```
orders (main queue)
   ↓ (message fails, nack requeue=False)
orders_retry (TTL=30s, DLX points back to `orders` exchange)
   ↓ (after 30s, TTL expires, message dead-letters)
orders (back in the main queue, retried)
```

Track retry count in a message header (`x-retry-count`) and increment it manually in your consumer; once it hits your max (e.g. 3), route to a **final DLQ** instead of back to the retry queue, and alert on it. Without this cap, a permanently-broken message retries forever.

## Consumer reliability patterns

- **Idempotent consumers, always.** At-least-once delivery is RabbitMQ's default guarantee — a message *will* occasionally be delivered twice (network blip between processing and ack, consumer crash after processing but before ack). Design consumers so processing the same message twice is safe (check-then-act on an order ID, upsert instead of insert, etc.). This isn't optional hardening — it's the baseline assumption for any queue-based system.
- **Set `prefetch_count`** deliberately, not just to 1. For fast, lightweight tasks, a higher prefetch (10-50) reduces network round-trip overhead. For slow/heavy tasks, keep it low (1-5) so work distributes evenly and one consumer doesn't hoard a backlog.
- **Handle connection drops.** `pika`'s `BlockingConnection` will just raise on disconnect — production consumers need reconnect logic (a loop with backoff, or use `pika`'s async adapters with proper connection-recovery handling).

## Clustering and high availability (what changes in production)

A single RabbitMQ node is a single point of failure. Production setups typically run a **cluster** of 3+ nodes:

- **Quorum queues** (the modern default, replacing classic mirrored queues) replicate queue data across multiple nodes using the Raft consensus protocol — if one node dies, another has the data and an election picks a new leader.
- Declare a quorum queue with `arguments={'x-queue-type': 'quorum'}`.
- Classic queues without replication live on exactly one node — if that node dies, the queue (and its messages) are unavailable until it's back, or gone if the disk is gone.

For anything you actually care about not losing, use quorum queues in a clustered deployment. This is genuinely an ops-team decision in most orgs at the 2-3 year mark, but you should know it exists and why "just one RabbitMQ container" isn't a production architecture.

## Monitoring — what actually matters

Watch these, in roughly this priority order:
1. **Queue depth / message count** — a queue that's growing means consumers can't keep up. This is your #1 early-warning signal.
2. **Consumer count per queue** — zero consumers on a queue with incoming messages is a silent outage.
3. **Unacked message count** — a high number stuck here usually means a stuck/crashed consumer that hasn't reconnected.
4. **Connection/channel churn** — rapidly opening and closing connections is expensive and usually indicates a bug (e.g., opening a new connection per message instead of reusing one).

The management UI surfaces all of this; Prometheus + Grafana (via the `rabbitmq_prometheus` plugin) is the standard for actual production dashboards/alerting.

## Connection vs. channel — don't get this backwards

- **Connection** = an actual TCP connection to the broker. Expensive to open/close. Open once per process (or per long-lived worker) and keep it.
- **Channel** = a lightweight virtual connection multiplexed over one real connection. Cheap. Open one per thread/logical unit of work, not one per message.

A very common beginner mistake is opening a new `BlockingConnection` for every single message published — this works but is slow and will fall over under load. Reuse connections; open new channels if you need isolation (e.g., per-thread).

## Security norms for production

- Never run with the default `guest`/`guest` user outside localhost — it's disabled remotely by default, but confirm this, don't assume it.
- Create per-service users with scoped permissions (`rabbitmqctl set_permissions`) rather than one shared admin credential across all your services.
- Use TLS for AMQP connections (`amqps://`) when the broker isn't on a fully trusted private network.
- Use **virtual hosts** (vhosts) to isolate different applications/environments (dev/staging/prod) sharing one cluster, so a bug in one can't leak into another's queues.

## Message design norms

- **Version your message schemas.** Include a `version` field or similar so consumers can handle old and new message shapes during a rolling deploy, instead of breaking the moment the producer ships a new format.
- **Keep messages small and self-contained-ish.** Pass IDs and let consumers fetch full records from the source of truth when the payload would be large — don't turn RabbitMQ into a database.
- **Set a sensible TTL** on queues/messages where staleness makes the message useless anyway (e.g., a "typing indicator" message from 10 minutes ago should just be dropped, not processed).

## Summary — the production checklist

- [ ] Durable queues + persistent messages + publisher confirms, deliberately chosen (not skipped by accident)
- [ ] Manual acks everywhere, with idempotent consumers
- [ ] DLQ configured with a retry-with-backoff pattern and a capped retry count
- [ ] `prefetch_count` tuned for the workload, not left at default
- [ ] Quorum queues in a clustered deployment for anything that must not be lost
- [ ] Monitoring on queue depth, consumer count, and unacked messages, with alerting
- [ ] Connections reused, channels scoped sensibly, no per-message connections
- [ ] Scoped per-service credentials, TLS where appropriate, vhost isolation
- [ ] Message schemas versioned for safe rolling deploys

Next: `hands-on.md` to build all of this — task queue, fan-out, retry/DLQ — as one working project.
