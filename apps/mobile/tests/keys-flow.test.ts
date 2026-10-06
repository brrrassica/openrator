import { describe, expect, it } from 'vitest';
import {
  holdsSecret,
  initialRevealState,
  revealReducer,
} from '../src/ui/keys-flow';

describe('create-key reveal flow (M4.5)', () => {
  it('starts idle with no secret', () => {
    expect(initialRevealState.status).toBe('idle');
    expect(holdsSecret(initialRevealState)).toBe(false);
  });

  it('reveal shows the key; copy/test stamp timestamps', () => {
    let s = revealReducer(initialRevealState, { type: 'reveal', keyValue: 'sk-or-v1-x' });
    expect(s.status).toBe('revealed');
    expect(s.keyValue).toBe('sk-or-v1-x');
    s = revealReducer(s, { type: 'copy', now: 100 });
    s = revealReducer(s, { type: 'test', now: 200 });
    expect(s.copiedAt).toBe(100);
    expect(s.testedAt).toBe(200);
  });

  it('ignores empty reveal payloads', () => {
    const s = revealReducer(initialRevealState, { type: 'reveal', keyValue: '' });
    expect(s.status).toBe('idle');
    expect(s.keyValue).toBeNull();
  });

  it('collapse drops the secret immediately', () => {
    let s = revealReducer(initialRevealState, { type: 'reveal', keyValue: 'sk-or-v1-secret' });
    expect(holdsSecret(s)).toBe(true);
    s = revealReducer(s, { type: 'collapse' });
    expect(s.status).toBe('collapsed');
    expect(s.keyValue).toBeNull();
    expect(holdsSecret(s)).toBe(false);
  });

  it('copy/test are no-ops outside revealed state', () => {
    const s = revealReducer(initialRevealState, { type: 'copy', now: 5 });
    expect(s.copiedAt).toBeNull();
  });

  it('revealing again resets copy/test stamps', () => {
    let s = revealReducer(initialRevealState, { type: 'reveal', keyValue: 'a' });
    s = revealReducer(s, { type: 'copy', now: 5 });
    s = revealReducer(s, { type: 'reveal', keyValue: 'b' });
    expect(s.keyValue).toBe('b');
    expect(s.copiedAt).toBeNull();
  });
});