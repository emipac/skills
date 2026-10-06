import { inspectCoordination } from '../../lifecycle.mjs';
import { readHistory } from './reader.mjs';

export const operateHistory = async ({ repositoryRoot, selector }) => {
  const history = await readHistory({ repositoryRoot, limit: selector.historyLimit ?? 30, evidenceId: selector.evidenceId ?? null, blobId: selector.blobId ?? null });
  let coordination = null;
  try {
    const inspected = await inspectCoordination({ repositoryRoot });
    const holder = inspected.holder;
    coordination = {
      held: inspected.held, stale: inspected.stale, liveness: inspected.liveness,
      staleReasons: inspected.staleReasons,
      holder: holder === null ? null : { pid: holder.pid ?? null, host: holder.host ?? null, startedAt: holder.startedAt ?? null, heartbeatAt: holder.heartbeatAt ?? null, executionId: holder.executionId ?? null, role: holder.role ?? null },
    };
  } catch { history.warnings.push('coordination-unavailable'); }
  return { command: 'history', healthy: history.warnings.length === 0, observation: { history, coordination }, mutation: null };
};
