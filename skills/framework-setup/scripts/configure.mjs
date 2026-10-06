/**
 * Framework setup entry point and public module interface.
 * Implementation lives in lib/configure/.
 */

import { runCli } from './lib/configure/cli.mjs';
import { isCliEntryPoint } from './lib/cli-entry-point.mjs';

export {
  previewConfigurationMigration,
  migrateConfiguration,
  draftMigrationMapping,
} from './lib/configure/migration/transaction.mjs';
export { draftGatePolicy } from './lib/configure/gate/draft.mjs';
export { gatePolicyKeys } from './lib/configure/contracts.mjs';
export { previewGateConfiguration, configureGate } from './lib/configure/gate/configuration.mjs';
export { gateRevisions } from './lib/configure/gate/revision-rules.mjs';
export {
  withheldRevision,
  previewGateRevision,
  reviseGate,
} from './lib/configure/gate/revision.mjs';
export { discoverGateConfigurationFacts } from './lib/configure/gate/facts.mjs';
export { guardrailOperations, guardrailClients } from './lib/configure/guardrail/clients.mjs';
export { previewGuardrail, applyGuardrail } from './lib/configure/guardrail/registration.mjs';
export { discoverVerification } from './lib/configure/discovery/verification.mjs';
export { discoverProject } from './lib/configure/discovery/project.mjs';
export { configureProject } from './lib/configure/project.mjs';

if (isCliEntryPoint(import.meta.url)) {
  await runCli();
}
