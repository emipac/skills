import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const contained = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

/** Read only a bounded regular file whose canonical path stays under its owner. */
export const readOwnedFile = async (owner, file, { maxBytes, tail = false } = {}) => {
  const canonicalOwner = path.resolve(owner);
  const canonical = await realpath(file);
  if (!contained(canonicalOwner, canonical)) {
    throw Object.assign(new Error('outside-owner'), { code: 'UNSAFE_PATH' });
  }
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const details = await handle.stat();
    if (!details.isFile()) throw Object.assign(new Error('not-file'), { code: 'UNSAFE_PATH' });
    const observedPath = await realpath(file);
    const observedDetails = await stat(observedPath);
    if (!contained(canonicalOwner, observedPath) || details.ino !== observedDetails.ino || details.dev !== observedDetails.dev) {
      throw Object.assign(new Error('changed-path'), { code: 'UNSAFE_PATH' });
    }
    if (!tail && details.size > maxBytes) throw Object.assign(new Error('too-large'), { code: 'TOO_LARGE' });
    const length = Math.min(details.size, maxBytes);
    const bytes = Buffer.alloc(length);
    const { bytesRead } = await handle.read(bytes, 0, length, tail ? Math.max(0, details.size - length) : 0);
    return { bytes: bytes.subarray(0, bytesRead), truncated: details.size > length };
  } finally {
    await handle.close();
  }
};

export const assertOwnedRoot = async (owner, root) => {
  const [canonicalOwner, canonicalRoot] = await Promise.all([realpath(owner), realpath(root)]);
  if (!contained(canonicalOwner, canonicalRoot)) throw Object.assign(new Error('outside-owner'), { code: 'UNSAFE_PATH' });
  return canonicalRoot;
};
