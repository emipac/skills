# Handoff — Change Evaluation Gate, resume at TB-012

> **Updated 2026-08-11 (fifth pass).** TB-008 … TB-011 are now DONE and
> verified. The resume point is **TB-012**. The filename still says TB-008
> for link stability; trust this heading and the state table below.

Written 2026-08-10 by the orchestrating Tech Lead session. Read this before
touching the Gate. It records only what is NOT already in the tickets, the SRS,
or the code — everything else is referenced by path.

## Why this session stopped

The monthly API spend limit was reached. TB-007's implementation agent was
killed mid-run (its work had already landed, verified after the fact). Work was
stopped at a clean ticket boundary rather than risking a half-written slice.
Nothing is in a partial state.

## State: 11 of 15 tickets done

| Done | Open |
| --- | --- |
| TB-001 … TB-011 | TB-012 … TB-015 |

**TB-001 … TB-010 are COMMITTED** on branch `agent/change-evaluation-gate-planning`
(`07574ef` = TB-002…TB-008, `371609b` = TB-009, `eb01d11` = TB-010; not pushed).
**TB-011 is uncommitted** working-tree work.

Ticket status lines in `.scratch/change-evaluation-gate/issues/` are accurate —
trust them. TB-001 is committed (`247247d`); **TB-002 … TB-007 are uncommitted
working-tree changes.** Nothing has been committed or pushed by the orchestrating
session, per repository policy in `CLAUDE.md`.

### Verified evidence at handoff time

Re-run these to confirm you start from green. These numbers were verified
directly by the Tech Lead, not taken from agent self-reports:

| Gate | Result |
| --- | --- |
| `npm run test:unit` | **200 pass, 0 fail** (session baseline was 92) |
| `npm run validate` | OK — 29 released skills, 192 Markdown files |
| `npm run test:install` | OK — 12 skills across 5 clients |
| `npm run gate-runtime-binding-smoke` | exit 0 (added by TB-006) |
| `npm run gate-fix-smoke` | exit 0 (added by TB-007) |
| `npm run gate-evidence-prune-smoke` | exit 0 (added by TB-008) |
| `npm run gate-activation-smoke` | exit 0 (added by TB-010) |
| `npm run gate-hook-conformance-smoke` | exit 0 (added by TB-011) |

If any of these is red before you change anything, stop and investigate — it
means something drifted after this handoff was written.

## Resume order (dependency graph, already validated acyclic)

```
TB-008 ──┬─> TB-010 ─> TB-011 ─┬─> TB-012 ─┐
         │                     └─> TB-013 ─┼─> TB-015
TB-009 ──┴──────────────────────────────────┤
TB-005/006/008 ─> TB-014 ───────────────────┘
```

Concrete sequence: ~~TB-008~~ → ~~TB-009~~ → ~~TB-010~~ → ~~TB-011~~ →
**TB-012** → TB-013 → TB-014 → TB-015. **TB-012 is the correct next ticket.**
TB-012 and TB-013 are the only genuinely parallel pair, but they share
`skills/change-evaluation-gate/` and `tests/`, so this session ran everything
sequentially to avoid write collisions. Recommend keeping that.

## Two gate results you do NOT need to re-derive

1. **`audit-ticket-contracts.mjs` returns `valid: false`. This is expected noise.**

   ```bash
   node skills/to-tickets/scripts/audit-ticket-contracts.mjs .scratch/change-evaluation-gate/issues --contract .scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md
   ```

   All 377 errors come from co-located Wayfinder artifacts in the same directory
   (the feature spec plus the `decide-*`/`define-*`/`design-*`/`research-*`/`set-*`
   decision tickets), which are not delivery contracts and do not use the TB-NNN
   shape. **Zero errors reference any numbered ticket TB-001…TB-015.** Verified by
   filtering the error set. Treat the numbered-ticket gate as passing; do not
   restructure that directory to make the number go down.

2. **The verification preflight passes** (`valid: true`):

   ```bash
   node skills/verify-change/scripts/verification-plan.mjs --config .agent-framework.yaml --ticket-matrix <matrix.json> --json
   ```

   `<matrix.json>` is a JSON array of the ticket's Verification Matrix rows. The
   planner always appends the configured broad-tests rows (`npm run test:unit`,
   `npm run test:install`) — that is correct behavior, run them.

## Conventions established this session — keep following them

These were set by the Tech Lead so thirteen slices compose into one module. They
are not in any ticket; they exist only here and in the delivered code.

### Capability rows

Tickets 08, 10, 11, 12, 13, 14, 15 each have a Verification Matrix row naming a
*capability* rather than an existing command. You must materialize it:

- npm script named **exactly** the capability name, 1:1, no `test:` prefix.
  `gate-evidence-prune-smoke` → `"gate-evidence-prune-smoke": "node skills/change-evaluation-gate/scripts/<name>.mjs"`.
- Implemented as `.mjs` under `skills/change-evaluation-gate/scripts/`.
- Registered in `verification.capabilities` in `.agent-framework.yaml`.
- Non-interactive, offline, exit non-zero on failure, `--json` support.

Two reference implementations already exist and both pass — copy their shape:
`scripts/runtime-binding-smoke.mjs`, `scripts/gate-fix-smoke.mjs`.

Remaining capabilities to create: `gate-evidence-prune-smoke` (TB-008),
`gate-activation-smoke` (TB-010), `gate-hook-conformance-smoke` (TB-011),
`gate-lifecycle-smoke` (TB-012), `gate-adapter-conformance` (TB-013),
`gate-security-control-smoke` (TB-014), `gate-runtime-portability` (TB-015).

### Layout and constraints

- Gate library code: `skills/change-evaluation-gate/scripts/lib/`.
- Contract docs: `skills/change-evaluation-gate/references/`.
- Tests: `tests/<topic>.test.mjs` (picked up by `node --test tests/*.test.mjs`).
- **Node built-ins only — no runtime dependencies.** ESM `.mjs`, Node >= 20.
- Never modify `AGENTS.md` (in `protected_files`).
- Every slice adds a `docs/history/` entry (config requires it) and a
  `.changeset/` entry.
- Do not commit or push.
- **No external toolchain may become a test dependency.** TB-006 and TB-007
  established this: no Laravel Herd, PHP, Composer, Pint, Rector, or PHPStan is
  required. Fixtures inject fake commands against throwaway temp repos. Keep
  this for the desktop adapters in TB-013 — do not require Claude Code Desktop,
  Codex Desktop, or Cursor to be installed to run the suite.
- Never mutate this repository's own Git state; never run `git commit` here.
  All Git fixtures use throwaway repos under the OS temp dir.

## Delivered architecture (what TB-008 builds on)

`skills/change-evaluation-gate/scripts/lib/`:

| File | Slice | Role |
| --- | --- | --- |
| `check-descriptor.mjs`, `command-descriptor.mjs`, `gate-core.mjs`, `providers/{laravel,node-package,provider-kit}.mjs` | TB-003 | Descriptor contract v1, shell-free Command descriptors, stack-neutral core |
| `evaluate.mjs`, `evaluation-contract.mjs`, `snapshot.mjs`, `verification-seam.mjs` | TB-004 | `evaluate(request) -> decision`, snapshot materialization, `verify-change` delegation |
| `policy.mjs`, `bounded-execution.mjs` | TB-005 | Required/advisory binding, budget ledger, bypass, process-tree termination |
| `delivery-contract.mjs`, `grader-surface.mjs`, `runtime-binding.mjs` | TB-006 | `regression-only` scope, changed Grader surfaces, served-source binding |
| `fix.mjs`, `mutation.mjs` | TB-007 | Explicit `gate fix`, provider-declared `fix_order`, forced reevaluation |
| `evidence-store.mjs`, `evidence-bounds.mjs`, `redaction.mjs`, `lifecycle-event.mjs` | TB-008 | Append-only content-addressed store under the Git common dir, v1 ceilings, redaction, 11 Lifecycle event types, durable bypass ledger |
| `coordination.mjs` | TB-009 | Per-Git-common-directory lock, identical in-flight sharing, role-specific decisions, Git queue priority, subscriber-local cancellation, audited stale recovery |
| `activation.mjs` | TB-010, TB-011 | Previewed, consent-bound Activation transaction with LIFO rollback; `ACTIVATION_STEPS` ends at `git-enablement` so Git is enabled last; pinned receipt at `<store-root>/activation/receipt.json`. TB-011 added ordered hook composition (native manager → confirmed marker block → owned shim), non-interactive identity rejection, and trust pause/resume identity binding |

The Evidence ladder stage order is exported from
`skills/verify-change/scripts/verification-plan.mjs` as `evidenceLadderStages`.
**Import it; never restate the ladder** — there is a test asserting no Gate module
restates stage names (SG-OWNER-001).

### Contract fields deliberately left for later slices

`evaluate.mjs` returns these as declared-but-inert. Fill them **in place**; do
not create a parallel decision shape:

- ~~`evidence.persisted` is always `false`~~ → **DONE in TB-008**, filled in place.
- ~~Coordination: `coordination-failure` is a reason classification only~~ →
  **DONE in TB-009.** `coordination.mjs` imports `resolveGitCommonDirectory`
  from `evidence-store.mjs` (verified) so the lock key reuses TB-008's
  canonicalization — do not reimplement that resolution anywhere else.
  Coordination reports through `diagnostics` rather than a new top-level
  decision field, because `validateDecision` rejects unknown top-level fields.
- **No periodic heartbeat timer.** TB-009's heartbeat is called explicitly and
  staleness leans on process liveness. If a later slice needs a background
  heartbeat, that is new work — see `references/evaluation-coordination-contract.md`.
- **No operator-facing lock command.** Like `gate prune`, it belongs with
  **TB-012**'s lifecycle commands.
- ~~Hook composition is deliberately minimal~~ → **DONE in TB-011.** The full
  ordered strategy (native manager → confirmed marker block → owned shim) and
  pause/resume identity binding now live in `activation.mjs`. Strategy is
  carried on `ownership`; the prior chain is recorded in `receipt.hookChain`.
- **Known gap TB-012 should close:** `receipt.hookChain` records the *prior*
  chain identity but NOT the gate-written block's own content identity — the
  block embeds the receipt id, so it cannot be hashed into the receipt that
  names it. Rollback currently binds via the in-flight journal. A durable
  content identity for the written block belongs with `gate status`/`repair`.
- **`git-enablement` must stay LAST in `ACTIVATION_STEPS`** (frozen array in
  `activation.mjs`). FR-LIFE-004 requires it; verified by the Tech Lead.
- No user-facing `gate prune` operator command exists. TB-008 built the library
  seam plus its capability script (what its matrix required); the operator
  command surface belongs with **TB-012**'s lifecycle commands.
- ~~TB-005's one-shot bypass ledger durable store~~ — **RESOLVED by TB-008.**
  It lives in the evidence store as `store.bypassLedger()`, because a bypass is
  one-shot only if consumption outlives the applying process, and the evidence
  store is already the append-only clone-local store under the Git common
  directory. `policy.mjs` was not modified; TB-005's injected seam is satisfied
  unchanged. Consumption records a `bypass` Lifecycle event.

## Accepted amendments (already applied — do not re-litigate)

- **TB-003** exported `evidenceLadderStages` from `verification-plan.mjs` and
  added a `format` ticket-layer mapping. The agent reported "no behavior change,"
  which was inaccurate: the `format` mapping is new, and previously a `format`
  layer raised `unknown-ticket-layer`. Kept deliberately — `format` was the only
  canonical ladder stage missing from that map, and relaxing validation cannot
  invalidate an existing ticket.
- **TB-004** added `delegation{}`, `diagnostics[]`, `evidence.persisted` to the
  decision envelope (additive, serves NFR-OPER-001 diagnosability).
- **TB-005** added reason code `budget-exhausted` → `unverified`; made
  `evaluation_gate.bypass.marker` mandatory when bypass is enabled (FR-POL-007
  requires a commit-visible marker); added `evaluation_gate.execution.budget_skippable`.
  No schema JSON changed — all fit the existing v4 `gatePolicySubcontract`.
- **TB-006** extended the envelope with `task.contractStatus`, `coverage.*`,
  assertion `kind`, `integrity.{snapshotId, controlSurfaceChanged, runtimeBinding}`.
- **TB-008** added `evidence.reference`; added reason code
  `sensitive-capture-unsafe` → `unverified`; and gave `createBoundedExecutor`
  opt-in `captureOutput`/`captureLimitBytes`. That last one was necessary, not
  cosmetic: the executor ran every check with `stdio: 'ignore'`, so FR-EVID-003
  output capture was unreachable on any production path. **Default stays
  `captureOutput = false` / `stdio: 'ignore'`** — verified, no behavior change
  for existing callers.
- **TB-010** added `store.activationReceipt()` (`read`/`write`/`remove`) to
  TB-008's store — the one deliberately non-append-only piece (current state,
  not history); the audit trail stays append-only via `activation` Lifecycle
  events. It also rolls back an activation whose Lifecycle event cannot be
  written (`activation-record-failed`), on the reasoning that authoritative
  enforcement with no audit record violates NFR-AUD-001/SG-LIFE-001. Accepted.
- **TB-008 fixed a real defect**, not just added features: on macOS a linked
  worktree resolved `/private/var/...` while the primary resolved `/var/...`,
  producing *two* evidence stores for one clone. The Git common directory is now
  canonicalized. Keep this in mind for TB-009 — the same path must be the lock key.

## Open decisions the next session must make

1. **Version bump to `0.9.0`.** `package.json` is still `0.8.0`. `Q-005` fixes
   `0.9.0` as the first Gate-capable release and TB-015 qualifies it. The repo
   uses changesets (`npm run version` runs `changeset version && sync-version`).
   Whether TB-015 performs the bump or leaves it to a release step is
   **unresolved** — decide with the user.
2. **Durable store for the one-shot bypass ledger** (see above).
3. **TB-015 scope reality check.** Its matrix demands a runtime portability
   matrix across "every claimed environment" (exact Git, Node, client, OS
   versions). A single local machine cannot produce multi-OS evidence. Expect to
   either narrow the support claims to what is actually testable here, or record
   untested combinations as `unverified` — which `AC-ADAPT-002` explicitly
   permits ("untested versions remain unverified rather than denied"). Raise this
   with the user before starting TB-015 rather than fabricating a matrix.

## Suggested skills

- **`implement`** (`skills/implement/SKILL.md`) — the required process for each
  remaining ticket. Enforces readiness gates, vertical red-green cycles, explicit
  contract amendments, and evidence reporting. This is what the user asked
  delegated agents to follow.
- **`verify-change`** — invoked by `implement` step 6 for the evidence matrix.
- **`code-review`** — invoked by `implement` step 6; Security axis delegates to
  `audit-security`. Worth a pass over the accumulated uncommitted Gate diff,
  which has not yet had a review pass across slices.
- **`tdd`** — supplies the red-green discipline inside `implement`.

## Delegation prompt template that worked

Each ticket was delegated to one fresh `general-purpose` subagent, run
synchronously, ~160k–210k tokens each. The prompt that produced good results
contained: (1) point at `skills/implement/SKILL.md` as the process; (2) name the
exact ticket path; (3) point at a shared brief with conventions and the
pre-verified gate results; (4) list what already exists so the agent extends
rather than forks; (5) state the current green baseline numbers; (6) explicit
scope discipline naming what belongs to LATER slices; (7) demand honest flagging
of any test that was not red-first.

Item (7) mattered — agents self-reported over-implementing in cycle 1 and
non-red-first tests, which is exactly the signal a reviewing lead needs.

**Verify every agent report independently.** This session caught one inaccurate
"no behavior change" claim (TB-003) by reading the diff. Re-run the suites
yourself; do not accept reported numbers.
