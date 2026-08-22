"""
Second consumer on the same fanout exchange, completely independent of
inventory_service.py — neither knows the other exists. This is the whole
point of fanout: adding this service required zero changes to the producer.
"""

import json

from topology import get_channel


def callback(ch, method, properties, body):
    order = json.loads(body)
    print(f"[email] sending confirmation email for order {order['order_id']}")
    ch.basic_ack(delivery_tag=method.delivery_tag)


def main():
    connection, channel = get_channel()
    channel.basic_qos(prefetch_count=1)
    channel.basic_consume(queue="email_queue", on_message_callback=callback)

    print("[email] waiting for orders. Ctrl+C to exit.")
    try:
        channel.start_consuming()
    except KeyboardInterrupt:
        connection.close()


if __name__ == "__main__":
    main()
