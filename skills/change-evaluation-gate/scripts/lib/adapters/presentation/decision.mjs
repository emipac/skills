import { describeAdapter } from '../declarations/registry.mjs';
import { authorizationFor } from '../../policy.mjs';

/** The structured, client-independent view of one check on any surface. */
const presentCheck = (check) => ({
  id: check.id,
  stage: check.stage,
  policy: check.policy,
  outcome: check.outcome,
  reasonCode: check.reasonCode,
  summary: check.summary,
});

/** One decision diagnostic, as every surface is handed it. */
const presentDiagnostic = (diagnostic) => ({
  reasonCode: diagnostic?.reasonCode ?? null,
  detail: diagnostic?.detail ?? null,
});

/** One changed Grader surface: what kind of surface, and which path. */
const presentGraderSurface = (surface) => ({
  kind: surface?.kind ?? null,
  path: surface?.path ?? null,
});

/**
 * Present one returned decision on one adapter's surface.
 *
 * The same decision reaches every surface unchanged. What differs is only the
 * role-derived authorization and whether the surface blocks: a deny blocks the
 * authoritative Git surface, while a preflight surface shows the identical
 * structured result and lets the host process continue (AC-ADAPT-001).
 */
export const presentDecision = ({ adapterId, decision }) => {
  const adapter = describeAdapter(adapterId);

  if (adapter === null || decision === null || typeof decision !== 'object') {
    return null;
  }

  const authorization = authorizationFor(adapter.role, decision.outcome);
  const blocking = authorization === 'deny';

  return {
    adapterId: adapter.id,
    surface: adapter.surface,
    role: adapter.role,
    outcome: decision.outcome,
    authorization,
    blocking,
    exitCode: blocking ? 1 : 0,
    presentation: {
      kind: blocking ? 'blocked' : 'preflight',
      evaluationId: decision.evaluationId,
      outcome: decision.outcome,
      authorization,
      checks: (decision.checks ?? []).map(presentCheck),
      // What the decision states as a reason beyond its checks, carried so a
      // surface renders the decision rather than a fragment of it
      // (`NFR-OPER-001`, `FR-EVAL-009`, `TB-064`).
      diagnostics: (decision.diagnostics ?? []).map(presentDiagnostic),
      changedGraderSurfaces: (decision.integrity?.changedGraderSurfaces ?? []).map(presentGraderSurface),
      // Carried every time, as the decision records it; whether the channel
      // says it again is the channel's own rule (`TB-066`).
      unversionedGraderSurfaces: (decision.integrity?.unversionedGraderSurfaces ?? []).map(presentGraderSurface),
    },
  };
};
