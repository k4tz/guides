# RabbitMQ — Hands-On: Order Processing System

A small, working project that ties `basic.md` and `advanced.md` together. You'll build an order-processing pipeline where one event ("order placed") fans out to three independent services — and one of those services deliberately fails sometimes, so you can watch retry-with-backoff and dead-lettering happen in real time.

This exercise deliberately picks a scenario — "one event, multiple independent services react" — that shows up constantly in real systems (order placed → email + inventory + analytics + shipping + fraud-check, all fanning out from one event), so the patterns here transfer directly to whatever domain you actually work in.

## What you're building

```
                    ┌──────────────────┐
producer.py ──────► │ orders_exchange  │  (fanout)
 (sends orders)     └──────────────────┘
                       │       │       │
                       ▼       ▼       ▼
              inventory_queue  email_queue  analytics_queue
                       │            │              │
                       ▼            ▼              ▼
           inventory_service.py  email_service.py  analytics_service.py
              (always succeeds)  (always succeeds)  (~50% failure rate,
                                                       demonstrates retry
                                                       + DLQ)
```

Every consumer is independent — you can start them in any order, kill and restart any of them, and the others are unaffected. That independence is the entire point of the fanout pattern.

## Prerequisites

- Docker (or a local RabbitMQ install — see `basic.md`)
- Python 3.8+

## Step 1 — Start RabbitMQ

```bash
cd hands-on-project
docker compose up -d
```

Confirm it's healthy:
```bash
docker compose ps
```

Open the management UI at `http://localhost:15672` (login: `guest` / `guest`). Keep this tab open — you'll watch queues fill and drain here as you go.

## Step 2 — Install dependencies

```bash
pip install -r requirements.txt
```

## Step 3 — Look at the topology before running anything

Open `topology.py`. This is the one file every other script imports — it declares the entire exchange/queue/binding graph up front, so there's a single source of truth for "what does this system's plumbing look like." Read the comment at the top; it maps directly onto the diagram above.

Notice `analytics_queue` has extra arguments (`x-dead-letter-exchange`) that `inventory_queue` and `email_queue` don't — that's the DLQ wiring described in `advanced.md`, attached to only the one queue that needs it.

## Step 4 — Send your first order

```bash
python producer.py
```

You should see:
```
[producer] published order a1b2c3d4: {'order_id': 'a1b2c3d4', 'item': 'widget', 'amount': 123.45}
```

Check the management UI → Queues. You should see **1 message** sitting in all three queues (`inventory_queue`, `email_queue`, `analytics_queue`) — one published event, three independent copies. This is fanout, made concrete.

## Step 5 — Run the two simple consumers

Open two new terminals:

```bash
python inventory_service.py
```
```bash
python email_service.py
```

Both immediately pick up and process the waiting message. Send a few more orders from a third terminal (`python producer.py`) and watch both consumers react to each one, independently, in real time.

Notice: killing `email_service.py` (Ctrl+C) and sending more orders doesn't affect `inventory_service.py` at all — messages just queue up in `email_queue` waiting for it to come back. Restart it and it picks up right where it left off. This is durability + decoupling working together.

## Step 6 — Run the interesting one: analytics with retry + DLQ

Stop the previous consumers if you want a clean terminal, then:

```bash
python analytics_service.py
```

In another terminal, send a batch of orders:
```bash
python producer.py --loop 10
```

Watch the analytics terminal. You'll see a mix of:
```
[analytics] processed order 4c266212 (attempt 1)
[analytics] FAILED order 163ac784 (attempt 1/3) — will retry in ~10s
[analytics] FAILED order 571bf376 (attempt 1/3) — will retry in ~10s
[analytics] processed order 163ac784 (attempt 2)
```

Each "FAILED" message simulates a downstream failure (a flaky analytics DB, say). Instead of crashing or silently dropping the message, it:
1. Publishes the message to a **retry queue** with an incremented retry counter in the header
2. Acks the original so it's removed from the main queue
3. The retry queue holds it for ~10 seconds (via `x-message-ttl`), then automatically dead-letters it **back into `analytics_queue`** for another attempt

You're watching the retry-with-backoff pattern from `advanced.md` happen live, using nothing but queue TTL configuration — no external scheduler, no cron job, no polling.

Let it run for a minute or two. Given the ~50% failure rate, some orders will occasionally fail three times in a row and exhaust `MAX_RETRIES` — when that happens you'll see:

```
[analytics] order 7c60a9f0 exhausted 3 retries — sending to DLQ for manual review
```

## Step 7 — Inspect the dead-letter queue

In a real system, an alert would fire the moment something lands in a DLQ. Here, check it manually:

```bash
python inspect_dlq.py
```

```
1 message(s) currently in analytics_dlq:

  - order 7c60a9f0 — failed after 3 attempts — {'order_id': '7c60a9f0', 'item': 'gizmo', 'amount': 88.12}
```

This script peeks without permanently draining the queue, so you can re-run it as many times as you like — this mirrors how you'd actually want an inspection/admin tool to behave (you don't want "checking what failed" to also be "deleting what failed").

## Step 8 — Break something on purpose

A few things worth trying, each teaching a specific lesson:

- **Kill `analytics_service.py` mid-processing** (Ctrl+C while messages are in flight), then restart it. Because acks are manual, any message it hadn't acked yet gets redelivered — you won't lose it, but you might process it twice. This is exactly the "design for idempotency" point from `advanced.md` made concrete: nothing here checks whether an order was already recorded.
- **Open the management UI while `analytics_service.py` is running** and watch `analytics_retry_queue` — you'll see its message count blip up and back down to 0 roughly every 10 seconds as the TTL cycle runs. That's the delay queue doing its job, visible in real time.
- **Change `MAX_RETRIES` in `topology.py`** to 1, restart everything, and watch far more orders land in the DLQ. This is the retry/DLQ trade-off in miniature — fewer retries means faster failure detection but less tolerance for transient blips.

## Step 9 — Clean up

```bash
docker compose down -v
```

## What you actually just practiced

- Fanout exchanges decoupling a producer from an arbitrary number of independent consumers
- Manual acknowledgment and what it buys you when a consumer crashes
- A full retry-with-backoff implementation using only TTL + dead-lettering (no external retry library)
- A dead-letter queue as the final, human-reviewed resting place for messages that can't succeed
- Watching queue depth and message flow live in the management UI, which is most of your day-to-day debugging workflow in a real job

Everything here is small enough to read end to end in `hands-on-project/`, but every pattern — fanout for independent-consumer fan-out, manual ack for reliability, retry+DLQ for handling flaky downstreams — is exactly what shows up in production systems, just usually spread across more services and more code.
