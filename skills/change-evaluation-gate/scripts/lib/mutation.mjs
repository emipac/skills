/**
 * Mutation screening for check-only evaluation.
 *
 * A Command descriptor declared as a `fix` is the mutating one. Commit
 * evaluation rejects any check whose check-only `evaluate` slot carries a
 * declared fix command, whatever produced it (FR-POL-009, AC-POL-004).
 *
 * This is a pure predicate over descriptors. It names no stack and no tool: the
 * only thing it knows is that a command declared in a `fix` slot mutates
 * (SG-OWNER-001).
 */

/** The lifecycle operation that owns mutation. Evaluation is never this. */
export const FIX_OPERATION = 'fix';

/** The descriptor role a mutation invokes. Evaluation only ever invokes `evaluate`. */
export const FIX_ROLE = 'fix';

/** Why a check may not be evaluated: its check-only slot is a mutating command. */
export const MUTATION_REJECTIONS = Object.freeze([
  'evaluate-is-own-fix',
  'evaluate-is-declared-fix',
]);

const canonical = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value ?? null);
};

/** Every command the supplied checks declare as a mutating fix, by owner. */
export const declaredFixCommands = (checks = []) => new Map(
  (checks ?? [])
    .filter((check) => check?.fix)
    .map((check) => [canonical(check.fix), check.id]),
);

/**
 * Screen resolved checks before any of them can run.
 *
 * @returns {Array<{checkId: string, rejection: string, detail: string}>}
 */
export const mutatingChecks = (checks = []) => {
  const declared = declaredFixCommands(checks);
  const rejected = [];

  for (const check of checks ?? []) {
    if (!check?.evaluate) {
      continue;
    }

    const owner = declared.get(canonical(check.evaluate));

    if (owner === undefined) {
      continue;
    }

    rejected.push({
      checkId: check.id,
      rejection: owner === check.id ? 'evaluate-is-own-fix' : 'evaluate-is-declared-fix',
      detail: owner === check.id
        ? `${check.id} offers its own declared fix command as its evaluation command.`
        : `${check.id} offers the fix command declared by ${owner} as its evaluation command.`,
    });
  }

  return rejected;
};

/**
 * The single diagnostic a rejected binding produces, or `null` when every
 * supplied check is check-only. Evaluation is refused as a whole: a run that
 * silently dropped the mutating check would still be grading a binding the
 * project never configured.
 */
export const mutationDiagnostic = (checks = []) => {
  const rejected = mutatingChecks(checks);

  if (rejected.length === 0) {
    return null;
  }

  return {
    reasonCode: 'configuration-invalid',
    detail: `Evaluation is check-only and never invokes a mutating command: ${rejected
      .map(({ detail }) => detail)
      .join(' ')} Run the explicit ${FIX_OPERATION} operation instead.`,
  };
};
