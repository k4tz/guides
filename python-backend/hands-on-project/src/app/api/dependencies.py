try:
    from redis.asyncio import Redis
except ImportError:  # local verification fallback; production installs redis
    Redis = object  # type: ignore[misc,assignment]

from app.config import settings


class InMemoryRedis:
    def __init__(self):
        self.data: dict[str, str] = {}

    async def get(self, key: str):
        return self.data.get(key)

    async def set(self, key: str, value: str, ex: int | None = None):
        self.data[key] = value

    async def ping(self):
        return True

    async def aclose(self):
        return None


if Redis is object:
    redis_client = InMemoryRedis()
else:
    redis_client = Redis.from_url(settings.redis_url, decode_responses=True)


def get_redis():
    return redis_client
