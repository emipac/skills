import { SHARED_CONFIGURATION_FILE, confirmConfigurationCleanup, previewConfigurationCleanup } from '../../lifecycle.mjs';
import { resolveClone } from '../clone.mjs';
import { mutation } from '../outcomes.mjs';
import path from 'node:path';

/** `gate cleanup` — remove only the Gate's own keys from the shared configuration file. */
export const operateCleanup = async ({ repositoryRoot, environment, confirmation }) => {
  const configurationPath = path.join(repositoryRoot, SHARED_CONFIGURATION_FILE);
  // Re-derived on every invocation, so the confirmation is checked against the
  // file as it is now rather than against whatever the caller remembers.
  const preview = await previewConfigurationCleanup({ configurationPath });
  const observation = {
    path: preview.path,
    keys: preview.keys,
    removedText: preview.removedText,
    fileIdentity: preview.fileIdentity,
    fileDeleted: false,
    confirmationToken: preview.confirmationToken,
  };

  if (confirmation === null) {
    return { command: 'cleanup', healthy: true, observation, mutation: null };
  }

  const clone = await resolveClone({
    repositoryRoot,
    environment,
    command: 'cleanup',
    // Configuration cleanup is what a maintainer runs AFTER removal, so the
    // receipt is usually already gone; the store that records it is not.
    receiptRequired: false,
  });

  if (clone.failed) {
    return clone.failed;
  }

  const result = await confirmConfigurationCleanup({
    evidenceStore: clone.store,
    configurationPath,
    preview,
    confirmation,
  });

  return {
    command: 'cleanup',
    healthy: result.cleaned === true,
    observation,
    mutation: mutation({
      confirmation,
      performed: result.cleaned === true,
      reasonCode: result.reasonCode,
      removedKeys: result.removedKeys,
      fileDeleted: result.fileDeleted,
      errors: result.errors ?? [],
      summary: result.cleaned === true
        ? `The Gate key(s) ${result.removedKeys.join(', ')} were removed; every other byte of the shared configuration file was written back unchanged.`
        : `Nothing was removed (${result.reasonCode}); the shared configuration file was not changed.`,
    }),
  };
};
