# Laravel verification profile

Apply configured capabilities in this order:

1. Targeted Pest feature or unit test at the delivery-contract seam.
2. Laravel Pint for changed PHP files.
3. PHPStan or Larastan static analysis.
4. Affected feature or domain tests.
5. Smoke tests for changed routes, commands, jobs, or user workflows.
6. Browser evidence for user-visible Livewire behavior when available.
7. The configured broad Laravel test suite.

Prefer `php artisan test --compact` selectors recorded in the delivery contract.
Do not silently replace configured commands with guessed Pest, PHPUnit, or
Composer invocations. A pre-existing failure is reported separately and does
not become a pass.
