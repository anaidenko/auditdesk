# Code quality and tests

Tests are read, not run, and no coverage is measured. Report which modules carry the product's
risk and whether tests check them, and code-level patterns that cause bugs. Style and naming
are out of scope; what a linter would catch is a finding only when the project runs no linter.

Severity: high only with a concrete defect that a test would have caught, in code that handles
money, authentication or users' data. Medium for such code with no tests, duplicated logic that
has already drifted, type checking switched off where data enters, tests that cannot fail. Low
for dead code, missing tooling and small inconsistencies.

## QUA-01 Type safety

`strict` off in `tsconfig.json`; `any` and `as` casts where data enters (API responses, request
bodies, `JSON.parse`, storage); clusters of `@ts-ignore` or `@ts-expect-error`; JavaScript files
left in a TypeScript project.

## QUA-02 Tests: what exists and what it checks

The test layout (unit, integration, end-to-end) and which critical modules (authentication,
payments, permissions, data writes) have tests. Tests that assert nothing or only a snapshot,
skipped or focused tests (`it.skip`, `xit`, `fdescribe`, `test.only`), tests that call live
services, mocks so deep that the code under test never runs.

## QUA-03 Duplication and drift

One rule implemented in several places (validation on the client and the server that differ, a
price computed twice), copy-pasted modules that have since diverged.

## QUA-04 Dead and unfinished code

Unused files and exports, commented-out code, `TODO` and `FIXME` on critical paths, feature
flags that are always on or off, stubs that return success without doing the work.

## QUA-05 Hotspots

Very long functions and components, deep nesting, boolean parameters that switch behaviour,
magic numbers in business rules: only where they make a bug likely, and with the file.

## QUA-06 Tooling and CI

A linter and a formatter configured and run (ESLint, Prettier), a type check in CI, a CI
pipeline that runs the tests on every change (`.github/workflows`, GitLab CI, Bitbucket
Pipelines), pre-commit hooks.

## QUA-07 Error-prone patterns

`==`, mutation of shared objects or props, dates computed in local time, money computed in
floating point, the result of `find` or a lookup used without a null check. Floating promises
belong to ARC-03, and how money is stored to DAT-01.
