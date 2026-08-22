from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field


class CreateOrder(BaseModel):
    customer_id: int = Field(gt=0)
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    currency: str = Field(min_length=3, max_length=3)


class OrderResponse(BaseModel):
    id: int
    customer_id: int
    amount: Decimal
    currency: str
    status: str


class PaymentResponse(BaseModel):
    id: int
    order_id: int
    status: Literal["authorized", "pending", "failed"]
    provider_charge_id: str | None = None
