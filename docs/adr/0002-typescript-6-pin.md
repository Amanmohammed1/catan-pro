# ADR 0002 — Pin TypeScript 6.0.3 rather than the current 7.0.2

- **Status:** accepted
- **Date:** 2026-09-12
- **Milestone:** M0

## Context

CLAUDE.md requires checking current package versions rather than trusting
training data, and golden rule 1 says the ESLint boundary rule that keeps
`packages/engine` pure must never be disabled.

At the time of writing, the npm registry reports:

| Package           | Latest  | Relevant constraint                         |
| ----------------- | ------- | ------------------------------------------- |
| typescript        | 7.0.2   | —                                           |
| typescript-eslint | 8.70.0  | peer `typescript >=4.8.4 <6.1.0`            |
| eslint            | 10.10.0 | typescript-eslint 8.70.0 supports `^10.0.0` |

TypeScript 7.0.2 falls outside the range typescript-eslint 8.70.0 supports. The
newest release inside that range is 6.0.3. There is no newer typescript-eslint:
8.70.0 is `latest`, and the only thing beyond it is a canary.

## Decision

Pin `typescript` at 6.0.3.

## Consequences

Taking 7.0.2 instead would mean dropping typescript-eslint, which would cost:

- all type-aware lint rules
- the TypeScript import resolver that `eslint-plugin-boundaries` relies on to
  resolve workspace imports

That second point is the decisive one. Without reliable resolution the purity
boundary degrades quietly rather than failing loudly, which is the failure mode
golden rule 1 exists to prevent. A newer compiler is not worth an unenforced
architectural constraint.

## Revisit when

typescript-eslint ships TypeScript 7 support. At that point bump both together
and re-run `pnpm verify:boundary`, which asserts the guard still reports every
violation type.
