from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    session_local = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with session_local() as session:
            yield session
    finally:
        await engine.dispose()
