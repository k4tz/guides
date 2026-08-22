from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import CreateOrder, OrderResponse, PaymentResponse
from app.db.session import get_session
from app.repositories.orders import get_order
from app.services.orders import create_order
from app.services.payments import PaymentServiceError, create_payment
from app.api.dependencies import get_redis

router = APIRouter(prefix="/orders", tags=["orders"])


@router.post("", response_model=OrderResponse, status_code=201)
async def post_order(payload: CreateOrder, session: AsyncSession = Depends(get_session)):
    return await create_order(session, payload)


@router.get("/{order_id}", response_model=OrderResponse)
async def read_order(order_id: int, session: AsyncSession = Depends(get_session)):
    order = await get_order(session, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="order not found")
    return order


@router.post("/{order_id}/payment", response_model=PaymentResponse)
async def pay_order(
    order_id: int,
    idempotency_key: str,
    session: AsyncSession = Depends(get_session),
    redis=Depends(get_redis),
):
    order = await get_order(session, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="order not found")
    try:
        return await create_payment(session, order_id, idempotency_key, redis)
    except PaymentServiceError as exc:
        raise HTTPException(status_code=504, detail=str(exc)) from exc
