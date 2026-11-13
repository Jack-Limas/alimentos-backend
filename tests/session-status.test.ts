import { describe, expect, it } from 'vitest';
import { createSessionStatusLookup } from '../src/modules/auth/index.js';
import type { UserRecord } from '../src/modules/users/index.js';

const USER: UserRecord = {
  id: 'u1',
  email: 'op@x.test',
  name: 'Op',
  passwordHash: 'hash',
  role: 'OPERATOR',
  active: true,
  isProtected: false,
  mustChangePassword: false,
  createdAt: new Date(0),
};

describe('session status lookup', () => {
  function setup() {
    const state = { user: { ...USER } as UserRecord | null, reads: 0, now: 0 };
    const lookup = createSessionStatusLookup(
      {
        findById: () => {
          state.reads += 1;
          return Promise.resolve(state.user ? { ...state.user } : null);
        },
      },
      () => new Date(state.now),
      5_000,
    );
    return { state, lookup };
  }

  it('reads the user once per few seconds, then again', async () => {
    const { state, lookup } = setup();
    expect(await lookup.get('u1')).toEqual({
      active: true,
      role: 'OPERATOR',
      mustChangePassword: false,
    });
    await lookup.get('u1');
    expect(state.reads).toBe(1);
    state.now = 5_001;
    await lookup.get('u1');
    expect(state.reads).toBe(2);
  });

  it('forget applies a change on the next request', async () => {
    const { state, lookup } = setup();
    await lookup.get('u1');
    if (state.user) state.user.active = false;
    lookup.forget('u1');
    expect(await lookup.get('u1')).toMatchObject({ active: false });
  });

  it('a user that no longer exists has no status', async () => {
    const { state, lookup } = setup();
    state.user = null;
    expect(await lookup.get('u1')).toBeNull();
  });
});
