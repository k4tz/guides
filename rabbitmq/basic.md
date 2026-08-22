# RabbitMQ — Basics

Get RabbitMQ installed, understand the mental model, and learn the handful of patterns you'll use 90% of the time.

## What RabbitMQ actually is

RabbitMQ is a **message broker** — a middleman that sits between services so they don't have to talk to each other directly. Instead of Service A calling Service B's API and waiting for a response, Service A drops a message into RabbitMQ and moves on. Service B picks it up whenever it's ready.

This buys you three things:
- **Decoupling** — A doesn't need to know B exists, only that "order-placed" messages go somewhere.
- **Resilience** — if B is down, messages just wait in the queue instead of failing outright.
- **Load leveling** — if 10,000 orders come in at once, B can process them at its own pace instead of getting crushed.

The trade-off: you give up the instant response of a direct API call, and you take on a new piece of infrastructure to run and reason about.

## The mental model

Four concepts cover almost everything:

```
Producer → Exchange → (binding) → Queue → Consumer
```

- **Producer** — your code that sends a message. It never sends directly to a queue.
- **Exchange** — the router. Every message goes to an exchange first; the exchange decides which queue(s) it ends up in.
- **Queue** — the actual buffer where messages sit until a consumer takes them.
- **Consumer** — your code that receives and processes messages, then acknowledges them.

**Why an exchange at all, instead of just producer → queue?** Because it decouples "what happened" from "who cares." A producer publishes "order.placed" without knowing or caring whether 1 consumer or 5 consumers are listening. The exchange + bindings handle the fan-out.

### The 3 exchange types you'll actually use

| Type | Behavior | Use it for |
|---|---|---|
| **direct** | Routes to queues bound with an exact matching key | Task queues, targeted routing ("send this specific message to this specific queue") |
| **topic** | Routes by pattern matching on the key (`order.*`, `*.failed`) | Flexible routing where multiple services care about different slices of the same event stream |
| **fanout** | Ignores the key, broadcasts to every bound queue | Pub/sub — "notify everyone who's listening, no exceptions" |

There's also the **default exchange** (nameless, direct-like, routes by queue name directly) — this is what you're using anytime you skip declaring an exchange and just publish "to a queue." Fine for simple task queues; you'll want a named exchange once more than one queue needs to see the same message.

## Installation

**Docker (recommended for local dev):**

```bash
docker run -d --name rabbitmq \
  -p 5672:5672 \
  -p 15672:15672 \
  rabbitmq:3-management
```

- `5672` — the AMQP port your app connects to.
- `15672` — the management UI, at `http://localhost:15672` (default login: `guest` / `guest`, works only from localhost by default).

**macOS (Homebrew):**
```bash
brew install rabbitmq
brew services start rabbitmq
```

**Ubuntu/Debian:**
```bash
sudo apt-get install rabbitmq-server
sudo systemctl enable --now rabbitmq-server
```

Enable the management plugin if you installed it natively (Docker image above already has it):
```bash
rabbitmq-plugins enable rabbitmq_management
```

## The management UI

Open `http://localhost:15672`. This is where you'll spend a lot of your early debugging time. It shows you, per queue: message count, consumer count, message rates in/out, and lets you manually publish/inspect/purge messages. Get comfortable in here before you get comfortable in code — it makes the abstractions concrete.

## Python client setup

```bash
pip install pika
```

`pika` is the standard Python client for RabbitMQ (speaks the AMQP 0-9-1 protocol). It's synchronous/blocking by default, which is what you want for learning and for most simple services.

## The core pattern: task queue (default exchange)

The simplest possible pattern — no exchange to think about, one producer, one queue, one or more consumers competing for messages.

**Producer:**
```python
import pika

connection = pika.BlockingConnection(pika.ConnectionParameters('localhost'))
channel = connection.channel()

# durable=True: queue survives a broker restart
channel.queue_declare(queue='task_queue', durable=True)

channel.basic_publish(
    exchange='',                # '' = default exchange
    routing_key='task_queue',   # default exchange routes by queue name
    body='process order #1234',
    properties=pika.BasicProperties(
        delivery_mode=2  # makes the MESSAGE persistent (not just the queue)
    )
)

print("sent")
connection.close()
```

**Consumer:**
```python
import pika

connection = pika.BlockingConnection(pika.ConnectionParameters('localhost'))
channel = connection.channel()

channel.queue_declare(queue='task_queue', durable=True)
channel.basic_qos(prefetch_count=1)  # don't hand a consumer a new message until it acks the last one

def callback(ch, method, properties, body):
    print(f"received: {body}")
    # ... do the actual work here ...
    ch.basic_ack(delivery_tag=method.delivery_tag)  # tell RabbitMQ: done, safe to discard

channel.basic_consume(queue='task_queue', on_message_callback=callback)
print("waiting for messages...")
channel.start_consuming()
```

Run 2+ copies of the consumer script and RabbitMQ will round-robin messages between them — this is your load balancing, for free, with zero extra code.

### Why `basic_qos(prefetch_count=1)` matters

Without it, RabbitMQ dispatches messages to consumers round-robin *regardless of how busy each one is*. If Consumer A is slow and Consumer B is fast, RabbitMQ still gives them an equal share, so A backs up while B sits idle. `prefetch_count=1` says "don't give this consumer a new message until it finishes (acks) the current one" — so fast consumers naturally pick up more of the load.

### Why manual ack instead of auto-ack

If a consumer crashes mid-task with auto-ack on, the message is just gone — RabbitMQ already considered it delivered. With manual ack, an unacked message gets **requeued** automatically when the consumer's connection drops. This is the difference between "might silently lose work" and "worst case, reprocess it."

## Fan-out pattern (pub/sub, one event → many services)

Use when multiple, independent services all need to know something happened — e.g., "order placed" needs to trigger email, inventory update, and analytics, and none of those three should know about each other.

**Producer (publishes once, to a fanout exchange):**
```python
import pika

connection = pika.BlockingConnection(pika.ConnectionParameters('localhost'))
channel = connection.channel()

channel.exchange_declare(exchange='order_events', exchange_type='fanout', durable=True)

channel.basic_publish(
    exchange='order_events',
    routing_key='',  # ignored by fanout exchanges
    body='{"order_id": 1234, "status": "placed"}',
    properties=pika.BasicProperties(delivery_mode=2)
)
connection.close()
```

**Each consumer (declares its own queue, binds it to the exchange):**
```python
import pika

connection = pika.BlockingConnection(pika.ConnectionParameters('localhost'))
channel = connection.channel()

channel.exchange_declare(exchange='order_events', exchange_type='fanout', durable=True)

# each service gets its own named, durable queue — NOT an anonymous one, see note below
result = channel.queue_declare(queue='email_service_queue', durable=True)
channel.queue_bind(exchange='order_events', queue='email_service_queue')

def callback(ch, method, properties, body):
    print(f"[email service] sending confirmation for: {body}")
    ch.basic_ack(delivery_tag=method.delivery_tag)

channel.basic_qos(prefetch_count=1)
channel.basic_consume(queue='email_service_queue', on_message_callback=callback)
channel.start_consuming()
```

> **Note:** tutorials often show `queue_declare(queue='', exclusive=True)` (an anonymous, auto-deleted queue) for fan-out demos. That's fine for a throwaway example, but in a real service you want a **named, durable queue** — otherwise, if your consumer goes offline, every message published while it's down is lost instead of waiting for it.

## Topic pattern (routing by pattern)

Use when different consumers care about different *slices* of the same stream — e.g., one consumer wants all `order.*` events, another only wants `*.failed` events regardless of domain.

```python
# producer
channel.exchange_declare(exchange='events', exchange_type='topic', durable=True)
channel.basic_publish(exchange='events', routing_key='order.shipped', body='...')
channel.basic_publish(exchange='events', routing_key='payment.failed', body='...')

# consumer interested in all order events
channel.queue_bind(exchange='events', queue='order_watcher', routing_key='order.*')

# consumer interested in all failures, any domain
channel.queue_bind(exchange='events', queue='failure_watcher', routing_key='*.failed')
```

`*` matches exactly one word; `#` matches zero or more words (`order.#` catches `order.shipped`, `order.shipped.eu`, and just `order`).

## CLI commands you'll actually use

```bash
rabbitmqctl list_queues                      # name + message count for every queue
rabbitmqctl list_queues name messages consumers
rabbitmqctl list_exchanges
rabbitmqctl list_bindings
rabbitmqctl purge_queue task_queue           # empty a queue — useful in dev
rabbitmqctl status                           # is the broker healthy
```

(If running via Docker, prefix with `docker exec rabbitmq`.)

## What you can do now

At this point you can: stand up RabbitMQ locally, understand why messages flow producer → exchange → queue → consumer, build a basic load-balanced task queue, fan a single event out to multiple independent services, and route messages by pattern. That's genuinely most of what "using RabbitMQ" means day to day.

Next: `advanced.md` for what changes when this needs to survive production — durability guarantees, dead-letter queues, retry strategy, and the failure modes that don't show up until things go wrong.
