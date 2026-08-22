import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';

export const requestContext = new AsyncLocalStorage();

export function runWithRequestContext(handler) {
  return (req, res) => {
    const requestId = req.headers['x-request-id'] || crypto.randomUUID();
    requestContext.run({ requestId }, () => {
      res.setHeader('x-request-id', requestId);
      handler(req, res);
    });
  };
}

export function getRequestId() {
  return requestContext.getStore()?.requestId;
}
