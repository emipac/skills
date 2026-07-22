import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { auditSrs } from '../skills/srs-modeling/scripts/audit-srs.mjs';

const validSrs = `# Example SRS

## 1. Document Control

| Field | Value |
| --- | --- |
| Status | Draft |

## 2. Purpose and Scope

Example scope.

## 3. Product Context

Example context.

## 4. Domain Concepts and Actors

See the configured glossary.

## 5. Architecture Constraints and Decisions

See ADR-001.

## 6. Functional Requirements

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| FR-AUTH-001 | Members can sign in with verified credentials. | Must | Approved |
| FR-AUTH-002 | Members can sign out from every active session. | Must | Approved |

## 7. Non-functional Requirements

| ID | Requirement | Measure | Status |
| --- | --- | --- | --- |
| NFR-SEC-001 | Authentication attempts are rate limited. | Five attempts per minute. | Approved |

## 8. Safeguards

| ID | Protects | Constraint | Violation response |
| --- | --- | --- | --- |
| SG-AUTH-001 | FR-AUTH-001, NFR-SEC-001 | Authentication never bypasses verification. | Deny access and audit. |

## 9. Scenarios and Use Cases

Verified member signs in.

## 10. Risks

| ID | Risk | Impact | Mitigation | Status |
| --- | --- | --- | --- | --- |
| RISK-001 | Credential stuffing | High | Rate limiting | Mitigated |

## 11. Open Questions

| ID | Question | Blocks | Status | Resolution |
| --- | --- | --- | --- | --- |
| Q-001 | Which session duration is required? | FR-AUTH-002 | Open | — |

## 12. Acceptance Criteria

| ID | Requirement IDs | Criterion | Evidence seam |
| --- | --- | --- | --- |
| AC-AUTH-001 | FR-AUTH-001, NFR-SEC-001 | Invalid credentials cannot establish a session. | Authentication feature test |
| AC-AUTH-002 | FR-AUTH-002 | Signing out revokes every active session. | Session feature test |

## 13. Traceability and Readiness

Acceptance criteria are the canonical requirement-to-evidence mapping.

## 14. Out of Scope

Social login.
`;

test('audits a complete SRS and keeps unresolved questions visible', () => {
  const result = auditSrs(validSrs);

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.metrics.requirements, 3);
  assert.equal(result.metrics.acceptanceCriteria, 2);
  assert.equal(result.metrics.safeguards, 1);
  assert.equal(result.metrics.risks, 1);
  assert.equal(result.metrics.openQuestions, 1);
  assert.deepEqual(result.metrics.uncoveredRequirements, []);
  assert.deepEqual(result.metrics.unresolvedOpenQuestions, ['Q-001']);
  assert.ok(result.warnings.some((warning) => warning.code === 'open-question'));
});

test('reports duplicate IDs, unknown references, and missing acceptance coverage', () => {
  const invalidSrs = validSrs
    .replace(
      '| FR-AUTH-002 | Members can sign out from every active session. | Must | Approved |',
      '| FR-AUTH-001 | Members can sign out from every active session. | Must | Approved |',
    )
    .replace(
      '| AC-AUTH-001 | FR-AUTH-001, NFR-SEC-001 | Invalid credentials cannot establish a session. | Authentication feature test |',
      '| AC-AUTH-001 | FR-AUTH-001 | Invalid credentials cannot establish a session. | Authentication feature test |',
    )
    .replace(
      '| AC-AUTH-002 | FR-AUTH-002 | Signing out revokes every active session. | Session feature test |',
      '| AC-AUTH-002 | FR-UNKNOWN-999 | Signing out revokes every active session. | Session feature test |',
    );

  const result = auditSrs(invalidSrs);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'duplicate-id'));
  assert.ok(result.errors.some((error) => error.code === 'unknown-requirement-reference'));
  assert.ok(result.errors.some((error) => error.code === 'missing-acceptance-coverage'));
  assert.deepEqual(result.metrics.uncoveredRequirements, ['NFR-SEC-001']);
});

test('reports required sections and invalid stable identifiers', () => {
  const invalidSrs = validSrs
    .replace('## 8. Safeguards', '## Removed Safeguards')
    .replace('FR-AUTH-001', 'FR-auth-1');

  const result = auditSrs(invalidSrs);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'missing-section'));
  assert.ok(result.errors.some((error) => error.code === 'invalid-id'));
});

test('requires every acceptance criterion and safeguard to reference a requirement', () => {
  const invalidSrs = validSrs
    .replace('FR-AUTH-001, NFR-SEC-001 | Invalid credentials', '— | Invalid credentials')
    .replace('FR-AUTH-001, NFR-SEC-001 | Authentication never', '— | Authentication never');
  const result = auditSrs(invalidSrs);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => (
    error.code === 'missing-requirement-reference'
    && error.message.startsWith('AC-AUTH-001')
  )));
  assert.ok(result.errors.some((error) => (
    error.code === 'missing-requirement-reference'
    && error.message.startsWith('SG-AUTH-001')
  )));
});

test('rejects an SRS without functional requirements', () => {
  const invalidSrs = validSrs
    .replace('| FR-AUTH-001 | Members can sign in with verified credentials. | Must | Approved |\n', '')
    .replace('| FR-AUTH-002 | Members can sign out from every active session. | Must | Approved |\n', '');
  const result = auditSrs(invalidSrs);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => (
    error.code === 'empty-required-table'
    && error.message.startsWith('Functional Requirements')
  )));
});

test('CLI exits non-zero for an invalid SRS and returns JSON', async (context) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'srs-modeling-'));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const srsPath = path.join(temporaryRoot, 'srs.md');
  await writeFile(srsPath, validSrs.replace('## 10. Risks', '## Removed Risks'));

  const result = spawnSync(
    process.execPath,
    [
      path.resolve('skills/srs-modeling/scripts/audit-srs.mjs'),
      srsPath,
      '--json',
    ],
    { encoding: 'utf8' },
  );

  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  assert.doesNotThrow(() => JSON.parse(result.stdout));
  assert.equal(JSON.parse(result.stdout).valid, false);
  assert.equal(await readFile(srsPath, 'utf8'), validSrs.replace('## 10. Risks', '## Removed Risks'));
});

test('the reusable template satisfies the structural contract', async () => {
  const template = await readFile(
    new URL('../skills/srs-modeling/references/srs-template.md', import.meta.url),
    'utf8',
  );
  const result = auditSrs(template);

  assert.deepEqual(
    [...new Set(result.errors.map((error) => error.code))],
    ['unresolved-placeholder'],
  );
  assert.equal(result.metrics.requirements, 2);
  assert.equal(result.metrics.acceptanceCriteria, 1);
  assert.deepEqual(result.metrics.uncoveredRequirements, []);
});

test('retired requirement IDs remain stable without requiring active coverage', () => {
  const retiredSrs = validSrs
    .replace(
      '| FR-AUTH-002 | Members can sign out from every active session. | Must | Approved |',
      '| FR-AUTH-002 | Retired; replaced by FR-AUTH-003. | Must | Retired |',
    )
    .replace(
      '| AC-AUTH-002 | FR-AUTH-002 | Signing out revokes every active session. | Session feature test |\n',
      '',
    );
  const result = auditSrs(retiredSrs);

  assert.equal(result.valid, true);
  assert.deepEqual(result.metrics.uncoveredRequirements, []);
});

test('declares creation, refinement, and audit evaluation cases', async () => {
  const evaluations = JSON.parse(await readFile(
    new URL('../skills/srs-modeling/evals/cases.json', import.meta.url),
    'utf8',
  ));

  assert.deepEqual(
    evaluations.cases.map((evaluation) => evaluation.mode).sort(),
    ['audit', 'create', 'refine'],
  );

  for (const evaluation of evaluations.cases) {
    assert.ok(evaluation.prompt);
    assert.ok(evaluation.assertions.length >= 3);
  }
});
