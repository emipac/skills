import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ENTRY_SCRIPT = fileURLToPath(new URL('../../agent-framework.mjs', import.meta.url));

export const CONFIGURE_SCRIPT = path.join(path.dirname(ENTRY_SCRIPT), 'configure.mjs');

export const exists = (candidate) => stat(candidate).then(() => true, () => false);
