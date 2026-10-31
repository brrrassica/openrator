/**
 * OpenRator — non-secret key fingerprints.
 * The raw key never leaves memory; only this short stable digest is persisted.
 */

/** FNV-1a-ish 32-bit digest mixed with the key's public prefix. */
export function shortHash(key: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${key.slice(0, 7)}${h.toString(16).padStart(8, '0')}`;
}
