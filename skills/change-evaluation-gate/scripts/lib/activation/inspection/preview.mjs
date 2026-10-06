import { describeActivation } from './description.mjs';
import { contentIdentity } from '../../evidence-store.mjs';
import { validateGatePolicy } from '../../policy.mjs';
import { recordedProvisioning } from '../../snapshot.mjs';

/**
 * Preview one activation.
 *
 * The preview writes nothing. It states the identities the transaction is bound
 * to, the exact hook locations it would change, the exact resolved commands it
 * would run, the adapters it would self-test, and the runtime input names it
 * would pin. Consent is granted against this exact preview (FR-LIFE-004).
 */
export const previewActivation = async (request, dependencies = {}) => {
  const policyIssues = validateGatePolicy(request.configuration?.policy);

  if (policyIssues.length > 0) {
    throw new Error(policyIssues
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join(' '));
  }

  const described = await describeActivation(request, dependencies);
  const body = {
    repository: described.repository,
    configuration: described.configuration,
    hooksPath: described.hooksPath,
    hookManager: described.hookManager,
    hooks: described.hooks,
    commands: described.commands,
    // What the checks will be given besides the snapshot itself. Consent is
    // granted against this preview, so a maintainer sees which installed
    // directories their own tools will reach (TB-030, FR-LIFE-004).
    dependencyRoots: [...(request.configuration?.policy?.execution?.dependency_roots ?? [])],
    // And how those directories will be provided. The difference is visible to
    // a maintainer before consent because it is visible to their tools
    // afterwards: under `link` a tool that resolves a path to its realpath
    // reads their own clone, and under `copy` it reads the snapshot
    // (`FR-CFG-002`, `FR-LIFE-004`). A scalar declaration previews as the
    // scalar; a per-root map previews complete, every declared root with the
    // strategy it will receive, so the consent is to the mixed provisioning
    // itself and a changed map is a changed preview identity (`TB-057`).
    dependencyProvisioning: recordedProvisioning(
      request.configuration?.policy?.execution?.dependency_provisioning,
      request.configuration?.policy?.execution?.dependency_roots ?? [],
    ),
    unresolved: described.runners.unresolved,
    adapters: described.adapters,
    runtimeInputs: described.runtimeInputs,
    trust: { client: request.client?.id ?? null, required: true },
    scope: request.scope ?? 'repository',
  };

  return { ...body, previewId: contentIdentity(body) };
};
