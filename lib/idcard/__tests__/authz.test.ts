import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canExportIdCards, idCardScope, scopeAllows, cardIsExportable, refusalFor,
  exportRefusal, ID_CARD_ANY_ROLES, type IdCardScope,
} from '../authz.ts';
import { emptyGrant, type Grant, type RoleRef } from '../../rms/resolve.ts';

/** A grant holding the given role codes. `mods` lets a test give somebody FULL
 *  on Employees to prove that module access alone still does not let them in. */
function grantWith(codes: string[], over: Partial<Grant> = {}): Grant {
  const g = emptyGrant();
  g.roles = codes.map((c, i) => ({ id: `r${i}`, role_code: c, role_name: c }) as RoleRef);
  g.companyId = 'co-1';
  g.isSuperAdmin = codes.some(c => c === 'ADMIN_SUPER' || c === 'SUPER_ADMIN');
  return Object.assign(g, over);
}

test('the named roles may export', () => {
  for (const code of ID_CARD_ANY_ROLES) {
    assert.equal(canExportIdCards(grantWith([code])), true, `${code} should be allowed`);
  }
  assert.equal(canExportIdCards(grantWith(['BRANCH_HR'])), true);
});

test('holding Employees does NOT let you export — the whole reason this file exists', () => {
  // Every one of these holds ('X','Employees','VIEW') in the role matrix, and
  // several could be given FULL by an admin tomorrow. None may export cards.
  for (const code of ['RECRUITER', 'FINANCE_EXECUTIVE', 'ADMIN_COMPANY', 'HR_EXECUTIVE',
                      'PAYROLL', 'PAYROLL_ADMIN', 'L1_MANAGER', 'HOD', 'BRANCH_EXEC', 'EMPLOYEE']) {
    const g = grantWith([code], { modules: { Employees: 'FULL' } as Grant['modules'] });
    assert.equal(canExportIdCards(g), false, `${code} must NOT be able to export`);
  }
});

test('enforcement being off does not open the door', () => {
  // hasLevel() would return true for anyone here. This must not.
  const g = grantWith(['RECRUITER'], { enforced: false, modules: { Employees: 'FULL' } as Grant['modules'] });
  assert.equal(canExportIdCards(g), false);
  assert.deepEqual(idCardScope(g), { kind: 'none' });
});

test('an unresolved grant is refused — "we could not find out" is not "yes"', () => {
  const g = grantWith(['HR_MANAGER'], { resolved: false });
  assert.equal(canExportIdCards(g), false);
});

test('the legacy shared login is refused, because a trail must name somebody', () => {
  const g = grantWith(['HR_MANAGER'], { legacy: true });
  assert.equal(canExportIdCards(g), false);
});

test('an org-scoped HR role reaches every company; a company-pinned one does not', () => {
  const org = grantWith(['HR_MANAGER'], { crossCompany: true });
  assert.deepEqual(idCardScope(org), { kind: 'all' });

  const pinned = grantWith(['HR_MANAGER'], { crossCompany: false });
  assert.deepEqual(idCardScope(pinned), { kind: 'company', companyId: 'co-1' });
});

test('super admin reaches everything', () => {
  assert.deepEqual(idCardScope(grantWith(['ADMIN_SUPER'])), { kind: 'all' });
});

test('Branch HR uses the location on the ASSIGNMENT when there is one', () => {
  const g = grantWith(['BRANCH_HR']);
  assert.deepEqual(
    idCardScope(g, ['loc-pune'], 'loc-gurugram'),
    { kind: 'locations', companyId: 'co-1', locationIds: ['loc-pune'] },
  );
});

test('Branch HR falls back to their own location before the migration is applied', () => {
  const g = grantWith(['BRANCH_HR']);
  assert.deepEqual(
    idCardScope(g, [], 'loc-pune'),
    { kind: 'locations', companyId: 'co-1', locationIds: ['loc-pune'] },
  );
});

test('a Branch HR whose branch cannot be determined gets NOTHING, not everything', () => {
  // The one case where guessing wide would be indefensible.
  const g = grantWith(['BRANCH_HR']);
  assert.deepEqual(idCardScope(g, [], null), { kind: 'none' });
  assert.deepEqual(idCardScope(g, [null, undefined], null), { kind: 'none' });
});

test('Branch HR can cover several assigned locations, de-duplicated', () => {
  const g = grantWith(['BRANCH_HR']);
  const s = idCardScope(g, ['loc-a', 'loc-b', 'loc-a'], 'loc-c');
  assert.equal(s.kind, 'locations');
  assert.deepEqual((s as { locationIds: string[] }).locationIds, ['loc-a', 'loc-b']);
});

test('scopeAllows is the per-row second check, and it actually refuses', () => {
  const all = { kind: 'all' } as const;
  assert.equal(scopeAllows(all, { company_id: 'x', location_id: 'y' }), true);

  const company = { kind: 'company', companyId: 'co-1' } as const;
  assert.equal(scopeAllows(company, { company_id: 'co-1', location_id: 'anything' }), true);
  assert.equal(scopeAllows(company, { company_id: 'co-2', location_id: 'anything' }), false);

  // Annotated rather than `as const`: the latter makes locationIds a
  // `readonly string[]`, which is not assignable to IdCardScope's mutable
  // array. The tests passed anyway — a green run is not a typecheck.
  const branch: IdCardScope = { kind: 'locations', companyId: 'co-1', locationIds: ['loc-pune'] };
  assert.equal(scopeAllows(branch, { company_id: 'co-1', location_id: 'loc-pune' }), true);
  assert.equal(scopeAllows(branch, { company_id: 'co-1', location_id: 'loc-noida' }), false);
  // Same location id, different company — refused.
  assert.equal(scopeAllows(branch, { company_id: 'co-2', location_id: 'loc-pune' }), false);
  // No location on the row at all — refused rather than waved through.
  assert.equal(scopeAllows(branch, { company_id: 'co-1', location_id: null }), false);

  assert.equal(scopeAllows({ kind: 'none' }, { company_id: 'co-1', location_id: 'loc-pune' }), false);
});

test('downloads stop when the credential is not active', () => {
  assert.equal(cardIsExportable('active'), true);
  assert.equal(cardIsExportable('Active'), true);      // the 092 casing trap
  for (const s of ['revoked', 'suspended', 'expired', '', null, undefined]) {
    assert.equal(cardIsExportable(s), false, `${s} must not be exportable`);
  }
});

test('an employee with no credential row can still be exported', () => {
  // The bug this pins: credentials are issued lazily by ESS, so most employees
  // have no row. Gating on state would have refused almost everybody.
  assert.equal(exportRefusal({ employment_status: 'Active' }, undefined), null);
  assert.equal(exportRefusal({ employment_status: 'Active' }, null), null);
  assert.equal(exportRefusal({ employment_status: 'Active' }, ''), null);
});

test('downloads stop on exit, by employment status', () => {
  for (const s of ['separated', 'Suspended', 'INACTIVE', 'exited', 'Resigned']) {
    assert.match(String(exportRefusal({ employment_status: s })), /Downloads stop on exit/, `${s} should refuse`);
  }
  assert.equal(exportRefusal({ employment_status: 'Active' }), null);
});

test('a last working day in the past stops the download; a future one does not', () => {
  const past = '2020-01-01';
  const future = new Date(Date.now() + 86400_000 * 30).toISOString().slice(0, 10);
  assert.match(String(exportRefusal({ employment_status: 'Active', date_of_leaving: past })), /last working day/);
  assert.equal(exportRefusal({ employment_status: 'Active', date_of_leaving: future }), null);
  // An unparseable date must not silently refuse a serving employee.
  assert.equal(exportRefusal({ employment_status: 'Active', date_of_leaving: 'not a date' }), null);
});

test('a revoked or suspended credential blocks, when one exists', () => {
  assert.match(String(exportRefusal({ employment_status: 'Active' }, 'revoked')), /revoked/);
  assert.match(String(exportRefusal({ employment_status: 'Active' }, 'suspended')), /suspended/);
  assert.equal(exportRefusal({ employment_status: 'Active' }, 'active'), null);
});

test('a refusal says which kind of refusal it is', () => {
  assert.match(refusalFor({ kind: 'none' }), /not part of your access/);
  assert.match(refusalFor({ kind: 'company', companyId: 'co-1' }), /outside the locations/);
});
