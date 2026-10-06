import { line, renderFindings } from './shared.mjs';

export const renderStatus = (observation) => [
  line('state', observation.state),
  line('health', observation.health),
  line(
    'release',
    observation.release === null
      ? 'none'
      : `${observation.release.id} ${observation.release.version} (protocol ${observation.release.protocolVersion})`,
  ),
  line('receipt', observation.receiptId ?? 'none'),
  line('findings', observation.findings.length),
  ...renderFindings(observation.findings),
  line('repaired', observation.repaired),
  line('mutations', observation.mutations.length),
  line('next', observation.next.instruction),
];
