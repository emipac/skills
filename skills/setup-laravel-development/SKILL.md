---
name: setup-laravel-development
description: Set up a fresh Laravel application with a locked Pest 5, Pint, PAO, Larastan, Rector, Ray, browser-testing, and Laravel Boost development toolchain. Use when establishing or refreshing deterministic PHP quality checks in a new Laravel project.
---

# Setup Laravel Development

Build one locked quality gate around a fresh Laravel application. Preserve
existing project conventions and configuration; add only the missing contract.

## Process

### 1. Prove compatibility

Read `composer.json`, `composer.lock`, `package.json`, the JavaScript lockfile,
`phpunit.xml`, `tests/Pest.php`, `phpstan.neon*`, `rector.php`, `pint.json`, and
`.gitignore` when present. Inspect applicable repository instructions before
changing files.

Verify current package requirements against primary documentation and Composer
metadata. The requested Pest 5 stack requires:

- PHP 8.4 or newer;
- Laravel 13.23 or newer because `pestphp/pest-plugin-laravel:^5.0` requires it;
- the `sockets` PHP extension for `pestphp/pest-plugin-browser`;
- Composer, Node.js, and npm.

Stop with the exact incompatible requirement when a gate fails. Keep the
requested major versions intact instead of resolving the failure with platform
requirement bypasses or package downgrades.

Completion criterion: the Laravel application, PHP runtime, extension set, and
package managers satisfy every requested package before dependency files change.

### 2. Install every non-Boost dependency atomically

Allow Pest's Composer plugin:

```bash
composer config allow-plugins.pestphp/pest-plugin true
```

When `phpunit/phpunit` is a direct development requirement, remove that root
requirement with `--no-update`; Pest owns the compatible PHPUnit version. Then
run one non-interactive transaction:

```bash
composer require --dev --with-all-dependencies --no-interaction \
  laravel/pint \
  laravel/pao \
  "pestphp/pest:^5.0" \
  "pestphp/pest-plugin-agent:^5.0" \
  "pestphp/pest-plugin-browser:^5.0" \
  "pestphp/pest-plugin-evals:^5.0" \
  "pestphp/pest-plugin-laravel:^5.0" \
  "pestphp/pest-plugin-phpstan:^5.0" \
  "pestphp/pest-plugin-rector:^5.0" \
  larastan/larastan \
  rector/rector \
  spatie/laravel-ray
```

The explicit Pest constraints select the latest compatible 5.x releases. The
unversioned requirements let Composer record constraints for the latest stable,
project-compatible releases. `rector/rector` is required separately by Pest's
Rector integration. PAO, Pint, and Laravel Ray require no generated configuration.

Completion criterion: every listed package is a direct development dependency,
every Pest package resolves to 5.x, and `composer.lock` records one conflict-free
stable graph.

### 3. Initialize Pest and browser support

Run `./vendor/bin/pest --init` only when `tests/Pest.php` is absent. Preserve an
existing Pest configuration and PHPUnit XML. PHPUnit-style tests may remain;
Pest executes them while new tests use Pest syntax.

Install the browser runtime exactly as Pest documents:

```bash
npm install --save-dev playwright@latest
npx playwright install
```

Add `tests/Browser/Screenshots/` to `.gitignore` once. Installing the Evals
plugin is sufficient for deterministic eval assertions. Add an AI driver and
credentials only when the project separately requires model-backed evals.

Completion criterion: Pest has a project configuration, Playwright is locked in
the JavaScript dependency graph, browser binaries are installed, and generated
screenshots are ignored.

### 4. Configure one quality gate

When no PHPStan configuration exists, create `phpstan.neon.dist`:

```neon
includes:
    - vendor/larastan/larastan/extension.neon
    - vendor/nesbot/carbon/extension.neon
    - vendor/pestphp/pest-plugin-phpstan/extension.neon

parameters:
    paths:
        - app
        - bootstrap
        - config
        - database
        - routes
        - tests
    level: 5

    parseModelCastsMethod: true

    ignoreErrors:
        -
            message: '#Call to an undefined method Illuminate\\Database\\Eloquent\\Builder.*::activeForSelection\(\)#'
            identifier: method.notFound

        -
            identifier: return.type
            path: app/Domain/Worksheet/Filament/Resources/WorksheetResource.php

        -
            identifier: argument.type
            path: app/Domain/Worksheet/Filament/Resources/WorksheetResource.php

```

When a PHPStan configuration already exists, preserve its paths, level,
exclusions, and ignores while adding each missing extension and relevant source
path. Treat a new baseline as an explicit technical-debt decision requiring user
approval.

When no Rector configuration exists, create `rector.php`:

```php
<?php

use Pest\Rector\Set\PestSetList;
use Rector\Config\RectorConfig;
use RectorLaravel\Set\LaravelSetList;

return RectorConfig::configure()
    ->withPaths([
        __DIR__.'/app',
        __DIR__.'/bootstrap',
        __DIR__.'/config',
        __DIR__.'/database',
        __DIR__.'/routes',
        __DIR__.'/tests',
    ])
    ->withPhpSets()
    ->withSets([
        LaravelSetList::LARAVEL_CODE_QUALITY,
        LaravelSetList::LARAVEL_COLLECTION,
        PestSetList::CODING_STYLE,
    ])
    ->withTypeCoverageLevel(0)
    ->withDeadCodeLevel(0)
    ->withCodeQualityLevel(0);
```

When `rector.php` already exists, preserve its rules and skips while adding the
missing application paths, PHP sets, and Pest coding-style set.

Preserve equivalent Composer scripts. Add these names when missing; pause for
the user when an existing name has different semantics:

```json
{
  "scripts": {
    "lint": "pint --parallel",
    "lint:check": "pint --parallel --test",
    "analyse": "phpstan analyse --memory-limit=2G",
    "refactor": "rector process",
    "refactor:check": "rector process --dry-run",
    "quality": [
      "@php artisan config:clear --ansi",
      "@lint:check",
      "@refactor:check",
      "@analyse",
      "@php artisan test --compact"
    ]
  }
}
```

Completion criterion: Pint, Rector, Larastan, Pest-aware PHPStan, and the test
suite are all reachable through stable Composer script names without replacing
project-specific behavior.

### 5. Close the non-Boost gate

Run:

```bash
composer validate --strict
composer run quality
./vendor/bin/pest --agent='expect(true)->toBeTrue();'
npx playwright --version
composer audit
```

Diagnose failures from pre-existing application code separately from setup
failures. Keep formatter and Rector checks in inspection mode during this gate.

Completion criterion: Composer metadata is valid, the quality script is green,
the Pest agent probe passes, Playwright is callable, and the dependency audit
has no unresolved advisory.

### 6. Install Laravel Boost last and hand off

Make Laravel Boost the final Composer mutation:

```bash
composer require --dev --with-all-dependencies --no-interaction laravel/boost
```

Verify the locked dependency, rerun `composer validate --strict`,
`composer audit`, and `composer run quality`, then stop. Never execute the
interactive installer. Tell the user to run this command themselves:

```bash
php artisan boost:install
```

Also tell them to select `pestphp/pest-plugin-agent` when Boost offers
third-party AI guidelines and skills.

Completion criterion: Boost is the last locked Composer dependency, all checks
remain green, and the final report marks `boost:install` as the user's pending
interactive action.
