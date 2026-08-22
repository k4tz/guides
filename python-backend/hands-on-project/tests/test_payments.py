import pytest


@pytest.mark.asyncio
async def test_payment_idempotency(client, monkeypatch):
    async def fake_authorize(order_id: int):
        return {"provider_charge_id": f"test_{order_id}"}

    monkeypatch.setattr("app.services.payments.authorize", fake_authorize)

    order = await client.post("/orders", json={"customer_id": 1, "amount": "10.00", "currency": "USD"})
    order_id = order.json()["id"]

    first = await client.post(f"/orders/{order_id}/payment?idempotency_key=abc")
    second = await client.post(f"/orders/{order_id}/payment?idempotency_key=abc")

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]
    assert second.json()["provider_charge_id"] == "test_1"
