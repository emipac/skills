import { AUTHORITATIVE_HOOK } from '../hooks/constants.mjs';
import { detectHookManager, resolveHookStrategy, resolveHooksPath } from '../hooks/discovery.mjs';
import { configurationIdentity, repositoryIdentity } from '../identities.mjs';
import { createRunnerResolver, resolveExecutables } from '../../command-descriptor.mjs';
import { resolveGitCommonDirectory } from '../../evidence-store.mjs';

/** Resolve the identities, locations, and commands one activation would use. */
export const describeActivation = async (request, dependencies) => {
  const {
    runGit,
    environment = process.env,
    detectHookManager: detect = detectHookManager,
    // Activation is where resolution happens, and the shared rule is the only
    // rule: an integrator that supplied its own resolver is how activation came
    // to pin one program while the hook ran another (`SG-OWNER-001`).
    resolveExecutable = createRunnerResolver({
      repositoryRoot: request.repository.root,
      environment,
    }),
  } = dependencies;
  const gitCommonDirectory = await resolveGitCommonDirectory({
    repositoryRoot: request.repository.root,
    runGit,
  });
  const runners = resolveExecutables(request.checks ?? [], resolveExecutable);
  const hooksPath = await resolveHooksPath({
    repositoryRoot: request.repository.root,
    gitCommonDirectory,
    runGit,
  });
  const hooksDirectory = hooksPath.directory;
  const hook = await resolveHookStrategy({
    request,
    repositoryRoot: request.repository.root,
    gitCommonDirectory,
    hooksPath,
    detect,
  });
  const hookPath = hook.path;
  const existing = hook.existing;
  const action = hook.action;

  return {
    gitCommonDirectory,
    hooksPath,
    hooksDirectory,
    hookPath,
    hook,
    hookManager: hook.manager
      ? { id: hook.manager.id, registration: hook.manager.registration, configuration: hook.manager.configuration ?? null }
      : null,
    runners,
    repository: {
      root: request.repository.root,
      gitCommonDirectory,
      identity: repositoryIdentity(gitCommonDirectory),
    },
    configuration: {
      schemaVersion: request.configuration?.schemaVersion ?? null,
      identity: configurationIdentity(request.configuration),
    },
    // Exactly what would change, and exactly what would run.
    hooks: [{
      hook: AUTHORITATIVE_HOOK,
      path: hookPath,
      action,
      // The ownership label is the strategy: it says who owns the file the gate
      // would touch, which is exactly what distinguishes the three strategies.
      ownership: hook.ownership,
      existing,
    }],
    commands: runners.resolved.map((entry) => ({
      check_id: entry.check_id,
      role: entry.role,
      runner: entry.runner,
      executable: entry.executable,
      version: entry.version,
      preview: entry.preview,
      working_directory: entry.working_directory,
    })),
    adapters: (request.adapters ?? []).map((adapter) => ({
      id: adapter.id,
      version: adapter.version ?? null,
      authoritative: adapter.authoritative === true,
    })),
    // Names only. Approving and injecting a runtime input value is a separate,
    // later concern; a receipt never carries one.
    runtimeInputs: (request.runtimeInputs ?? []).map((input) => input.name),
  };
};
