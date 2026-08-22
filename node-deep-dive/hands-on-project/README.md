# Node.js Order Service — Hands-on Project

This is the runnable project for the Node.js Deep Dive guide.

## Modes

### Intended production-like mode

Requires Docker and npm dependencies:

```bash
npm install
docker compose up -d postgres redis
npm run dev
```

### Verification / no-infrastructure mode

The service can run without PostgreSQL/Redis:

```bash
npm run dev:memory
```

This mode is intentionally limited to exercising Node runtime behavior and application logic. It is not a replacement for testing the real PostgreSQL/Redis adapters.

## Tests

```bash
npm test
```

## Demos

```bash
npm run event-loop
npm run child-process
npm run benchmark
```
