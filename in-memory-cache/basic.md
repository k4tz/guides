# In-Memory Cache Basics — A Practical Guide

Just the cache. Redis is the concrete example, but the concepts apply to in-memory caches generally.

---

## 1. What is an in-memory cache?

An in-memory cache stores frequently accessed data in RAM so that applications don't have to repeatedly fetch or calculate it.

Typical architecture:

```text
Application
    ↓
   Cache
    ↓ miss
 Database
```

The important distinction:

> **The database is usually the source of truth. The cache is disposable.**

If Redis disappears, your application should normally be able to rebuild the cached data from the database or another source.

Typical things to cache:

* Database query results
* User/profile data
* API responses
* Expensive computations
* Configuration
* Sessions
* Rate-limit counters
* Feature flags
* Frequently accessed objects

Redis is commonly used because it provides fast in-memory operations plus useful data structures, expiration, persistence, replication, and clustering.

---

## 2. Install Redis

The easiest way to run Redis locally is Docker:

```bash
docker run -d \
  --name redis \
  -p 6379:6379 \
  redis:latest
```

Check that it's running:

```bash
docker ps
```

Connect to it:

```bash
docker exec -it redis redis-cli
```

Or, if you have `redis-cli` installed locally:

```bash
redis-cli
```

Test it:

```text
PING
```

```text
PONG
```

Redis officially documents both the Docker setup and using `docker exec` to access `redis-cli`.

---

## 3. The mental model

Think of Redis as a very fast key-value store:

```text
key → value
```

For example:

```text
user:123 → {"name":"Alice","age":30}
```

Your application:

```text
1. GET user:123 from Redis
2. If found → use it
3. If missing → query database
4. Put result into Redis
5. Return result
```

This is called **cache-aside** and is the most common application-level caching pattern.

---

## 4. Basic commands

### SET

Store a value:

```text
SET user:123 "Alice"
```

### GET

Read it:

```text
GET user:123
```

### DEL

Delete it:

```text
DEL user:123
```

### EXISTS

Check whether a key exists:

```text
EXISTS user:123
```

### KEYS

Find keys:

```text
KEYS user:*
```

**Don't use `KEYS *` in production.**

It can scan the entire keyspace synchronously.

Use `SCAN` instead:

```text
SCAN 0 MATCH user:* COUNT 100
```

---

## 5. Expiration / TTL

Most cache entries should expire.

Set a value with a TTL:

```text
SET user:123 "Alice" EX 300
```

This means:

```text
user:123
    ↓
exists for 300 seconds
    ↓
automatically disappears
```

You can also set expiration separately:

```text
SET user:123 "Alice"
EXPIRE user:123 300
```

Check the remaining TTL:

```text
TTL user:123
```

Redis also supports millisecond precision with `PX` / `PTTL`.

### Remove expiration

```text
PERSIST user:123
```

### Common pattern

For cached database data:

```text
SET product:123 "<serialized product>" EX 300
```

Don't blindly cache forever.

---

## 6. Useful string operations

Strings are the simplest Redis data type.

```text
SET name "Alice"
GET name
```

Counters are particularly useful:

```text
SET requests 0
INCR requests
INCR requests
GET requests
```

Result:

```text
2
```

Decrement:

```text
DECR requests
```

Increment by a specific amount:

```text
INCRBY requests 10
```

These are useful for:

* Rate limiting
* Counters
* Metrics
* Temporary state

---

## 7. Hashes

Hashes are useful for storing an object with fields.

Instead of:

```text
user:123 → '{"name":"Alice","age":30,"country":"IN"}'
```

you can use:

```text
HSET user:123 name "Alice"
HSET user:123 age 30
HSET user:123 country "IN"
```

Read one field:

```text
HGET user:123 name
```

Read everything:

```text
HGETALL user:123
```

Delete a field:

```text
HDEL user:123 country
```

Hashes are useful for simple objects, counters, and state where you don't need to replace the entire object at once.

---

## 8. Lists

Lists are ordered collections.

```text
LPUSH queue "job-1"
LPUSH queue "job-2"
```

Read:

```text
LRANGE queue 0 -1
```

Remove from the right:

```text
RPOP queue
```

Lists can be used for simple queues, but don't automatically reach for Redis lists when you actually need a durable messaging system.

---

## 9. Sets

Sets contain unique values.

```text
SADD user:123:roles admin
SADD user:123:roles editor
```

Read:

```text
SMEMBERS user:123:roles
```

Check membership:

```text
SISMEMBER user:123:roles admin
```

Useful for:

* Tags
* Membership
* Feature flags
* Sets of IDs
* Deduplication

---

## 10. Sorted sets

Sorted sets associate a score with each member.

```text
ZADD leaderboard 100 alice
ZADD leaderboard 250 bob
ZADD leaderboard 175 charlie
```

Read highest scores:

```text
ZREVRANGE leaderboard 0 9 WITHSCORES
```

Useful for:

* Leaderboards
* Rankings
* Priority queues
* Time-based indexes
* Scores

---

## 11. JSON / application objects

Your application will often serialize objects before putting them into Redis.

For example:

```json
{
  "id": 123,
  "name": "Alice",
  "country": "IN"
}
```

Stored as:

```text
SET user:123 '{"id":123,"name":"Alice","country":"IN"}' EX 300
```

The cache doesn't need to understand your application's object model.

The application serializes/deserializes it.

Common formats:

* JSON
* MessagePack
* Protocol Buffers
* Application-specific binary formats

For most applications, start with JSON unless you have a reason not to.

---

## 12. The cache-aside pattern

The pattern you'll use most often:

```text
getUser(123)

      ↓

GET user:123
      ↓
   ┌──┴──┐
 HIT    MISS
  ↓       ↓
return   DB
          ↓
       SET cache
          ↓
        return
```

Pseudo-code:

```text
user = cache.get("user:123")

if user exists:
    return user

user = database.getUser(123)

cache.set("user:123", user, TTL=300)

return user
```

This keeps the database authoritative and uses Redis purely as an optimization.

---

## 13. Updating cached data

Suppose:

```text
Database:
user:123 = Alice
```

and:

```text
Cache:
user:123 = Alice
```

You update the database:

```text
user:123 = Bob
```

The cache now contains stale data.

The simplest solution:

```text
UPDATE database
DELETE cache:user:123
```

The next read gets Bob from the database and repopulates the cache.

This is usually safer than trying to update both systems perfectly.

---

## 14. Cache keys

Treat cache keys as part of your application's API.

Bad:

```text
123
```

Better:

```text
user:123
```

Better for larger systems:

```text
prod:user:123
```

For multi-tenant applications:

```text
tenant:456:user:123
```

For versioning:

```text
v2:user:123
```

Good keys are:

* Deterministic
* Unique
* Easy to inspect
* Namespaced
* Consistent across the application

---

## 15. The commands worth memorizing

If you only remember a small set:

```text
PING

SET key value
GET key
DEL key
EXISTS key

SET key value EX 300
TTL key
EXPIRE key 300
PERSIST key

INCR key
DECR key

HSET key field value
HGET key field
HGETALL key

SADD key value
SMEMBERS key

SCAN 0 MATCH pattern COUNT 100

INFO
MEMORY USAGE key
```

That's enough for a large amount of day-to-day Redis work.

---

## 16. A basic cache configuration

For local development:

```yaml
services:
  redis:
    image: redis:latest
    ports:
      - "6379:6379"
```

Start:

```bash
docker compose up -d
```

Stop:

```bash
docker compose down
```

Connect:

```bash
docker exec -it redis redis-cli
```

For a real application, your application should connect using configuration rather than hardcoding:

```text
REDIS_HOST
REDIS_PORT
REDIS_PASSWORD
```

---

## 17. What to skip for now

Don't worry about these until you actually need them:

* Redis internals
* Redis Cluster internals
* Replication protocol details
* RDB file format
* AOF file format
* Redis module development
* Lua scripting internals
* Memory allocator internals
* Custom Redis modules

First get comfortable with:

```text
GET / SET
TTL
key design
cache-aside
invalidation
memory limits
monitoring
failure behavior
```

Then move to `advanced.md`.
