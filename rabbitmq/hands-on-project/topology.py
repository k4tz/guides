"""
Declares the full exchange/queue topology for the order-processing system.
Every script imports and calls setup(channel) so topology is always
consistent no matter which script you start first — this is a normal
real-world pattern (declaring is idempotent/safe to repeat).

Topology:

  orders_exchange (fanout)
      |-- inventory_queue      -> inventory_service.py
      |-- email_queue          -> email_service.py
      |-- analytics_queue      -> analytics_service.py  (this one simulates
      |                          failures, to demonstrate retry + DLQ)

  Retry / DLQ chain for analytics_queue only:

  analytics_queue --(nack, requeue=False)--> retry_exchange
      -> analytics_retry_queue (TTL 10s, dead-letters back to orders_exchange... 
         no: back to a direct exchange pointed at analytics_queue)
      -> after TTL expires -> analytics_queue (retried)

  After MAX_RETRIES (tracked in message header) -> analytics_dlq (final, alerted on)
"""

import pika

MAX_RETRIES = 3
RETRY_TTL_MS = 10_000  # 10s delay before retry, kept short so the demo is fast


def setup(channel: pika.channel.Channel):
    # --- main fanout exchange all events are published to ---
    channel.exchange_declare(
        exchange="orders_exchange", exchange_type="fanout", durable=True
    )

    # --- inventory service: simple durable queue, no special handling ---
    channel.queue_declare(queue="inventory_queue", durable=True)
    channel.queue_bind(exchange="orders_exchange", queue="inventory_queue")

    # --- email service: simple durable queue, no special handling ---
    channel.queue_declare(queue="email_queue", durable=True)
    channel.queue_bind(exchange="orders_exchange", queue="email_queue")

    # --- analytics service: has retry + DLQ wired up ---
    # direct exchange used to route failed/retried analytics messages
    channel.exchange_declare(
        exchange="analytics_retry_exchange", exchange_type="direct", durable=True
    )
    channel.exchange_declare(
        exchange="analytics_dlx", exchange_type="direct", durable=True
    )

    # the real queue analytics_service.py consumes from
    channel.queue_declare(
        queue="analytics_queue",
        durable=True,
        arguments={
            # if nacked with requeue=False, message goes here to wait out its retry delay
            "x-dead-letter-exchange": "analytics_retry_exchange",
            "x-dead-letter-routing-key": "retry",
        },
    )
    channel.queue_bind(exchange="orders_exchange", queue="analytics_queue")

    # holding queue: messages sit here for RETRY_TTL_MS, then automatically
    # dead-letter BACK into analytics_queue for another attempt
    channel.queue_declare(
        queue="analytics_retry_queue",
        durable=True,
        arguments={
            "x-message-ttl": RETRY_TTL_MS,
            "x-dead-letter-exchange": "",  # default exchange
            "x-dead-letter-routing-key": "analytics_queue",  # routes straight back by queue name
        },
    )
    channel.queue_bind(
        exchange="analytics_retry_exchange",
        queue="analytics_retry_queue",
        routing_key="retry",
    )

    # final resting place after MAX_RETRIES — a human needs to look at these
    channel.queue_declare(queue="analytics_dlq", durable=True)
    channel.queue_bind(exchange="analytics_dlx", queue="analytics_dlq", routing_key="dead")


def get_channel():
    connection = pika.BlockingConnection(pika.ConnectionParameters("localhost"))
    channel = connection.channel()
    setup(channel)
    return connection, channel
