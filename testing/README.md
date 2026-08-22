# Testing

The discipline of writing automated checks that verify your code works — and keeps working — without a human needing to click through the app every time something changes. Covers what a backend engineer is typically expected to own (unit + integration tests) versus what's usually dedicated QA territory (functional/E2E).

| File | Contents |
|---|---|
| [`basic.md`](./basic.md) | The testing pyramid, what "minimum" actually means for a backend role, and pytest + Jest fundamentals side by side (fixtures, parametrize, assertions). |
| [`advanced.md`](./advanced.md) | Integration testing, mocking done properly (and where people overdo it), coverage as a signal not a target, test isolation at scale, and wiring tests into CI. |
| [`hands-on.md`](./hands-on.md) | A small orders service (`hands-on-project/`), implemented and tested twice — once in Python/pytest, once in Node/Jest — with unit tests, integration tests, and a working CI config for both. |

## How to use this

- New to testing entirely? Start with `basic.md` — it also answers "what's the minimum I actually need to know" if your role has dedicated QA covering functional testing.
- Know the basics, want to actually make tests trustworthy at a team level? Read `advanced.md`.
- Want to see it work instead of just reading about it? Follow `hands-on.md` — run the same test suite in both Python and Node, side by side, and break things on purpose to see what each layer catches.
