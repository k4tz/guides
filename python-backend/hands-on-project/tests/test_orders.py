import pytest


@pytest.mark.asyncio
async def test_create_and_get_order(client):
    response = await client.post("/orders", json={"customer_id": 7, "amount": "49.99", "currency": "usd"})
    assert response.status_code == 201
    order = response.json()
    assert order["currency"] == "USD"

    response = await client.get(f"/orders/{order['id']}")
    assert response.status_code == 200
    assert response.json()["id"] == order["id"]


@pytest.mark.asyncio
async def test_missing_order(client):
    response = await client.get("/orders/999")
    assert response.status_code == 404
