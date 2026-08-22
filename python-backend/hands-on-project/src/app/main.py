from contextlib import asynccontextmanager

from fastapi import FastAPI
from app.api.dependencies import redis_client
from app.api.routes.orders import router as orders_router
from app.config import settings

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await redis_client.aclose()


app = FastAPI(title="Orders API", lifespan=lifespan)
app.include_router(orders_router)


@app.get("/health/live")
async def live():
    return {"status": "ok"}


@app.get("/health/ready")
async def ready():
    await redis_client.ping()
    return {"status": "ok"}
