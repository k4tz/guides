"""
The interesting consumer: deliberately fails ~50% of the time to simulate
a flaky downstream (e.g. analytics DB timeout). Demonstrates the full
retry-with-backoff -> DLQ pattern described in advanced.md.

Flow per message:
  1. try to "process" it (randomly fails)
  2. on success: ack, done
  3. on failure:
     - if retry count < MAX_RETRIES: nack(requeue=False) -> goes to
       analytics_retry_queue, sits for RETRY_TTL_MS, comes back automatically
     - if retry count >= MAX_RETRIES: publish to the DLQ directly and ack
       the original (we don't want it endlessly cycling)

Run this, then producer.py --loop 10, and watch the terminal: you'll see
some orders succeed immediately, some retry once or twice then succeed,
and occasionally one exhausts retries and lands in analytics_dlq.

Check the DLQ contents anytime with:
    python inspect_dlq.py
"""

import json
import random

import pika

from topology import MAX_RETRIES, get_channel


def process_analytics_event(order: dict) -> bool:
    """Simulates a flaky downstream call. Returns True on success."""
    return random.random() > 0.5


def callback(ch, method, properties, body):
    order = json.loads(body)
    headers = properties.headers or {}
    retry_count = headers.get("x-retry-count", 0)

    success = process_analytics_event(order)

    if success:
        print(f"[analytics] processed order {order['order_id']} (attempt {retry_count + 1})")
        ch.basic_ack(delivery_tag=method.delivery_tag)
        return

    if retry_count < MAX_RETRIES:
        print(
            f"[analytics] FAILED order {order['order_id']} "
            f"(attempt {retry_count + 1}/{MAX_RETRIES}) — will retry in ~10s"
        )
        # republish to the retry queue ourselves with an incremented counter,
        # then ack+drop the original — this lets us control the retry count
        # in a header, since a plain nack/requeue can't modify headers.
        ch.basic_publish(
            exchange="analytics_retry_exchange",
            routing_key="retry",
            body=body,
            properties=pika.BasicProperties(
                delivery_mode=2,
                headers={"x-retry-count": retry_count + 1},
            ),
        )
        ch.basic_ack(delivery_tag=method.delivery_tag)
    else:
        print(
            f"[analytics] order {order['order_id']} exhausted {MAX_RETRIES} retries "
            f"— sending to DLQ for manual review"
        )
        ch.basic_publish(
            exchange="analytics_dlx",
            routing_key="dead",
            body=body,
            properties=pika.BasicProperties(delivery_mode=2, headers=headers),
        )
        ch.basic_ack(delivery_tag=method.delivery_tag)


def main():
    connection, channel = get_channel()
    channel.basic_qos(prefetch_count=1)
    channel.basic_consume(queue="analytics_queue", on_message_callback=callback)

    print("[analytics] waiting for orders (this service simulates ~50% failure). Ctrl+C to exit.")
    try:
        channel.start_consuming()
    except KeyboardInterrupt:
        connection.close()


if __name__ == "__main__":
    main()
