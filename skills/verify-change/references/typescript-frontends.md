# TypeScript frontend verification profiles

React and Svelte use the package manager proved by the project lockfile. Apply
only commands recorded by setup:

1. Focused unit or component evidence from the delivery contract.
2. Formatter and linter.
3. Type checking.
4. Affected component or frontend tests.
5. Production build for frontend changes.
6. Playwright or configured E2E coverage for affected user workflows.
7. The configured broad frontend test suite.

Livewire uses the Laravel profile for PHP behavior and adds browser evidence
when the changed component affects visible interaction. A successful build does
not replace behavior tests, and an E2E pass does not replace type checking.
