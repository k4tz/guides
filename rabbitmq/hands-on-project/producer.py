"""
Simulates an order-placement service. Publishes one "order placed" event
per run (or in a loop with --loop) to the fanout exchange. Every bound
service (inventory, email, analytics) gets its own copy.

Usage:
    python producer.py                  # send one order
    python producer.py --loop 10        # send 10 orders, 1s apart
"""

import argparse
import json
import random
import time
import uuid

import pika

from topology import get_channel


def publish_order(channel: pika.channel.Channel, order_id: str):
    payload = {
        "order_id": order_id,
        "item": random.choice(["widget", "gadget", "gizmo"]),
        "amount": round(random.uniform(10, 500), 2),
    }

    channel.basic_publish(
        exchange="orders_exchange",
        routing_key="",  # ignored by fanout exchanges
        body=json.dumps(payload),
        properties=pika.BasicProperties(
            delivery_mode=2,  # persistent
            headers={"x-retry-count": 0},
        ),
    )
    print(f"[producer] published order {order_id}: {payload}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--loop", type=int, default=1, help="how many orders to send")
    args = parser.parse_args()

    connection, channel = get_channel()
    channel.confirm_delivery()  # so we actually know the broker accepted each publish

    for _ in range(args.loop):
        order_id = str(uuid.uuid4())[:8]
        publish_order(channel, order_id)
        if args.loop > 1:
            time.sleep(1)

    connection.close()


if __name__ == "__main__":
    main()
