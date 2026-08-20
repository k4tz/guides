# In-Memory Cache — Hands-On

Build a small application that uses Redis as a cache, then deliberately break things to understand what happens.

The goal isn't to build a Redis application.

The goal is to experience:

```text
cache miss
→ database
→ cache population
→ cache hit
→ expiration
→ invalidation
→ cache failure
→ stampede protection
```

---

## 1. Start Redis

Create `docker-compose.yml`:

```yaml
services:
  redis:
    image: redis:latest
    ports:
      - "6379:6379"
```

Start it:

```bash
docker compose up -d
```

Verify:

```bash
docker exec -it redis redis-cli PING
```

Expected:

```text
PONG
```

---

## 2. Play with the cache

Open Redis:

```bash
docker exec -it redis redis-cli
```

Create a value:

```text
SET user:123 "Alice"
```

Read it:

```text
GET user:123
```

Set an expiration:

```text
EXPIRE user:123 10
```

Check it:

```text
TTL user:123
```

Wait ten seconds and:

```text
GET user:123
```

You should get:

```text
(nil)
```

---

## 3. Build the cache-aside flow

Imagine this is your application:

```text
getUser(123)
```

Implement this logic:

```text
1. GET user:123 from Redis
2. If found:
     return it
3. If missing:
     fetch user from database
4. SET user:123 in Redis with TTL
5. return user
```

For the exercise, fake the database with a local object:

```javascript
const users = {
  123: {
    id: 123,
    name: "Alice"
  }
};
```

The important part isn't the framework.

It's this:

```javascript
let user = await redis.get(`user:${id}`);

if (user) {
  return JSON.parse(user);
}

user = users[id];

await redis.set(
  `user:${id}`,
  JSON.stringify(user),
  { EX: 60 }
);

return user;
```

---

## 4. Verify the cache hit

First request:

```text
GET user:123
```

Application behavior:

```text
Redis MISS
    ↓
Database
    ↓
Redis SET
    ↓
Response
```

Second request:

```text
GET user:123
```

Now:

```text
Redis HIT
    ↓
Response
```

Add logging so you can see the difference:

```text
CACHE MISS user:123
CACHE HIT user:123
```

---

## 5. Measure the difference

Make the fake database deliberately slow:

```javascript
await new Promise(resolve => setTimeout(resolve, 500));
```

Now compare:

```text
First request → ~500ms
Second request → much faster
```

This is the entire reason the cache exists.

---

## 6. Add expiration

Change your cache write to:

```javascript
await redis.set(
  `user:${id}`,
  JSON.stringify(user),
  { EX: 60 }
);
```

Now the cache automatically expires after 60 seconds.

Verify:

```text
TTL user:123
```

---

## 7. Add invalidation

Add an update operation:

```text
updateUser(123, "Bob")
```

The flow should be:

```text
1. Update database
2. Delete cache
```

Example:

```javascript
await updateDatabase(id, user);

await redis.del(`user:${id}`);
```

Next read:

```text
Redis MISS
    ↓
Database → Bob
    ↓
Redis SET
    ↓
Bob
```

This is one of the most common real-world caching patterns.

---

## 8. Add negative caching

Try:

```text
GET user:999
```

If the user doesn't exist, don't repeatedly hit the database.

Cache the negative result:

```javascript
await redis.set(
  `user:${id}`,
  "__NOT_FOUND__",
  { EX: 30 }
);
```

On read:

```javascript
if (value === "__NOT_FOUND__") {
  return null;
}
```

Now repeatedly requesting `user:999` doesn't repeatedly query the database.

---

## 9. Create a hot key

Create:

```text
SET homepage "expensive homepage data" EX 30
```

Then repeatedly:

```text
GET homepage
```

Imagine 100,000 requests arriving simultaneously.

The cache is excellent at handling reads, but what happens when the key expires?

That's the next exercise.

---

## 10. Simulate a cache stampede

Delete the key:

```text
DEL homepage
```

Now imagine many application instances execute:

```text
GET homepage
```

at the same time.

They all see:

```text
MISS
```

and all regenerate the value.

The desired behavior is:

```text
Request 1 → regenerate
Request 2 → wait
Request 3 → wait
Request 4 → wait

              ↓

         one DB query

              ↓

        everyone gets result
```

Implement a short-lived lock:

```text
SET lock:homepage 1 NX EX 10
```

If the command succeeds, you're the process responsible for rebuilding the cache.

If it fails, another process is already rebuilding it.

---

## 11. Inspect memory

Create some keys:

```text
SET user:1 "Alice"
SET user:2 "Bob"
SET user:3 "Charlie"
```

Check memory:

```text
INFO memory
```

Check an individual key:

```text
MEMORY USAGE user:1
```

Now create a large value and inspect its memory usage.

The goal is to understand that:

```text
value size != total Redis memory cost
```

Redis also has key, object, allocator, and internal overhead.

---

## 12. Configure a memory limit

Run Redis with a deliberately tiny limit:

```bash
docker run -d \
  --name redis-small \
  -p 6380:6379 \
  redis:latest \
  redis-server \
  --maxmemory 10mb \
  --maxmemory-policy allkeys-lru
```

Connect:

```bash
docker exec -it redis-small redis-cli
```

Now fill it with data.

Watch:

```text
INFO memory
```

and:

```text
INFO stats
```

Look for eviction-related counters.

The important lesson:

```text
Cache has finite memory.
        ↓
Something eventually has to leave.
```

---

## 13. Experiment with TTL jitter

Instead of:

```javascript
const ttl = 300;
```

use:

```javascript
const ttl = 300 + Math.floor(Math.random() * 60);
```

Now different cache entries expire at different times.

This reduces the chance of large groups of keys expiring together.

---

## 14. Kill Redis

This is the most important exercise.

Stop it:

```bash
docker stop redis
```

Make an application request.

What happens?

Your application should not hang forever waiting for Redis.

It should have a defined policy:

```text
Redis unavailable
      ↓
fallback / degraded path
      ↓
database
```

Restart:

```bash
docker start redis
```

Then verify:

```bash
docker exec -it redis redis-cli PING
```

---

## 15. Test the cold-cache scenario

Delete everything:

```text
FLUSHDB
```

Then send normal application traffic.

Observe:

```text
MISS
MISS
MISS
MISS
...
HIT
HIT
HIT
```

This is what happens after:

* Deployment
* Redis restart
* Failover
* Cache flush
* Large eviction event

A production application must survive a cold cache.

---

## 16. Inspect your keyspace

Use:

```text
SCAN 0
```

Then:

```text
SCAN 0 MATCH user:* COUNT 100
```

Avoid using:

```text
KEYS *
```

against a production dataset.

---

## 17. Final exercise

Build an endpoint:

```text
GET /users/:id
```

with:

```text
Database
   ↓
Redis cache
   ↓
HTTP API
```

Implement:

* [ ] Cache-aside reads
* [ ] 60-second TTL
* [ ] Cache hit/miss logging
* [ ] Database fallback
* [ ] Cache invalidation after update
* [ ] Negative caching for missing users
* [ ] Redis connection timeout
* [ ] Graceful behavior when Redis is unavailable
* [ ] Memory limit
* [ ] Eviction policy
* [ ] A hot-key test
* [ ] A cache stampede test
* [ ] Basic cache metrics

Then deliberately:

```text
- Stop Redis
- Flush the cache
- Fill the cache
- Let keys expire
- Request nonexistent users
- Hammer one hot key
- Restart Redis
```

If the application still behaves correctly, you've covered most of the important practical caching fundamentals.

---

## 18. The production mental model

When adding a cache to a real application, start with this:

```text
                 ┌──────────────┐
                 │   Database   │
                 │ source truth │
                 └──────┬───────┘
                        │
                 populate/invalidate
                        │
                        ▼
                 ┌──────────────┐
                 │    Redis     │
                 │    cache     │
                 └──────┬───────┘
                        │
                        ▼
                    Application
```

Then answer:

```text
What do we cache?
        ↓
What is the key?
        ↓
How long is it valid?
        ↓
How is it invalidated?
        ↓
What happens on a miss?
        ↓
What happens if Redis dies?
        ↓
What happens if 10,000 requests miss?
        ↓
What happens when memory fills?
        ↓
How do we monitor it?
        ↓
Can we rebuild everything?
```

If you can answer those questions, you're no longer just "using Redis."

You're designing a cache.
