# Laravel development setup skill

## Outcome

- Added the explicitly invoked `setup-laravel-development` skill for fresh
  Laravel applications using PHP 8.4 and Laravel 13.23 or newer.
- Added an atomic Pest 5 toolchain setup covering Pest's agent, browser, evals,
  Laravel, PHPStan, and Rector plugins together with Pint, PAO, Larastan,
  Rector, and Laravel Ray.
- Added deterministic PHPStan, Rector, Composer script, Playwright, and quality
  gates that preserve compatible existing project configuration.
- Made Laravel Boost the final Composer dependency and reserved the interactive
  `php artisan boost:install` command for the user.

## Verification

- Added behavioral evaluation cases for a fresh setup, a partial existing
  toolchain, and an incompatible runtime.
- Added a unit contract for the dependency list, compatibility gates,
  configuration extensions, Boost handoff, and explicit invocation policy.
- Repository validation passed for 28 released skills and 124 Markdown files.
- All 68 unit tests passed, including the focused setup-skill contract.
- The five-client installation smoke passed with the new skill included.
- `npm audit --audit-level=high` reported zero vulnerabilities, and
  `git diff --check` passed.
- Read-only forward tests passed for both compatible and incompatible target
  projects; the incompatible path stopped before mutation.
- The standalone Python validator could not run because PyYAML is absent
  (`ModuleNotFoundError: No module named 'yaml'`). The Claude CLI validator was
  unavailable because `claude` is outside the configured shell allowlist.
