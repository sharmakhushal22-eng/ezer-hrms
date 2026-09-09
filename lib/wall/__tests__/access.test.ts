// lib/wall/__tests__/access.test.ts — the permission gate.
//
// Every one of these functions FAILS CLOSED. That is the property worth
// pinning: when the database errors, when it answers null, when it answers a
// truthy-but-not-true value, the answer must be "no". A gate that opens on a
// dropped connection is worse than no gate, because it looks like one.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { wofCan, wofExplain, isWallAdmin, deny } from '../access.ts';

/** Minimal stand-in for the Supabase client: records the call, returns a
 *  scripted reply. Only .rpc() is used by access.ts. */
function fakeClient(reply: { data?: unknown; error?: unknown }) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  return {
    calls,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { data: reply.data ?? null, error: reply.error ?? null };
    },
  } as any;
}

describe('wofCan', () => {
  test('true only when the database says exactly true', async () => {
    assert.equal(await wofCan(fakeClient({ data: true }), 'e', 'wof.view'), true);
  });

  test('an error is a denial, not an exception', async () => {
    const c = fakeClient({ error: { message: 'connection lost' } });
    assert.equal(await wofCan(c, 'e', 'wof.view'), false);
  });

  test('null is a denial', async () => {
    assert.equal(await wofCan(fakeClient({ data: null }), 'e', 'wof.view'), false);
  });

  test('truthy-but-not-true is a denial', async () => {
    // A gate that accepts 1, 'true' or {} is a gate that can be talked into
    // opening by a driver change.
    for (const data of [1, 'true', {}, [], 'yes']) {
      assert.equal(await wofCan(fakeClient({ data }), 'e', 'wof.view'), false,
        `${JSON.stringify(data)} must not open the gate`);
    }
  });

  test('company and branch travel as null rather than being dropped', async () => {
    const c = fakeClient({ data: true });
    await wofCan(c, 'emp-1', 'wof.board.manage');
    assert.deepEqual(c.calls[0].args, {
      p_employee: 'emp-1', p_permission: 'wof.board.manage',
      p_company: null, p_branch: null,
    });
  });

  test('the permission string is passed through untouched', async () => {
    const c = fakeClient({ data: true });
    await wofCan(c, 'e', 'wof.admin.grant', 'co-1', 'br-1');
    assert.equal(c.calls[0].args.p_permission, 'wof.admin.grant');
    assert.equal(c.calls[0].args.p_company, 'co-1');
    assert.equal(c.calls[0].args.p_branch, 'br-1');
  });
});

describe('wofExplain', () => {
  test('returns the database sentence when there is one', async () => {
    const c = fakeClient({ data: 'Requires Wall Administrator level board_operator or above.' });
    assert.match(await wofExplain(c, 'e', 'wof.board.manage'), /board_operator/);
  });

  test('an error still yields a sentence, never an empty screen', async () => {
    const c = fakeClient({ error: { message: 'boom' } });
    assert.equal(await wofExplain(c, 'e', 'wof.view'), 'You do not have access to this.');
  });

  test('a null answer yields the same fallback', async () => {
    assert.equal(await wofExplain(fakeClient({ data: null }), 'e', 'wof.view'),
      'You do not have access to this.');
  });
});

describe('isWallAdmin', () => {
  test('defaults to demanding wall_admin, not the lowest rung', async () => {
    const c = fakeClient({ data: true });
    await isWallAdmin(c, 'e', 'co');
    assert.equal(c.calls[0].args.p_min_level, 'wall_admin');
  });

  test('an explicit lower level is honoured', async () => {
    const c = fakeClient({ data: true });
    await isWallAdmin(c, 'e', 'co', 'board_operator');
    assert.equal(c.calls[0].args.p_min_level, 'board_operator');
  });

  test('fails closed on error', async () => {
    assert.equal(await isWallAdmin(fakeClient({ error: { message: 'x' } }), 'e', 'co'), false);
  });
});

describe('deny', () => {
  test('is a 403 carrying the reason, so a screen can say why', async () => {
    const r = deny('Requires board_operator.');
    assert.equal(r.status, 403);
    const body = await r.json();
    assert.equal(body.error, 'forbidden');
    assert.equal(body.reason, 'Requires board_operator.');
  });
});
