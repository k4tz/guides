# In-Memory Cache — Production Guide

Once Redis works locally, the hard part isn't `GET` and `SET`.

The hard part is deciding:

* What should be cached?
* How long?
* What happens when it changes?
* What happens when Redis dies?
* What happens when 10,000 requests miss at once?
* How much memory do you need?
* Should the cache itself be persistent?
* How do you know whether caching is actually helping?

---

## 1. Cache vs database

The default architecture should be:

```text
                 ┌─────────────┐
                 │  Database   │
                 │ source truth│
                 └──────┬──────┘
                        │
                        │ populate
                        ▼
                 ┌─────────────┐
                 │    Redis    │
                 │    cache    │
                 └──────┬──────┘
                        │
                        ▼
                    Application
```

If Redis is deleted:

```text
Redis disappears
      ↓
Application still works
      ↓
Cache gets rebuilt
```

If your application cannot function without the contents of Redis, ask whether Redis is actually being used as a cache or as a primary datastore.

---

## 2. TTL is not optional

For normal cached application data, have an explicit expiration policy.

Example:

```text
product:123 → 5 minutes
user:123 → 5 minutes
homepage → 30 seconds
country:list → 24 hours
```

The right TTL comes from the business requirement:

> How stale can this data safely be?

Don't pick `1 hour` because it sounds reasonable.

If stale data is unacceptable, TTL alone isn't enough. You need invalidation or synchronous updates.

---

## 3. Cache invalidation

The classic pattern:

```text
Write:

Database
   ↓
DELETE cache
```

Then:

```text
Read:

Cache
 ↓ miss
Database
 ↓
Cache
```

This is often preferable to:

```text
Database
   ↓
Update cache
```

because now you have two writes that can independently fail.

Example:

```text
UPDATE users
SET name = 'Bob'
WHERE id = 123;

DEL user:123;
```

If deleting the cache fails, the old value remains temporarily.

The TTL eventually limits how long it can remain stale.

---

## 4. Write-through

Another option:

```text
Application
     ↓
   Cache
     ↓
  Database
```

The cache updates the backing store as part of the write path.

Useful when you want the cache populated immediately.

Tradeoff:

* More coupling
* More complexity
* Writes depend on both systems

Don't use write-through simply because it sounds more sophisticated.

---

## 5. Write-behind / write-back

```text
Application
     ↓
   Cache
     ↓
  later
     ↓
 Database
```

Fast, but dangerous.

If Redis disappears before the data reaches the database:

```text
data = gone
```

Only use this when you've explicitly designed for:

* Durability
* Retries
* Ordering
* Failure recovery
* Backpressure

---

## 6. Write-around

Writes bypass the cache:

```text
Application ─────→ Database

Reads:
Application → Cache → Database on miss
```

This is useful when newly written data is unlikely to be read immediately.

Otherwise you can fill your cache with data nobody asks for.

---

## 7. Cache stampede

A classic production failure:

```text
Popular key:
homepage

TTL:
300 seconds
```

At 12:00 it expires.

10,000 requests arrive:

```text
10,000 requests
      ↓
10,000 cache misses
      ↓
10,000 database queries
```

Your cache just caused a database incident.

---

## 8. Preventing stampedes

### Request coalescing

Only one request regenerates a missing value.

```text
Request 1 ──→ DB
Request 2 ─┐
Request 3 ─┤ wait
Request 4 ─┘
```

When request 1 gets the result, the others use it.

### Distributed lock

A common Redis pattern:

```text
SET lock:user:123 <token> NX EX 10
```

`NX` means only create the key if it doesn't already exist.

The lock holder regenerates the cache.

The lock must have an expiration so a crashed process doesn't hold it forever.

### TTL jitter

Don't give 1 million keys exactly the same TTL.

Instead:

```text
TTL = 300 + random(0..60)
```

This spreads expirations over time.

---

## 9. Cache avalanche

A cache avalanche happens when many keys expire around the same time.

Bad:

```text
10,000,000 keys
TTL = 3600
```

They may have been populated around the same time and expire together.

Use:

* TTL jitter
* Staggered warming
* Refresh-ahead
* Background refresh

---

## 10. Hot keys

One key can be much hotter than everything else.

Example:

```text
homepage
```

receives 1 million requests/second.

Even though Redis is fast, concentrating huge traffic on one key/node can become a bottleneck.

Typical solutions:

* Local application cache
* CDN
* Replication
* Key replication
* Request coalescing
* Precomputation

Don't assume "Redis can handle millions of operations" means every key can handle unlimited traffic.

---

## 11. Negative caching

Not-found responses can also be cached.

Without negative caching:

```text
GET user:999999

Redis → MISS
DB → NOT FOUND
```

Repeated 10,000 times:

```text
10,000 DB queries
```

Instead:

```text
user:999999 → NOT_FOUND
TTL = 30 seconds
```

Now repeated invalid requests never reach the database during those 30 seconds.

Be careful with the TTL. A real object may be created while the negative entry is still cached.

---

## 12. Cache penetration

Cache penetration happens when requests consistently bypass the cache.

Common causes:

* IDs that don't exist
* Malicious random IDs
* Queries that cannot be cached
* Incorrect cache keys

Defenses:

* Negative caching
* Input validation
* Rate limiting
* Request normalization
* Bloom filters for very large keyspaces

---

## 13. Eviction

Redis needs to know what to do when it reaches its memory limit.

Set a limit:

```text
maxmemory 4gb
```

Then choose a policy.

Common policies include:

```text
noeviction
allkeys-lru
allkeys-lfu
volatile-lru
volatile-lfu
allkeys-random
volatile-random
volatile-ttl
```

For a pure cache, `allkeys-lru` or `allkeys-lfu` are common starting points.

Redis supports configuring `maxmemory` and eviction policies specifically for cache workloads.

---

## 14. LRU vs LFU

### LRU

Least Recently Used.

Evicts things that haven't been accessed recently.

Good general-purpose choice.

### LFU

Least Frequently Used.

Evicts things that aren't accessed often.

Can work better when a small number of keys are consistently hot.

Start with LRU unless you have evidence that LFU is better for your workload.

---

## 15. Don't run Redis without a memory limit

A production Redis instance should have an intentional memory ceiling.

Without an explicit `maxmemory`, Redis can continue allocating memory and consume system resources.

Also leave room for:

* Redis overhead
* allocator fragmentation
* replication
* persistence operations
* operating system
* container overhead

Don't provision:

```text
Server RAM = 16 GB
Redis maxmemory = 16 GB
```

Give yourself headroom.

---

## 16. Memory isn't just your values

This:

```text
key = user:123
value = {"name":"Alice"}
```

doesn't cost only the JSON size.

Redis also stores:

* Key metadata
* Value metadata
* Data structure overhead
* Allocator overhead
* Internal structures

Millions of tiny keys can therefore consume much more memory than expected.

Check individual keys:

```text
MEMORY USAGE user:123
```

Check overall usage:

```text
INFO memory
```

---

## 17. Persistence

Redis can persist its in-memory dataset using:

* RDB snapshots
* AOF
* Both
* Neither

RDB periodically creates point-in-time snapshots.

AOF records write operations and can provide stronger durability.

For a disposable cache, **no persistence can be perfectly reasonable**.

For Redis being used as important application state, persistence and backup requirements change significantly. Redis officially documents RDB, AOF, combined persistence, and no-persistence configurations.

Ask:

> If I lose everything currently in Redis, can I rebuild it?

If yes, persistence may not be necessary.

---

## 18. Persistence is not a backup strategy

If Redis contains important data:

```text
Redis persistence
```

and:

```text
Backup / disaster recovery
```

are separate concerns.

You still need to decide:

* What gets backed up?
* How often?
* Where?
* How long?
* How do you restore?
* Have you actually tested restoration?

---

## 19. Replication

For production:

```text
             ┌───────────┐
             │  Primary  │
             └─────┬─────┘
                   │
             ┌─────┴─────┐
             ▼           ▼
         Replica 1   Replica 2
```

Replication provides:

* Read scaling
* Failover options
* Redundancy

But replication isn't the same as backup.

If you accidentally delete everything from the primary, that deletion can propagate to replicas.

---

## 20. High availability

A production cache should have an answer to:

> What happens when the Redis node dies?

Possible architectures:

```text
Single Redis
```

Good for:

* Development
* Small workloads
* Non-critical caches

or:

```text
Primary
   ↓
Replicas
   ↓
Automatic failover
```

or a managed Redis service that handles:

* Replication
* Failover
* Monitoring
* Backups
* Scaling

Don't build Redis HA yourself unless you have a reason.

---

## 21. Redis Cluster

Redis Cluster distributes keys across multiple Redis nodes.

Conceptually:

```text
             Redis Cluster
          /       |       \
       Node 1   Node 2   Node 3
```

Useful when a single Redis node isn't sufficient for:

* Memory
* Throughput
* Availability

Cluster adds operational complexity.

Don't start with Cluster because "production means Cluster."

Start with the simplest architecture that satisfies your requirements.

---

## 22. Local cache + Redis

For very hot data:

```text
Application
    ↓
L1: process memory
    ↓ miss
L2: Redis
    ↓ miss
L3: Database
```

L1 is extremely fast because there is no network hop.

The downside:

```text
App 1 → different cache
App 2 → different cache
App 3 → different cache
```

Invalidation becomes harder.

Use this when the performance benefit is worth the additional consistency complexity.

---

## 23. Cache consistency

There are three useful questions:

### Is stale data acceptable?

If yes:

```text
TTL-based caching
```

may be enough.

### How stale can it be?

For example:

```text
Maximum staleness = 60 seconds
```

### Must updates be immediately visible?

If yes, you need stronger invalidation/update guarantees.

Don't design the cache before defining the consistency requirement.

---

## 24. Event-driven invalidation

For larger systems:

```text
Database
   ↓
Change event
   ↓
Message broker
   ↓
Cache invalidation
```

For example:

```text
UserUpdated(user_id=123)
        ↓
invalidate user:123
```

This avoids requiring every application instance to know about every write.

Common infrastructure:

* Kafka
* RabbitMQ
* Redis Streams
* Database CDC
* Application events

---

## 25. Double writes

Avoid casually doing:

```text
UPDATE database
SET ...

SET cache ...
```

There are two independent operations.

Possible result:

```text
Database = new
Cache    = old
```

or:

```text
Database = old
Cache    = new
```

A safer common pattern is:

```text
UPDATE database
DELETE cache
```

Then the next read repopulates the cache.

For more complex systems, use events/outbox/CDC.

---

## 26. Cache key versioning

When the cached representation changes:

```text
v1:user:123
```

becomes:

```text
v2:user:123
```

This avoids having old application instances read new-format values during a rolling deployment.

You can also deliberately flush old versions after deployment.

---

## 27. Serialization

Don't blindly serialize giant application objects.

Consider:

* Payload size
* Serialization CPU
* Deserialization CPU
* Network bandwidth
* Memory usage
* Schema compatibility

For many services:

```text
JSON
```

is perfectly adequate.

For high-throughput systems:

```text
MessagePack / Protobuf / binary formats
```

may be worth considering.

Measure before optimizing.

---

## 28. Don't cache personalized data in shared caches

Be careful with:

```text
GET /account
```

If the response depends on the logged-in user, a shared cache can accidentally return:

```text
Alice's response → Bob
```

Cache keys must account for the data's security boundary.

For sensitive or highly personalized responses, don't use a shared cache unless the isolation is explicit and correct.

---

## 29. Multi-tenant applications

Bad:

```text
user:123
```

Potentially better:

```text
tenant:abc:user:123
```

Tenant identity should generally be part of the cache key whenever the same logical ID can exist across tenants.

This isn't just organization.

It's a security boundary.

---

## 30. Distributed locks

Redis is often used for short-lived distributed locks:

```text
SET lock:job:123 random-token NX EX 30
```

The important pieces are:

* `NX` — only acquire if absent
* TTL — don't hold forever
* Unique token — identify your lock
* Safe release — don't delete someone else's lock

Don't implement:

```text
SET lock:123 1
```

and assume you're done.

Locks are subtle in distributed systems.

---

## 31. Rate limiting

Redis is well suited to counters:

```text
INCR rate:user:123
EXPIRE rate:user:123 60
```

For example:

```text
100 requests
per
60 seconds
```

More advanced implementations use:

* Sliding windows
* Token buckets
* Leaky buckets
* Lua scripts
* Sorted sets

---

## 32. Atomicity

Redis commands such as:

```text
INCR
```

are atomic.

But this:

```text
GET counter
INCR counter
SET ...
```

is not one atomic operation.

When multiple operations must behave as one unit, consider:

* Transactions
* Lua scripts
* Atomic commands
* Optimistic locking with `WATCH`

Don't assume "Redis is single-threaded" means arbitrary sequences of commands are atomic.

---

## 33. Pipelining

Without pipelining:

```text
SET
network round trip
SET
network round trip
SET
network round trip
```

With pipelining:

```text
SET
SET
SET
     ↓
one batch of network traffic
```

Useful when performing many independent Redis operations.

It reduces network round trips.

It does not magically make the operations transactional.

---

## 34. Monitoring

At minimum monitor:

```text
Cache hit rate
Cache miss rate
Redis latency
Redis memory usage
Evictions
Connection count
Commands/sec
Errors
Replication health
CPU
Network
```

A cache that is "fast" isn't necessarily helping.

The useful metric is often:

```text
Did caching reduce backend work?
```

---

## 35. Hit rate

Basic metric:

```text
hit rate =
cache hits / (cache hits + cache misses)
```

Example:

```text
950,000 hits
50,000 misses

= 95% hit rate
```

But don't optimize blindly for hit rate.

A 99% hit rate on cheap data may be less valuable than a 70% hit rate on a database query that costs 500 ms.

---

## 36. Latency

Track:

```text
P50
P95
P99
```

not just averages.

For example:

```text
Redis GET

P50 = 0.5ms
P95 = 1ms
P99 = 8ms
```

A rising P99 can indicate:

* Network issues
* CPU pressure
* Memory pressure
* Slow commands
* Connection pool problems
* Persistence activity
* Hot keys

---

## 37. Slow commands

Avoid expensive commands against large datasets.

Be especially careful with commands that scan large amounts of data.

Instead of:

```text
KEYS *
```

use:

```text
SCAN
```

Also be careful with large:

```text
SMEMBERS
LRANGE
HGETALL
```

operations.

The problem isn't that these commands are inherently bad.

The problem is doing enormous operations on enormous values during production traffic.

---

## 38. Large values

Avoid putting huge objects into Redis unless you have a reason.

Instead of:

```text
user:123 → 20 MB JSON object
```

consider:

```text
user:123:profile
user:123:preferences
user:123:permissions
```

Large values can cause:

* Memory pressure
* Network latency
* Serialization cost
* Expensive commands
* Replication overhead

---

## 39. Connection pooling

Your application should normally reuse Redis connections.

Don't do:

```text
request
 ↓
connect Redis
 ↓
GET
 ↓
disconnect
```

for every HTTP request.

Instead:

```text
Application
   ↓
Redis connection pool
   ↓
Redis
```

Size the pool deliberately.

Too small:

```text
requests wait for connections
```

Too large:

```text
too many connections
```

---

## 40. Timeouts

Never let an unavailable cache hang application requests indefinitely.

Have explicit:

```text
Connect timeout
Command timeout
Pool timeout
```

The cache should usually be an optimization, not a reason for your entire application to hang.

---

## 41. Cache failure behavior

Decide this before production.

Example:

```text
Redis timeout
    ↓
Log/metric
    ↓
Fallback to database
```

But be careful:

```text
Redis dies
   ↓
Every request hits DB
   ↓
DB overloaded
   ↓
Application dies
```

This is why cache failure can become a cascading failure.

Mitigations include:

* Circuit breakers
* Rate limiting
* Request shedding
* Database connection limits
* Local caching
* Stale data
* Backpressure

---

## 42. Graceful degradation

For some data:

```text
Redis unavailable
      ↓
Serve slightly stale local data
```

or:

```text
Redis unavailable
      ↓
Skip recommendations
      ↓
Serve main page
```

Not every cached feature should be allowed to take down the request.

---

## 43. Security

Production Redis should not be treated as an open network service.

At minimum consider:

* Network isolation
* Authentication
* TLS where required
* Firewall/security groups
* Least-privilege access
* Secret management
* Encryption requirements
* Tenant isolation
* Sensitive-data policies

Don't expose Redis directly to the public internet.

---

## 44. Production checklist

Before shipping Redis as a cache:

* [ ] Database/source of truth is clearly defined
* [ ] Every cache category has a TTL policy
* [ ] Cache keys are namespaced
* [ ] Tenant/user boundaries are represented in keys where needed
* [ ] Cache invalidation is defined
* [ ] Cache misses are safe
* [ ] Cache failure is safe
* [ ] Stampede protection exists for hot keys
* [ ] Redis has a memory limit
* [ ] Eviction policy is intentional
* [ ] Memory headroom exists
* [ ] Redis latency is monitored
* [ ] Hit/miss rate is monitored
* [ ] Evictions are monitored
* [ ] Connection pooling is configured
* [ ] Timeouts are configured
* [ ] Large keys/values are controlled
* [ ] Dangerous production commands are avoided
* [ ] Persistence requirements are explicit
* [ ] Backup requirements are explicit if data matters
* [ ] Replication/failover requirements are explicit
* [ ] Restore/failover has actually been tested
* [ ] Security/network access is restricted
* [ ] Deployment/schema-versioning strategy exists

---

## 45. What to use when

| Requirement                          | Typical choice            |
| ------------------------------------ | ------------------------- |
| Simple application cache             | Redis                     |
| Simple ephemeral key/value cache     | Redis / Memcached         |
| Shared cache across app instances    | Redis                     |
| Local ultra-low-latency cache        | In-process cache          |
| Static files                         | CDN                       |
| Durable source of truth              | Database                  |
| Durable event stream                 | Kafka / similar           |
| Temporary counters                   | Redis                     |
| Rate limiting                        | Redis                     |
| Distributed short-lived coordination | Redis, carefully          |
| Huge global read traffic             | CDN + Redis + local cache |
| Data that must survive cache loss    | Database / durable store  |

The key point:

> **Redis is a tool. Caching is an architecture decision.**

Don't add Redis because "Redis is fast." Add it because you've identified a specific expensive or high-frequency operation that benefits from caching.
