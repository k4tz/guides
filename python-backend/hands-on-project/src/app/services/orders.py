from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import CreateOrder
from app.db.models import Order


async def create_order(session: AsyncSession, payload: CreateOrder) -> Order:
    order = Order(
        customer_id=payload.customer_id,
        amount=payload.amount,
        currency=payload.currency.upper(),
        status="pending",
    )
    session.add(order)
    await session.commit()
    await session.refresh(order)
    return order
