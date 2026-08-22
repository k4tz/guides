import asyncio
from fastapi import FastAPI, Query

app = FastAPI(title="Payment Stub")

@app.post("/charges")
async def charge(order_id: int, delay: float = Query(default=0.0, ge=0, le=30)):
    await asyncio.sleep(delay)
    return {"provider_charge_id": f"ch_{order_id}", "status": "authorized"}
