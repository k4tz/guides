import json
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Payment
from app.integrations.payments import PaymentProviderError, authorize


class PaymentServiceError(RuntimeError):
    pass


async def create_payment(session: AsyncSession, order_id: int, key: str, redis) -> Payment:
    cached = await redis.get(f"idempotency:{key}")
    if cached:
        data = json.loads(cached)
        payment = await session.get(Payment, data["payment_id"])
        if payment:
            return payment

    existing = await session.scalar(select(Payment).where(Payment.idempotency_key == key))
    if existing:
        return existing

    payment = Payment(order_id=order_id, idempotency_key=key, status="pending")
    session.add(payment)
    await session.commit()
    await session.refresh(payment)

    try:
        result = await authorize(order_id)
    except PaymentProviderError:
        payment.status = "failed"
        await session.commit()
        raise PaymentServiceError("payment provider unavailable")

    payment.status = "authorized"
    payment.provider_charge_id = result["provider_charge_id"]
    await session.commit()
    await session.refresh(payment)
    await redis.set(f"idempotency:{key}", json.dumps({"payment_id": payment.id}), ex=3600)
    return payment
