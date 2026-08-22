import { AppError } from '../errors.js';

export async function chargePayment({ orderId, amountCents, delayMs = 0, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${process.env.PAYMENT_STUB_PORT ?? 3100}/charge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId, amountCents, delayMs }),
      signal: controller.signal
    });
    if (!response.ok) throw new AppError('Payment provider rejected the request', 502, 'PAYMENT_PROVIDER_ERROR');
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw new AppError('Payment provider timed out', 504, 'PAYMENT_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
