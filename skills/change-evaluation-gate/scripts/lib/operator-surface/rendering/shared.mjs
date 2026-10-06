import { CONFIRMABLE_COMMANDS } from '../constants.mjs';
import { previewInstruction } from '../instructions.mjs';

export const line = (label, value) => `${label}: ${value}`;

export const renderFindings = (findings) => (findings ?? []).map((finding) => [
  `  - ${finding.code} [${finding.severity}] ${finding.area}`,
  ...(finding.adapter === undefined ? [] : [`    adapter: ${finding.adapter}`]),
  ...(finding.path === undefined ? [] : [`    path: ${finding.path}`]),
  ...(finding.surface === undefined ? [] : [`    surface: ${finding.surface}`]),
  `    ${finding.detail}`,
].join('\n'));

/**
 * The one line every confirmable command ends its preview with.
 *
 * It is composed from the invocation the document records, so it carries every
 * selector that shaped the preview — once per value for a repeatable one, and
 * quoted wherever a shell would otherwise split or interpret it — followed by
 * the confirmation selector and the token. A command whose invocation carried
 * no selector prints exactly the line it always printed (`TB-053`).
 *
 * After a REFUSED confirmation the line names the preview invocation and no
 * token. The token this invocation recomputed is the token of the operation
 * this invocation described, which is by definition not the one the operator
 * confirmed; offered beside the refusal it is one paste from performing an
 * operation nobody read — which is exactly how a `--client cursor` preview
 * became a git activation. The recomputed preview is still rendered above,
 * so nothing is hidden; what is withheld is the shortcut past reading it.
 */
export const renderConfirmation = (command, observation, document = {}) => {
  const token = observation.confirmationToken ?? null;

  if (token === null) {
    return line('next', 'nothing to confirm');
  }

  const preview = previewInstruction(command, document.invocation?.selectors ?? []);

  if (document.mutation?.performed === false) {
    return line('next', preview);
  }

  return line('next', `${preview} ${CONFIRMABLE_COMMANDS[command]} ${token}`);
};

/**
 * The dependency roots line of an activation preview.
 *
 * Under one strategy for every root the line reads exactly as it did before
 * `TB-057`. Under a per-root map each root carries its own strategy, so what
 * a maintainer confirms is the mixed provisioning they declared, not a
 * summary of it (`FR-LIFE-004`, `NFR-OPER-001`).
 */
export const renderDependencyRoots = ({ dependencyRoots, dependencyProvisioning }) => {
  if (dependencyRoots.length === 0) {
    return typeof dependencyProvisioning === 'string'
      ? `none (provided by ${dependencyProvisioning})`
      : 'none';
  }

  if (typeof dependencyProvisioning === 'string') {
    return `${dependencyRoots.join(', ')} (provided by ${dependencyProvisioning})`;
  }

  return dependencyRoots
    .map((root) => `${root} (${dependencyProvisioning?.[root] ?? 'unstated'})`)
    .join(', ');
};

export const renderRelease = (release) => (release === null
  ? 'none'
  : `${release.id ?? 'unknown'} ${release.version ?? 'unknown'} (protocol ${release.protocolVersion ?? 'unknown'})`);
