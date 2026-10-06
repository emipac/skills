import { discoverProject } from '../../../configure.mjs';
import { failure, nextOf } from '../presentation.mjs';
import { planSetup } from '../setup/plan.mjs';
import { locateGateCommand, runGateCommand } from '../../gate-command.mjs';

/**
 * A clone with no Gate section: say so, and name the next step setup's own
 * plan names for it.
 */
const unconfiguredSection = async ({ projectRoot, environment, status = null }) => {
  const plan = await planSetup({ projectRoot, environment, status });

  return plan.failure ? plan : { state: plan.state, gate: plan.gate, section: null, next: nextOf(plan.steps) };
};

/**
 * The Gate configuration section as `gate status --json` observes it, for the
 * `config` subcommand named `reader`.
 *
 * Returns `{ gate, status, observation }` for a clone that has a section; a
 * clone with none is answered as `unconfiguredSection` answers it, and a Gate
 * that cannot be asked, or that predates the observed section, as a failure.
 */
export const observeSection = async ({ projectRoot, environment, reader }) => {
  const discovery = await discoverProject(projectRoot);

  if (discovery.existingConfiguration.schemaVersion !== 4) {
    return unconfiguredSection({ projectRoot, environment });
  }

  const gate = await locateGateCommand({ environment });

  if (!gate.available) {
    return {
      gate,
      ...failure(
        'gate-unavailable',
        `the Gate configuration section is read only through the Gate's own command, and ${gate.detail}.`,
      ),
    };
  }

  const status = await runGateCommand(gate, { cwd: projectRoot, args: ['status'], environment });

  if (status.failure) {
    return { ...status, gate };
  }

  const { observation } = status.document;
  const { configuration } = observation;

  // A Gate from before the section was observable: say so, never read it some other way.
  if (configuration === undefined) {
    const release = observation.release ? `${observation.release.id} ${observation.release.version}` : 'a release it does not name';

    return {
      gate,
      ...failure(
        'gate-configuration-unobserved',
        `\`${[...gate.display, 'status', '--json'].join(' ')}\` reports no configuration section: the installed Gate (${release}, ${gate.detail}) predates it. Update the Gate module; ${reader} reads the section only through the Gate's own command.`,
      ),
    };
  }

  if (configuration.pinned === null && configuration.working.reasonCode === 'gate-policy-missing') {
    return unconfiguredSection({ projectRoot, environment, status });
  }

  return { gate, status, observation };
};
