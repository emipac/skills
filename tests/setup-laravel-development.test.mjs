import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('Laravel development setup keeps the requested deterministic contract', async () => {
  const skill = await readFile(
    path.join(root, 'skills', 'setup-laravel-development', 'SKILL.md'),
    'utf8',
  );
  const openai = await readFile(
    path.join(root, 'skills', 'setup-laravel-development', 'agents', 'openai.yaml'),
    'utf8',
  );
  const evaluations = JSON.parse(await readFile(
    path.join(root, 'skills', 'setup-laravel-development', 'evals', 'cases.json'),
    'utf8',
  ));

  for (const packageName of [
    'laravel/pint',
    'laravel/pao',
    'pestphp/pest:^5.0',
    'pestphp/pest-plugin-agent:^5.0',
    'pestphp/pest-plugin-browser:^5.0',
    'pestphp/pest-plugin-evals:^5.0',
    'pestphp/pest-plugin-laravel:^5.0',
    'pestphp/pest-plugin-phpstan:^5.0',
    'pestphp/pest-plugin-rector:^5.0',
    'larastan/larastan',
    'rector/rector',
    'spatie/laravel-ray',
  ]) {
    const escapedPackageName = packageName.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&',
    );

    assert.match(skill, new RegExp(escapedPackageName));
  }

  assert.match(skill, /PHP 8\.4 or newer/);
  assert.match(skill, /Laravel 13\.23 or newer/);
  assert.match(skill, /vendor\/larastan\/larastan\/extension\.neon/);
  assert.match(skill, /vendor\/pestphp\/pest-plugin-phpstan\/extension\.neon/);
  assert.match(skill, /PestSetList::CODING_STYLE/);
  assert.match(skill, /composer run quality/);
  assert.match(skill, /Install Laravel Boost last/);
  assert.match(skill, /Never execute the\s+interactive installer/i);
  assert.match(skill, /php artisan boost:install/);
  assert.match(openai, /allow_implicit_invocation: false/);
  assert.match(openai, /\$setup-laravel-development/);
  assert.equal(evaluations.cases.length, 3);
  assert.equal(
    evaluations.cases.every((evaluation) => evaluation.assertions.length >= 4),
    true,
  );
});
