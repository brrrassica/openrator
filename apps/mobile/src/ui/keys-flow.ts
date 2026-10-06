/**
 * OpenRator — create-key reveal flow state machine (M4.5, spec §8.4).
 * The full key value exists in memory only while the user is looking at it;
 * collapsing discards it and nothing in the reducer ever persists it.
 */

export type RevealStatus = 'idle' | 'revealed' | 'collapsed';

export interface RevealState {
  status: RevealStatus;
  /** Present ONLY when status === 'revealed'. */
  keyValue: string | null;
  copiedAt: number | null;
  testedAt: number | null;
}

export const initialRevealState: RevealState = {
  status: 'idle',
  keyValue: null,
  copiedAt: null,
  testedAt: null,
};

export type RevealAction =
  | { type: 'begin' }
  | { type: 'reveal'; keyValue: string }
  | { type: 'copy'; now?: number }
  | { type: 'test'; now?: number }
  | { type: 'collapse' };

export function revealReducer(state: RevealState, action: RevealAction): RevealState {
  switch (action.type) {
    case 'begin':
      return { ...state, status: 'idle', keyValue: null };
    case 'reveal': {
      if (!action.keyValue) return state;
      return { status: 'revealed', keyValue: action.keyValue, copiedAt: null, testedAt: null };
    }
    case 'copy':
      return state.status === 'revealed'
        ? { ...state, copiedAt: action.now ?? Date.now() }
        : state;
    case 'test':
      return state.status === 'revealed'
        ? { ...state, testedAt: action.now ?? Date.now() }
        : state;
    case 'collapse':
      // the secret is dropped the moment the user stops seeing it
      return { status: 'collapsed', keyValue: null, copiedAt: null, testedAt: null };
  }
}

/** Invariant helper for tests: a collapsed/idle state never carries a key. */
export function holdsSecret(state: RevealState): boolean {
  return state.keyValue !== null;
}