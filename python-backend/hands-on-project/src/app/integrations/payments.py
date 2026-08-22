import httpx

from app.config import settings


class PaymentProviderError(RuntimeError):
    pass


async def authorize(order_id: int) -> dict[str, str]:
    timeout = httpx.Timeout(settings.payment_timeout_seconds, connect=1.0)
    try:
        async with httpx.AsyncClient(base_url=settings.payment_base_url, timeout=timeout) as client:
            response = await client.post("/charges", params={"order_id": order_id})
            response.raise_for_status()
            return response.json()
    except httpx.TimeoutException as exc:
        raise PaymentProviderError("payment provider timed out") from exc
    except httpx.HTTPError as exc:
        raise PaymentProviderError("payment provider failed") from exc
