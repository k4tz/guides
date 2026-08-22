# Testing — Hands-On: Orders Service (Python + Node, side by side)

A small orders service — create an order, apply a discount, look it up, cancel it — implemented and tested **twice**: once in Python (pytest), once in Node.js (Jest). Same logic, same test cases, same structure. The point isn't the app (it's deliberately trivial) — it's seeing unit tests and integration tests done properly in both stacks you actually use, so the concepts stop being abstract.

## What's in each stack's folder

```
hands-on-project/
├── python-api/
│   ├── order_service.py         # the logic under test
│   ├── fake_store.py            # in-memory fake "database"
│   ├── requirements.txt
│   └── tests/
│       ├── test_order_service_unit.py         # store is a Mock
│       └── test_order_service_integration.py  # store is the real FakeOrderStore
├── node-api/
│   ├── orderService.js          # identical logic, JS syntax
│   ├── fakeStore.js
│   ├── package.json
│   └── tests/
│       ├── orderService.unit.test.js
│       └── orderService.integration.test.js
└── .github/workflows/test.yml   # CI running both suites on every push
```

Open `order_service.py` and `orderService.js` side by side — they're intentionally written to mirror each other line for line. Same for the two unit test files, and the two integration test files. This 1:1 mapping is the fastest way to internalize "oh, this pytest thing IS that Jest thing, just spelled differently."

## Step 1 — Run the Python suite

```bash
cd python-api
pip install -r requirements.txt
pytest -v
```

You should see 16 tests pass — 12 unit tests, 4 integration tests. Now run with coverage:

```bash
pytest --cov=. --cov-report=term-missing
```

You'll see 100% coverage on both `order_service.py` and `fake_store.py`. That's a deliberately achievable target for a service this small — don't expect 100% to be the norm on a real production codebase (see `advanced.md`'s note on coverage as a signal, not a target).

## Step 2 — Run the Node suite

```bash
cd ../node-api
npm install
npm test
```

Same 16 tests, same split (12 unit, 4 integration). With coverage:

```bash
npm test -- --coverage
```

Same 100% result. Compare the terminal output style between the two — pytest's dot/verbose output vs Jest's `describe`-nested checkmarks are the two most common formats you'll see in the wild.

## Step 3 — Read the unit tests, understand what's mocked and why

Open `test_order_service_unit.py` (or the Jest equivalent). Every test creates a `Mock()` / `jest.fn()`-based fake store — the service under test never touches anything real. This is why these tests run in single-digit milliseconds: there's no I/O at all.

Look specifically at `test_create_order_saves_to_store` (Python) / `'saves the created order to the store'` (Jest):

```python
store.save.assert_called_once()
saved_order = store.save.call_args[0][0]
assert saved_order["order_id"] == "order_1"
```

This isn't just checking the return value — it's checking that the service called its dependency *correctly*. This is the pattern from `advanced.md`: a good mock-based test verifies both what came back and how the dependency was used.

## Step 4 — Read the integration tests, understand what's different

Open `test_order_service_integration.py`. Notice the fixture:

```python
@pytest.fixture
def service():
    store = FakeOrderStore()
    return OrderService(store)
```

No mocking here — `FakeOrderStore` is a real, working (if tiny) implementation. `test_create_then_get_order_round_trip` genuinely creates an order, then genuinely fetches it back through the same store — proving the save/get contract actually holds, which a unit test with a Mock literally cannot prove (a Mock just returns whatever you told it to return).

This is the distinction from `basic.md`'s pyramid made concrete: the unit tests prove the *math and validation logic* is correct; the integration tests prove the *service and its data layer* genuinely agree on what an order looks like.

## Step 5 — Break something on purpose

A few exercises, each teaching something specific:

- **Break the discount calculation.** In `order_service.py`, change `1 - discount_percent / 100` to `1 + discount_percent / 100` (a deliberate bug). Run the unit tests — several should fail immediately, pointing you straight at the broken line. This is the entire value proposition of unit tests: instant, precise feedback.
- **Break only the integration path.** In `fake_store.py`, change `save()` so it doesn't copy the dict (`self._data[order["order_id"]] = order` instead of `dict(order)`). Run both suites — unit tests still pass (they don't touch the real store), but watch the integration tests carefully for subtler aliasing bugs this could cause if the caller mutates the object after saving. This demonstrates why relying on unit tests alone isn't enough — some bugs only show up when components interact for real.
- **Add a new rule** — e.g., "an order over $10,000 requires manual approval, `status` should be `pending_approval` instead of `created`." Write the unit test for it *first* (it'll fail, since the behavior doesn't exist yet), then implement it, then watch the test pass. This is a taste of test-driven development (TDD) — not required for this guide, but worth experiencing once so the idea isn't foreign later.

## Step 6 — Check the CI config

Open `.github/workflows/test.yml`. It runs both suites — Python and Node — as separate parallel jobs, on every push and pull request. If you push this to an actual GitHub repo, you'll see both jobs run automatically and block a PR from merging if either suite fails.

This is the step that makes tests actually matter at a team level: nobody has to remember to run `pytest` or `npm test` before merging — it happens automatically, visibly, every time.

## What you actually just practiced

- The testing pyramid made concrete: unit tests (fully mocked, milliseconds, pinpoint failures) vs integration tests (real component interaction, catches a different class of bug)
- Writing and reading tests in both pytest and Jest, with a direct side-by-side mapping between the two
- Mocking a dependency properly — asserting both the return value and how it was called
- Using an in-memory fake to write meaningful integration tests without needing a real database
- Reading a coverage report and understanding what 100% does and doesn't tell you
- Wiring both suites into CI so tests run automatically, for both stacks, on every push

This is genuinely the minimum bar described in `basic.md` — unit + integration, both stacks, in CI. Nothing here required touching E2E/functional testing, which stays exactly where it already is at your company: with dedicated QA.
