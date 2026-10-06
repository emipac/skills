import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  listArgument,
  nullableArgument,
  parseArguments,
  scriptScopeArguments,
  sourceScopeArguments,
} from './arguments.mjs';
import { discoverProject } from './discovery/project.mjs';
import { configureGate, previewGateConfiguration } from './gate/configuration.mjs';
import { draftGatePolicy } from './gate/draft.mjs';
import { gateRevisions } from './gate/revision-rules.mjs';
import { previewGateRevision, reviseGate } from './gate/revision.mjs';
import { applyGuardrail, previewGuardrail } from './guardrail/registration.mjs';
import {
  draftMigrationMapping,
  migrateConfiguration,
  previewConfigurationMigration,
} from './migration/transaction.mjs';
import { configureProject } from './project.mjs';

export const runCli = async () => {
  const options = parseArguments(process.argv.slice(2));
  const projectRoot = options.project ?? process.cwd();

  if (options.discover) {
    console.log(JSON.stringify(await discoverProject(projectRoot), null, 2));
    return;
  }

  // Drafting is a distinct request with a distinct output. It is deliberately
  // not folded into --discover and never chains into migration or the Gate.
  if (options['draft-mapping']) {
    console.log(JSON.stringify(
      await draftMigrationMapping({ projectRoot, out: options.out ?? null }),
      null,
      2,
    ));
    return;
  }

  if (options['draft-policy']) {
    console.log(JSON.stringify(
      await draftGatePolicy({ projectRoot, out: options.out ?? null }),
      null,
      2,
    ));
    return;
  }

  if (options['migrate-v4']) {
    if (!options.mapping) {
      throw new Error('--mapping is required when migrating to schema v4');
    }

    const mappings = JSON.parse(await readFile(path.resolve(options.mapping), 'utf8'));
    const migrationOptions = { projectRoot, mappings };
    const result = options.confirm
      ? await migrateConfiguration({ ...migrationOptions, confirmation: options.confirm })
      : await previewConfigurationMigration(migrationOptions);

    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // A named revision of a configured Gate section, previewed, then confirmed
  // with that preview's token: the direct path the Framework command's
  // `config` revisions drive (`FR-GUIDE-006`, `NFR-REL-004`).
  if (options['revise-gate']) {
    // Every value any named revision takes, read by its own name; the
    // operation refuses a value it does not take.
    const revisionValues = new Set(Object.values(gateRevisions)
      .flatMap(({ argument, options: optional }) => [argument, ...optional]));
    const revisionOptions = {
      projectRoot,
      revision: {
        operation: options['revise-gate'],
        ...Object.fromEntries([...revisionValues].map((name) => [name, options[name]])),
      },
    };
    let result;

    try {
      result = options.confirm
        ? await reviseGate({ ...revisionOptions, confirmation: options.confirm })
        : await previewGateRevision(revisionOptions);
    } catch (error) {
      if (error.reasonCode === undefined) {
        throw error;
      }

      // A refusal is the revision's own answer, stated as one, and never the
      // thrown error's inspection, which would print what it carries.
      console.log(JSON.stringify({ status: 'refused', reasonCode: error.reasonCode, detail: error.message }, null, 2));
      process.exitCode = 2;
      return;
    }

    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Registering or removing the destructive-command guardrail, previewed, then
  // confirmed with that preview's token: the direct path the Framework
  // command's `guardrail` subcommand drives (FS-006).
  if (options.guardrail) {
    const guardrailOptions = { projectRoot, operation: options.guardrail, client: options.client };
    let result;

    try {
      result = options.confirm
        ? await applyGuardrail({ ...guardrailOptions, confirmation: options.confirm })
        : await previewGuardrail(guardrailOptions);
    } catch (error) {
      if (error.reasonCode === undefined) {
        throw error;
      }

      console.log(JSON.stringify({ status: 'refused', reasonCode: error.reasonCode, detail: error.message }, null, 2));
      process.exitCode = 2;
      return;
    }

    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (options['configure-gate']) {
    if (!options.policy) {
      throw new Error('--policy is required when configuring the Gate');
    }

    const policy = JSON.parse(await readFile(path.resolve(options.policy), 'utf8'));
    const gateOptions = { projectRoot, policy };
    const result = options.confirm
      ? await configureGate({ ...gateOptions, confirmation: options.confirm })
      : await previewGateConfiguration(gateOptions);

    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!options.tracker) {
    throw new Error('--tracker is required when configuring a project');
  }

  let result;

  try {
    result = await configureProject({
      projectRoot,
      selections: {
        tracker: options.tracker,
        srsPath: nullableArgument(options.srs),
        glossaryPath: nullableArgument(options.glossary),
        adrPath: nullableArgument(options.adrs),
        historyPath: nullableArgument(options.history),
        backend: options.backend,
        frontend: options.frontend,
        sourceScopes: sourceScopeArguments(options),
        scriptScopes: scriptScopeArguments(options),
        excludedScripts: listArgument(options['exclude-scripts']),
      },
    });
  } catch (error) {
    if (error.reasonCode === undefined) {
      throw error;
    }

    // Stated as `--revise-gate` states its refusals: a document, exit 2.
    console.log(JSON.stringify({ status: 'refused', reasonCode: error.reasonCode, detail: error.message }, null, 2));
    process.exitCode = 2;
    return;
  }

  console.log(JSON.stringify(result, null, 2));
};
