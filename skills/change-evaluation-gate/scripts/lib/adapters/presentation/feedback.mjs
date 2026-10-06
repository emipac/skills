import { FEEDBACK_ABSENCES } from '../declarations/contracts.mjs';
import { describeAdapter } from '../declarations/registry.mjs';
import { REMEDIES, remedyInstruction } from '../../remedies.mjs';

/**
 * How much one feedback message may carry.
 *
 * A declared channel is one string an agent reads as its next prompt, so it is
 * bounded. At most `checks` failing-check summaries and `diagnostics`
 * diagnostics other than control-surface drift are listed, each cut to
 * `entryCharacters` with a visible `…`. Whatever is not listed is counted and
 * named by reason code on a final line that points at the evaluation recording
 * every entry, so no reason code on the decision is ever silently lost
 * (`NFR-OPER-001`).
 *
 * Two things are never capped, because they change what a reader should do
 * next: an `integrity-drift` diagnostic, which the Gate raises about its own
 * pinned surfaces, and a changed Grader surface. Neither grows with the size of
 * a change: drift names surfaces activation pinned, and a Grader surface is
 * recorded only for a path the configuration declares (`AC-SEC-001`,
 * `FR-EVAL-009`, `TB-064`).
 */
export const FEEDBACK_LIMITS = Object.freeze({
  checks: 8,
  diagnostics: 8,
  entryCharacters: 400,
});

const PREFLIGHT_LEAD = 'Preflight (not a commit decision)';

const DRIFT_REASON = 'integrity-drift';

const cut = (text) => (text.length <= FEEDBACK_LIMITS.entryCharacters
  ? text
  : `${text.slice(0, FEEDBACK_LIMITS.entryCharacters - 1)}…`);

/** `reason ×n` for every reason code in `reasons`, in first-seen order. */
const tally = (reasons) => {
  const counts = new Map();

  for (const reason of reasons) {
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }

  return [...counts].map(([reason, count]) => `${reason} ×${count}`).join(', ');
};

const plural = (count, noun) => `${count} more ${noun}${count === 1 ? '' : 's'}`;

/**
 * The lines one presented decision is rendered as, in a stated order: the
 * outcome; each failing check's own summary, because those are what a
 * maintainer can act on directly; every control-surface drift; the other
 * diagnostics with their reason codes; every changed Grader surface, stated as
 * observation; every unversioned Grader surface with its remedy, unless this
 * clone was already told about exactly that set; and, when anything was left
 * out, what was left out.
 */
const decisionLines = (view, { unversionedAlreadyStated = false } = {}) => {
  const presentation = view?.presentation ?? {};
  const failing = (presentation.checks ?? []).filter(
    (check) => check?.outcome !== 'passed' && check?.outcome !== 'not-applicable',
  );
  const diagnostics = presentation.diagnostics ?? [];
  const drift = diagnostics.filter((diagnostic) => diagnostic?.reasonCode === DRIFT_REASON);
  const other = diagnostics.filter((diagnostic) => diagnostic?.reasonCode !== DRIFT_REASON);
  const surfaces = presentation.changedGraderSurfaces ?? [];
  const unversioned = unversionedAlreadyStated ? [] : presentation.unversionedGraderSurfaces ?? [];
  const listedChecks = failing.slice(0, FEEDBACK_LIMITS.checks);
  const listedOther = other.slice(0, FEEDBACK_LIMITS.diagnostics);
  const omittedChecks = failing.slice(listedChecks.length);
  const omittedOther = other.slice(listedOther.length);
  const describe = (diagnostic) => `${diagnostic?.reasonCode}: ${diagnostic?.detail ?? 'no detail recorded'}`;
  const lines = [`${PREFLIGHT_LEAD}: ${view?.outcome ?? 'unverified'}.`];

  // Each failing check's own summary, so this channel says the same thing the
  // decision says. A check that never ran names what it did not get, because
  // this is the channel that told a maintainer's agent to go and change the
  // project (`NFR-OPER-001`, `TB-044`).
  if (listedChecks.length > 0) {
    lines.push('Failing checks:', ...listedChecks.map(
      (check) => `- ${cut(check.summary ?? `${check.id} ${check.outcome}`)}`,
    ));
  }

  if (drift.length + listedOther.length > 0) {
    lines.push(
      'Diagnostics:',
      ...drift.map((diagnostic) => `- ${describe(diagnostic)}`),
      ...listedOther.map((diagnostic) => `- ${cut(describe(diagnostic))}`),
    );
  }

  // Visibility, never a classification: editing what grades a change is often
  // exactly the work (`SG-CFG-001`).
  if (surfaces.length > 0) {
    lines.push(
      'Changed Grader surfaces (this change edits what grades it; stated for visibility):',
      ...surfaces.map((surface) => `- ${surface?.kind} ${surface?.path}`),
    );
  }

  // A standing fact about the clone, not about this change, and nobody's
  // fault: stated plainly, once, with the remedy named as the maintainer's.
  // The agent is told what it is not asked to do (`FR-LIFE-009`, `TB-066`).
  if (unversioned.length > 0) {
    lines.push(
      'Unversioned Grader surfaces (Git does not track these, so they have no history to review or diff; not a change and not a fault; said once, and again only when this set changes):',
      ...unversioned.map((surface) => `- ${surface?.kind} ${surface?.path}`),
      `Remedy, the maintainer's and not this agent's: ${remedyInstruction(REMEDIES['grader-surface-unversioned'])}.`,
    );
  }

  const omitted = [
    ...(omittedChecks.length > 0
      ? [`${plural(omittedChecks.length, 'failing check')} (${tally(omittedChecks.map((check) => check?.reasonCode ?? check?.outcome))})`]
      : []),
    ...(omittedOther.length > 0
      ? [`${plural(omittedOther.length, 'diagnostic')} (${tally(omittedOther.map((diagnostic) => diagnostic?.reasonCode))})`]
      : []),
  ];

  if (omitted.length > 0) {
    lines.push(`Not listed: ${omitted.join(' and ')}; evaluation ${presentation.evaluationId ?? 'unrecorded'} records every one.`);
  }

  return lines;
};

/**
 * Render one presented decision through the adapter's declared feedback channel.
 *
 * The runner never learns a client field name: it asks this function, and this
 * function reads the field from the declaration (FR-ADAPT-004, SG-OWNER-001).
 * A genuinely clean preflight — `passed`, with no diagnostic, no changed
 * Grader surface, and no unversioned surface still to state — returns the
 * declared silence form so a clean turn is not interrupted. Every other
 * outcome — a failed required check, unverified coverage, drift, a changed
 * Grader surface, an unversioned surface not yet stated, or a harness fault —
 * occupies the declared field as one message rendered from the decision
 * (`TB-064`). An adapter that declares no channel returns none.
 *
 * `unversionedAlreadyStated` is the runner's answer to whether this clone was
 * already told about exactly this set of unversioned surfaces (`TB-066`). It
 * withholds that one statement and nothing else: a changed Grader surface is
 * never rate-limited by it.
 */
export const formatFeedback = ({ adapterId, view, unversionedAlreadyStated = false } = {}) => {
  const adapter = describeAdapter(adapterId);
  const feedback = adapter?.capabilities?.feedback ?? null;

  if (feedback === null || feedback.channel === null) {
    return typeof feedback?.none === 'string' ? feedback.none : '';
  }

  const silent = view?.outcome === 'passed'
    && view?.failure == null
    && (view?.presentation?.diagnostics ?? []).length === 0
    && (view?.presentation?.changedGraderSurfaces ?? []).length === 0
    && (unversionedAlreadyStated || (view?.presentation?.unversionedGraderSurfaces ?? []).length === 0);

  if (silent) {
    return typeof feedback.none === 'string' ? feedback.none : '';
  }

  if (feedback.channel !== 'stdout-json' || typeof feedback.field !== 'string') {
    return typeof feedback.none === 'string' ? feedback.none : '';
  }

  // A harness fault has no decision to render, and keeps the one sentence it
  // has always had (`FR-ADAPT-005`).
  const message = view?.failure
    ? `${PREFLIGHT_LEAD}: unverified — ${view.failure.detail ?? 'the evaluation could not be completed'}.`
    : decisionLines(view, { unversionedAlreadyStated }).join('\n');

  return `${JSON.stringify({ [feedback.field]: message })}\n`;
};

/**
 * Why one adapter's surface cannot answer through anything it declares, or
 * `null` when it can (`TB-048`).
 *
 * A preflight surface answers only through its feedback channel: it never
 * blocks, so a preflight with no channel evaluates and then says nothing, on
 * every turn. Such a surface is not registered, and a runner that reaches one
 * anyway does no work. Authoritative Git declares no channel either and is
 * never refused here: it answers by blocking (`FR-ADAPT-005`, `FR-ADAPT-007`).
 *
 * Read from the declaration alone, so Gate core asks this question without
 * learning which client it is asking about (`SG-OWNER-001`).
 */
export const unreportableSurface = (adapterId) => {
  const adapter = describeAdapter(adapterId);

  if (adapter === null || adapter.role !== 'preflight' || adapter.capabilities.feedback.channel !== null) {
    return null;
  }

  const absence = adapter.capabilities.feedback.absence ?? null;
  const why = FEEDBACK_ABSENCES[absence]?.asserts ?? 'it does not say why.';

  return {
    adapterId: adapter.id,
    reasonCode: 'feedback-channel-unobserved',
    absence,
    detail: `${adapter.id} declares no feedback channel (${absence ?? 'no absence stated'}): ${why} A preflight surface answers only through that channel, so this one would evaluate every turn and report nothing.`,
  };
};
