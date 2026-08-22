"""
Utility script: peek at whatever has landed in analytics_dlq without
permanently removing it. In a real system this is what an on-call engineer
or a small admin tool would run to see what's failing permanently.

Uses queue_declare's message count (passive check) to know how many
messages exist, then basic_get's exactly that many times — each fetched
message is nacked with requeue=True at the END, after we've already
moved past it, so we never re-read the same message twice in one run.
"""

import json

from topology import get_channel


def main():
    connection, channel = get_channel()

    # passive declare just returns queue info (message_count) without
    # altering the queue — safe to call even though it's already declared
    info = channel.queue_declare(queue="analytics_dlq", durable=True, passive=True)
    total = info.method.message_count

    if total == 0:
        print("analytics_dlq is empty — nothing failing permanently right now.")
        connection.close()
        return

    print(f"{total} message(s) currently in analytics_dlq:\n")

    fetched = []
    for _ in range(total):
        method, properties, body = channel.basic_get(queue="analytics_dlq", auto_ack=False)
        if method is None:
            break
        order = json.loads(body)
        retries = (properties.headers or {}).get("x-retry-count", "?")
        print(f"  - order {order['order_id']} — failed after {retries} attempts — {order}")
        fetched.append(method.delivery_tag)

    # put every message back so this script is safe to re-run without
    # permanently draining the queue (a real admin tool would instead let
    # you selectively ack/discard or reprocess individual messages)
    for tag in fetched:
        channel.basic_nack(delivery_tag=tag, requeue=True)

    connection.close()


if __name__ == "__main__":
    main()
