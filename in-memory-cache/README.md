# In-Memory Cache

Practical guide to using **Redis as an in-memory cache**, from basic commands and cache-aside patterns to production concerns.

## Contents

### [Basic](./basic.md) 
Start here. Covers:
- Redis fundamentals
- Commands
- TTLs
- Data types
- Cache-aside
- Key design
- Local setup.
### [Advanced](./advanced.md) 
Best practices and production-readiness. Covers:
- Cache invalidation
- Stampedes
- Hot keys
- Eviction
- Memory management
- Persistence
- HA
- Consistency
- Monitoring
- Production failure modes.
### [Hands-on](./hands-on.md) 
A runnable exercise.
Build a small Redis-backed cache and deliberately exercise misses, expiration, invalidation, stampedes, memory limits, and Redis failures.
