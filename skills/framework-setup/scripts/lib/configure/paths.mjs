import { fileURLToPath } from 'node:url';

export const GUARDRAIL_SCRIPT = fileURLToPath(new URL('../../guardrail.mjs', import.meta.url));

export const adapterReferencePath = (tracker) => fileURLToPath(
  new URL(`../../../references/tracker-${tracker}.md`, import.meta.url),
);
