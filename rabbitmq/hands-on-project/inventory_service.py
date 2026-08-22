"""
Simplest possible consumer: reads from inventory_queue, "decrements stock",
acks. This demonstrates the baseline pattern every consumer follows —
declare topology, set prefetch, ack on success.
"""

import json

from topology import get_channel


def callback(ch, method, properties, body):
    order = json.loads(body)
    print(f"[inventory] reserving stock for order {order['order_id']} ({order['item']})")
    ch.basic_ack(delivery_tag=method.delivery_tag)


def main():
    connection, channel = get_channel()
    channel.basic_qos(prefetch_count=1)
    channel.basic_consume(queue="inventory_queue", on_message_callback=callback)

    print("[inventory] waiting for orders. Ctrl+C to exit.")
    try:
        channel.start_consuming()
    except KeyboardInterrupt:
        connection.close()


if __name__ == "__main__":
    main()
