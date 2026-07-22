import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { auditFeatureSpec } from '../skills/to-spec/scripts/audit-feature-spec.mjs';
import { auditTicketSet } from '../skills/to-tickets/scripts/audit-ticket-contracts.mjs';

const srs = `# Example SRS

| FR-AUTH-001 | Members can sign in. |
| NFR-SEC-001 | Sign-in attempts are rate limited. |
| SG-AUTH-001 | Verification cannot be bypassed. |
| AC-AUTH-001 | Invalid credentials cannot establish a session. |
| AC-AUTH-002 | Valid credentials establish a session. |
`;

const featureSpec = `# Password sign-in feature contract

## Feature Contract

| Field | Value |
| --- | --- |
| Status | ready-for-tickets |
| SRS baseline | docs/specifications/srs.md |

## Problem and Outcome

Members need secure password sign-in.

## SRS Traceability

| Requirement IDs | Acceptance IDs | Safeguard IDs | Scope |
| --- | --- | --- | --- |
| FR-AUTH-001, NFR-SEC-001 | AC-AUTH-001, AC-AUTH-002 | SG-AUTH-001 | In scope |

## User Stories and Scenarios

1. As a member, I can sign in with valid credentials.
2. Invalid credentials leave the visitor signed out.

## Approach and Decisions

Use the repository's existing authentication boundary.

## Public Interfaces and Test Seams

| Seam | Behavior observed | Prior art |
| --- | --- | --- |
| Sign-in HTTP endpoint | Session establishment or rejection | Existing authentication feature tests |

## Safeguards and Prohibited Behavior

- SG-AUTH-001 remains mandatory.
- Verification and rate limiting cannot be bypassed.

## Risks, Gaps, and Assumptions

| ID | Type | Description | Blocks readiness | Resolution |
| --- | --- | --- | --- | --- |
| GAP-001 | Gap | Session duration is outside this slice. | No | Deferred to Q-001. |

## Acceptance Criteria

| ID | Criterion | Evidence seam |
| --- | --- | --- |
| AC-AUTH-001 | Invalid credentials cannot establish a session. | Sign-in HTTP endpoint |
| AC-AUTH-002 | Valid credentials establish a session. | Sign-in HTTP endpoint |

## Verification Strategy

Targeted authentication feature tests, then configured static checks and suite.

## Out of Scope

Password reset and social login.

## Readiness

- [x] Every in-scope requirement maps to acceptance evidence.
- [x] Public test seams are agreed.
- [x] Safeguards and prohibited behavior are explicit.
- [x] Blocking gaps and assumptions are resolved.
- [x] Out-of-scope behavior is explicit.
`;

const ticket = ({
  id,
  blockedBy = 'None — can start immediately.',
  assumption = 'None.',
  outcome = 'A member can sign in with valid credentials.',
}) => `# ${id} — Deliver password sign-in

**Status:** ready-for-agent
**Parent feature spec:** Password sign-in feature contract

## Outcome

${outcome}

## SRS Traceability

- FR-AUTH-001
- NFR-SEC-001
- AC-AUTH-001
- AC-AUTH-002
- SG-AUTH-001

## Domain Concepts

Member and authenticated session.

## Approach and Tradeoffs

Use the existing authentication boundary and preserve its rate limiter.

## Architecture Boundary and Public Seam

The public seam is the sign-in HTTP endpoint.

## Safeguards and Invariants

SG-AUTH-001: verification cannot be bypassed.

## Prohibited Behavior and Non-goals

No password reset or social login.

## Acceptance Criteria

- [ ] AC-AUTH-001 is proven at the public seam.
- [ ] AC-AUTH-002 is proven at the public seam.

## Verification Matrix

| Layer | Evidence | Command or capability | Required |
| --- | --- | --- | --- |
| Feature | Authentication behavior | php artisan test --compact --filter=SignIn | Yes |
| Static | Type correctness | vendor/bin/phpstan analyse | Yes |

## Blocked By

${blockedBy}

## Unresolved Assumptions

${assumption}

## Readiness

- [x] The outcome is a complete vertical behavior.
- [x] Acceptance criteria trace to the SRS and feature spec.
- [x] The public seam and first red test are identified.
- [x] Safeguards and non-goals are explicit.
- [x] Blocking edges exist and are acyclic.
- [x] No unresolved assumption blocks the start.
- [x] The ticket fits one fresh implementation context.
`;

test('accepts a ready feature contract with complete SRS traceability', () => {
  const result = auditFeatureSpec(featureSpec, { srsContents: srs });

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.metrics.requirementIds, ['FR-AUTH-001', 'NFR-SEC-001']);
  assert.deepEqual(result.metrics.acceptanceIds, ['AC-AUTH-001', 'AC-AUTH-002']);
  assert.deepEqual(result.metrics.safeguardIds, ['SG-AUTH-001']);
});

test('rejects unknown traceability IDs and unresolved blocking gaps', () => {
  const invalidSpec = featureSpec
    .replace('FR-AUTH-001, NFR-SEC-001', 'FR-UNKNOWN-999, NFR-SEC-001')
    .replace('| No | Deferred to Q-001. |', '| Yes | Open |');
  const result = auditFeatureSpec(invalidSpec, { srsContents: srs });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'unknown-srs-reference'));
  assert.ok(result.errors.some((error) => error.code === 'blocking-gap'));
});

test('rejects empty required feature and ticket sections', () => {
  const emptyFeature = featureSpec.replace(
    '## Problem and Outcome\n\nMembers need secure password sign-in.',
    '## Problem and Outcome\n',
  );
  const emptyTicket = ticket({ id: 'TB-001', outcome: '' });

  const featureResult = auditFeatureSpec(emptyFeature, { srsContents: srs });
  const ticketResult = auditTicketSet(
    [{ id: 'TB-001', contents: emptyTicket }],
    { specContents: featureSpec },
  );

  assert.ok(featureResult.errors.some((error) => (
    error.code === 'empty-section'
    && error.message.includes('Problem and Outcome')
  )));
  assert.ok(ticketResult.errors.some((error) => (
    error.code === 'empty-section'
    && error.message.includes('Outcome')
  )));
});

test('accepts ready vertical ticket contracts with an acyclic blocker graph', () => {
  const tickets = [
    { id: 'TB-001', contents: ticket({ id: 'TB-001' }) },
    {
      id: 'TB-002',
      contents: ticket({
        id: 'TB-002',
        blockedBy: '- TB-001',
        outcome: 'A signed-in member can end the current session.',
      }),
    },
  ];
  const result = auditTicketSet(tickets, { specContents: featureSpec });

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.metrics.frontier, ['TB-001']);
});

test('rejects blocker cycles and unknown blockers', () => {
  const tickets = [
    {
      id: 'TB-001',
      contents: ticket({ id: 'TB-001', blockedBy: '- TB-002' }),
    },
    {
      id: 'TB-002',
      contents: ticket({ id: 'TB-002', blockedBy: '- TB-001\n- TB-999' }),
    },
  ];
  const result = auditTicketSet(tickets, { specContents: featureSpec });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'blocker-cycle'));
  assert.ok(result.errors.some((error) => error.code === 'unknown-blocker'));
});

test('rejects a ready ticket with an unresolved blocking assumption', () => {
  const assumption = `| ID | Assumption | Blocks start | Resolution |
| --- | --- | --- | --- |
| ASM-001 | The identity provider supports password login. | Yes | Open |`;
  const result = auditTicketSet(
    [{ id: 'TB-001', contents: ticket({ id: 'TB-001', assumption }) }],
    { specContents: featureSpec },
  );

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'blocking-assumption'));
});

test('declares feature, ticket, and implementation lifecycle evaluations', async () => {
  const evaluationPaths = [
    '../skills/to-spec/evals/cases.json',
    '../skills/to-tickets/evals/cases.json',
    '../skills/implement/evals/cases.json',
  ];

  for (const evaluationPath of evaluationPaths) {
    const evaluations = JSON.parse(await readFile(
      new URL(evaluationPath, import.meta.url),
      'utf8',
    ));

    assert.equal(evaluations.cases.length, 3);

    for (const evaluation of evaluations.cases) {
      assert.ok(evaluation.prompt);
      assert.ok(evaluation.assertions.length >= 4);
    }
  }
});

test('implementation orchestrator requires red evidence and explicit commit authority', async () => {
  const implementationSkill = await readFile(
    new URL('../skills/implement/SKILL.md', import.meta.url),
    'utf8',
  );

  assert.match(implementationSkill, /failure caused by missing behavior/);
  assert.match(implementationSkill, /Resume only after an explicit decision/);
  assert.match(
    implementationSkill,
    /Commit or push only\s+when the user explicitly requests it/,
  );
});

test('feature and ticket audit CLIs are read-only and return valid JSON', async (context) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'delivery-contracts-'));
  const ticketsRoot = path.join(temporaryRoot, 'tickets');
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  await mkdir(ticketsRoot);
  const srsPath = path.join(temporaryRoot, 'srs.md');
  const specPath = path.join(temporaryRoot, 'feature.md');
  const ticketPath = path.join(ticketsRoot, 'TB-001-sign-in.md');
  await writeFile(srsPath, srs);
  await writeFile(specPath, featureSpec);
  await writeFile(ticketPath, ticket({ id: 'TB-001' }));

  const featureResult = spawnSync(
    process.execPath,
    [
      path.resolve('skills/to-spec/scripts/audit-feature-spec.mjs'),
      specPath,
      '--srs',
      srsPath,
      '--json',
    ],
    { encoding: 'utf8' },
  );
  const ticketResult = spawnSync(
    process.execPath,
    [
      path.resolve('skills/to-tickets/scripts/audit-ticket-contracts.mjs'),
      ticketsRoot,
      '--spec',
      specPath,
    ],
    { encoding: 'utf8' },
  );

  assert.equal(featureResult.status, 0);
  assert.equal(ticketResult.status, 0);
  assert.equal(JSON.parse(featureResult.stdout).valid, true);
  assert.equal(JSON.parse(ticketResult.stdout).valid, true);
  assert.equal(await readFile(specPath, 'utf8'), featureSpec);
  assert.equal(await readFile(ticketPath, 'utf8'), ticket({ id: 'TB-001' }));
});
