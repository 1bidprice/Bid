import { createHash } from 'node:crypto';

export function contentHash(value) {
  const normalized = typeof value === 'string' ? value : JSON.stringify(value);
  return createHash('sha256').update(normalized).digest('hex');
}
