# Testing — Advanced

Unit tests prove your logic works in isolation. This covers what proves the *system* works — integration tests, proper mocking, and the tooling/process that makes tests trustworthy at a team level.

## Integration tests — what they actually verify

A unit test proves "given this input, my function returns the right output." It does **not** prove your function correctly talks to a real database, correctly parses a real HTTP request, or correctly handles what a real external API sends back. That's what integration tests are for.

The key design question for an integration test: **how much of the stack is real, and how much is faked?**

- Testing "does my API endpoint return the right JSON shape for a valid request" → you can fake the database.
- Testing "does my SQL query actually return the rows I expect, including edge cases like duplicate keys" → you need something DB-like, real or in-memory.

A common, practical middle ground: run your real application code against an **in-memory or throwaway version** of your dependency (an in-memory SQLite DB instead of production Postgres, a fake in-memory store instead of Redis) — real enough to catch real bugs, fast enough to run on every commit.

## Mocking — the concept, and where people get it wrong

**Mocking** means replacing a real dependency (a DB call, an external API, the current time, a payment gateway) with a fake stand-in you control, so your test is fast, deterministic, and doesn't actually hit a real network or database.

### Python: `unittest.mock` (works fine inside pytest)

```python
# payment_service.py
def charge_card(gateway, amount):
    result = gateway.charge(amount)
    if not result["success"]:
        raise PaymentError("charge failed")
    return result["transaction_id"]
```

```python
# test_payment_service.py
from unittest.mock import Mock
from payment_service import charge_card, PaymentError
import pytest

def test_charge_card_success():
    fake_gateway = Mock()
    fake_gateway.charge.return_value = {"success": True, "transaction_id": "tx_123"}

    result = charge_card(fake_gateway, 100)

    assert result == "tx_123"
    fake_gateway.charge.assert_called_once_with(100)  # verify HOW it was called too

def test_charge_card_failure_raises():
    fake_gateway = Mock()
    fake_gateway.charge.return_value = {"success": False}

    with pytest.raises(PaymentError):
        charge_card(fake_gateway, 100)
```

Note the second assertion in the first test — `assert_called_once_with(100)`. A good mock-based test checks both the **return value** you got back AND that your code called the dependency **correctly** (right arguments, right number of times). Only checking the output can miss bugs like calling `charge()` twice by accident.

### Node.js: Jest's built-in mocking

```javascript
// paymentService.js
function chargeCard(gateway, amount) {
  const result = gateway.charge(amount);
  if (!result.success) {
    throw new Error('charge failed');
  }
  return result.transactionId;
}
module.exports = { chargeCard };
```

```javascript
// paymentService.test.js
const { chargeCard } = require('./paymentService');

test('charges card successfully', () => {
  const fakeGateway = {
    charge: jest.fn().mockReturnValue({ success: true, transactionId: 'tx_123' }),
  };

  const result = chargeCard(fakeGateway, 100);

  expect(result).toBe('tx_123');
  expect(fakeGateway.charge).toHaveBeenCalledWith(100);
});

test('throws on failed charge', () => {
  const fakeGateway = {
    charge: jest.fn().mockReturnValue({ success: false }),
  };

  expect(() => chargeCard(fakeGateway, 100)).toThrow('charge failed');
});
```

`jest.fn()` creates a mock function; `.mockReturnValue()` sets what it returns; `.toHaveBeenCalledWith()` verifies how it was called — directly parallel to Python's `Mock()` + `.return_value` + `.assert_called_once_with()`.

### The mocking trap to avoid: mocking too much

If you mock every single dependency in every test, you end up "testing your mocks" — proving that your fake objects behave the way you told them to, which tells you nothing about whether the real system works. Mock the **boundary** of what you don't control (external APIs, the real database, the current time, randomness) — don't mock your own internal functions just to isolate a test; that usually means the function is doing too much and should be split up instead.

## Test doubles — the vocabulary, briefly

You'll hear these terms; they're all "fake dependency" but with different intent:
- **Mock** — records how it was called, so you can assert on that ("was `charge` called with 100?").
- **Stub** — just returns canned data, no assertion on how it was called.
- **Fake** — a lightweight working implementation (e.g., an in-memory dict standing in for a database) — more realistic than a mock/stub, still not the real thing.

In practice, most people say "mock" for all three loosely — the distinction matters more in interviews than in daily practice, but knowing it signals you understand *why* you're faking something, not just that you are.

## Coverage — a useful signal, a bad target

**Test coverage** = the percentage of your code's lines/branches that get executed by your test suite.

```bash
# Python
pip install pytest-cov
pytest --cov=. --cov-report=term-missing

# Node
npm install --save-dev jest   # coverage is built in
npx jest --coverage
```

**The trap:** chasing a coverage number (e.g., "we need 90%") leads to people writing tests that execute code without actually asserting anything meaningful, just to make the number go up. High coverage with weak assertions is worse than it looks — it gives false confidence.

**How to actually use coverage:** as a **gap-finder**, not a target. Run it, look at what's *not* covered, and ask "is that gap actually risky?" (untested edge case in billing logic → fix it) vs "is that gap fine?" (untested `__repr__` method → ignore it). Coverage tells you where you haven't looked; it doesn't tell you your tests are good.

## Test structure at scale — fixtures, setup/teardown, isolation

As a suite grows, two problems show up if you're not deliberate:

1. **Tests leaking state into each other** — Test A creates a database row, forgets to clean it up, Test B fails because it wasn't expecting that row to exist. Every test should be independent and runnable in any order or in isolation.
2. **Duplicated setup everywhere** — every test manually building the same fake object. Push shared setup into fixtures (pytest) or `beforeEach` (Jest), scoped as narrowly as makes sense.

```python
# pytest: fixture with cleanup via yield
@pytest.fixture
def db_connection():
    conn = create_test_db_connection()
    yield conn                  # test runs here
    conn.rollback()             # runs after the test, even if it failed
    conn.close()
```

```javascript
// Jest: afterEach for cleanup
let dbConnection;

beforeEach(() => {
  dbConnection = createTestDbConnection();
});

afterEach(() => {
  dbConnection.rollback();
  dbConnection.close();
});
```

Rule of thumb: if a test's outcome depends on the order tests run in, something's wrong with isolation — fix the setup/teardown, don't just reorder tests to make it pass.

## Wiring tests into CI — why this is the point of all of this

Tests sitting on your laptop that you remember to run manually provide much less value than tests that run **automatically on every push**, blocking a merge if they fail. This is the step that turns "I have tests" into "my team can't accidentally ship a regression."

Minimal GitHub Actions example (works for either stack, adjust the run command):

```yaml
# .github/workflows/test.yml
name: Run tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: pip install -r requirements.txt
      - run: pytest
```

```yaml
# node equivalent
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install
      - run: npm test
```

Once this exists, "did I break anything" gets answered automatically on every pull request, visible to the whole team — not something anyone has to remember to check.

## What to actually say in an interview about testing

Given you haven't personally written tests day-to-day (dedicated QA covers that at your company), the honest and credible framing is:
- You understand the **testing pyramid** and where backend-owned tests (unit + integration) fit vs QA-owned tests (E2E/functional).
- You know how to **mock external dependencies** and why (speed, determinism, not hitting real systems in tests).
- You understand **coverage as a signal, not a target**.
- If asked "have you written tests" — answer honestly: your team has dedicated QA for functional testing, but you understand and can write unit/integration tests, and you're comfortable being evaluated on that live if needed.

This is a stronger answer than pretending you've been writing tests all along — interviewers can tell the difference in about one follow-up question, and "I understand the discipline and can apply it, even though it wasn't my primary responsibility" is a completely normal, defensible position for a backend engineer at 3 years.

## Summary — the production/interview checklist

- [ ] Know the pyramid: unit (you own it) → integration (you own it) → E2E (usually QA)
- [ ] Can write a unit test with proper Arrange/Act/Assert structure, in both pytest and Jest
- [ ] Can mock an external dependency and assert both the return value AND the call arguments
- [ ] Know the difference between mock/stub/fake conceptually, even if you use "mock" loosely day to day
- [ ] Understand coverage as a gap-finder, not a scoreboard
- [ ] Understand why tests belong in CI, not just on a local machine
- [ ] Can honestly and confidently explain your team's QA split without it sounding like an excuse

Next: `hands-on.md` — a small orders API, built and tested in **both** Python (pytest) and Node.js (Jest), side by side, covering unit tests, mocked integration tests, and a CI config for both.
