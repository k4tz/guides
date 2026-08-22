# Testing — Basics

Why testing matters, the core mental model (the testing pyramid), and enough pytest + Jest to write your first real tests in both stacks you use day to day.

## Why this exists as a discipline at all

Without automated tests, "does this work" only gets answered by a human clicking through the app (or worse, by production breaking). Tests answer that question in milliseconds, every time you change code, without needing a person to notice. That's the entire value proposition — they're a cheap, repeatable way to catch "I broke something" before a user does.

The natural objection: "but I test manually as I build it." True, but manual testing only proves the code works *right now, in the case you happened to try*. It doesn't re-verify anything six months later when someone else (or future-you) touches that code and doesn't remember every edge case you originally checked. Automated tests are that memory, executable.

## The testing pyramid — the one mental model that matters

```
        /\
       /  \      E2E / Functional tests  (few, slow, expensive)
      /----\
     /      \    Integration tests        (some, moderate speed)
    /--------\
   /          \  Unit tests               (many, fast, cheap)
  /------------\
```

- **Unit tests** — test one function/method in complete isolation. Every external dependency (database, network call, other service) is faked/mocked. Fast (milliseconds), cheap to write, pinpoint exactly what broke.
- **Integration tests** — test that multiple pieces work together correctly (e.g., your API endpoint actually talks to a real — or realistically fake — database and gets the right data back). Slower, but catches bugs unit tests can't (e.g., a query that's syntactically fine but returns the wrong rows).
- **E2E / functional tests** — test a full user flow through the real, running system (browser clicking through a UI, or a full HTTP request hitting a real deployed API). Slowest, most brittle, closest to "does the whole product actually work." This is usually QA/tester territory — which is exactly why you haven't needed to touch it.

**As a backend engineer, your job is the bottom two layers.** Unit tests for your business logic, integration tests for "does my code correctly talk to the DB/external services." You are not usually expected to own E2E — that's what dedicated QA does, and it's a legitimately different skill set (browser automation, test environments, flow design across the whole product).

**The minimum bar for a backend role: unit tests on your logic, integration tests on your data layer.** That's it. That's "minimum" — not a euphemism, that genuinely covers what most backend interviews and most jobs expect from you specifically.

## Anatomy of a test (same shape in every framework)

Every test, regardless of language, follows the same three-part structure — often called **Arrange, Act, Assert**:

```python
def test_discount_applied_correctly():
    # Arrange — set up the input/state you need
    order = Order(subtotal=100, discount_percent=10)

    # Act — do the thing you're testing
    total = order.calculate_total()

    # Assert — check the result is what you expect
    assert total == 90
```

If you can't cleanly separate a test into these three parts, that's usually a sign the test (or the code under test) is trying to do too much at once.

## Python: pytest

### Setup

```bash
pip install pytest
```

### Your first test

```python
# calculator.py
def add(a, b):
    return a + b
```

```python
# test_calculator.py
from calculator import add

def test_add_two_positive_numbers():
    assert add(2, 3) == 5

def test_add_negative_numbers():
    assert add(-1, -1) == -2
```

Run it:
```bash
pytest
```

pytest auto-discovers any file named `test_*.py` or `*_test.py`, and any function inside prefixed `test_`. No boilerplate class or decorator needed — this is one of the reasons pytest won over Python's older built-in `unittest`.

### Fixtures — reusable setup

If multiple tests need the same setup (e.g., a test object), don't repeat it — use a fixture:

```python
import pytest

@pytest.fixture
def sample_order():
    return {"subtotal": 100, "discount_percent": 10}

def test_total_with_discount(sample_order):
    total = sample_order["subtotal"] * (1 - sample_order["discount_percent"] / 100)
    assert total == 90
```

pytest sees the fixture name as a function argument and automatically injects it — this is pytest's core mechanism and worth internalizing early, since almost every real test suite leans on fixtures heavily (for DB connections, test clients, fake data, etc.).

### Parametrize — one test, many inputs

Instead of copy-pasting near-identical tests for different inputs:

```python
import pytest

@pytest.mark.parametrize("a, b, expected", [
    (2, 3, 5),
    (-1, -1, -2),
    (0, 0, 0),
])
def test_add(a, b, expected):
    assert add(a, b) == expected
```

This runs as three separate test cases, each reported individually if it fails — much clearer than one test with three asserts.

## Node.js: Jest

### Setup

```bash
npm install --save-dev jest
```

Add to `package.json`:
```json
{
  "scripts": {
    "test": "jest"
  }
}
```

### Your first test

```javascript
// calculator.js
function add(a, b) {
  return a + b;
}
module.exports = { add };
```

```javascript
// calculator.test.js
const { add } = require('./calculator');

test('adds two positive numbers', () => {
  expect(add(2, 3)).toBe(5);
});

test('adds negative numbers', () => {
  expect(add(-1, -1)).toBe(-2);
});
```

Run it:
```bash
npm test
```

Jest auto-discovers any file named `*.test.js` (or inside a `__tests__` folder).

### `describe` blocks — grouping related tests

```javascript
describe('add()', () => {
  test('adds two positive numbers', () => {
    expect(add(2, 3)).toBe(5);
  });

  test('adds negative numbers', () => {
    expect(add(-1, -1)).toBe(-2);
  });
});
```

Purely organizational — groups related tests in output and allows shared `beforeEach`/`afterEach` scoped to the group (see below).

### `beforeEach` — Jest's answer to fixtures

```javascript
let sampleOrder;

beforeEach(() => {
  sampleOrder = { subtotal: 100, discountPercent: 10 };
});

test('calculates total with discount', () => {
  const total = sampleOrder.subtotal * (1 - sampleOrder.discountPercent / 100);
  expect(total).toBe(90);
});
```

`beforeEach` runs before every test in its scope — the direct equivalent of a pytest fixture, just structured as a lifecycle hook instead of a function argument.

### `test.each` — Jest's parametrize

```javascript
test.each([
  [2, 3, 5],
  [-1, -1, -2],
  [0, 0, 0],
])('add(%i, %i) = %i', (a, b, expected) => {
  expect(add(a, b)).toBe(expected);
});
```

## pytest vs Jest — the direct translation table

| Concept | pytest | Jest |
|---|---|---|
| Run tests | `pytest` | `npm test` / `jest` |
| Basic assertion | `assert x == y` | `expect(x).toBe(y)` |
| Test file naming | `test_*.py` | `*.test.js` |
| Reusable setup | `@pytest.fixture` | `beforeEach()` |
| Grouping tests | (just file/class structure) | `describe()` |
| Multiple inputs | `@pytest.mark.parametrize` | `test.each()` |
| Run before/after each test | fixture with `yield` | `beforeEach` / `afterEach` |
| Skip a test | `@pytest.mark.skip` | `test.skip()` |
| Run only this test | `pytest -k test_name` | `test.only()` |

Once you know one well, the other is mostly vocabulary — the underlying "arrange, act, assert" logic doesn't change.

## What "good enough" unit test coverage looks like day to day

You don't need to test every single line. Prioritize:
1. **Business logic with branches** — anything with an `if/else`, a calculation, a validation rule. This is where bugs actually hide.
2. **Edge cases** — empty input, zero, negative numbers, missing optional fields, the boundary of a range check.
3. **Things that have broken before** — if a bug slipped through, write a test that would have caught it, so it can't silently regress.

You generally don't need to unit-test: framework boilerplate, simple getters/passthroughs with no logic, or third-party library internals (trust the library, test *your* usage of it if it's non-trivial).

## Next

`advanced.md` covers integration testing (testing your API + data layer together), mocking external dependencies properly, test fixtures/setup at scale, coverage tooling, and wiring tests into CI so they run automatically on every push — the stuff that turns "I write tests" into "my team's tests actually catch regressions."
