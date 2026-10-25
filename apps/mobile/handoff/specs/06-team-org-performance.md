# 06 — Team, Org Chart, Performance (ESS employee screens)

Source of truth: repo `/Users/girish/Documents/ezer-hrms`, branch `feat/mobile-app`, read 19 Oct 2026.
Everything below is quoted from source. Where the web code looks broken or inconsistent, it is marked **⚠ PARITY NOTE**. Copy the behaviour as-is, or fix it on purpose, but decide which.

Files covered:

| Area | Files |
|---|---|
| Portal wiring | `components/ess/EmployeePortal.tsx` (SECTIONS ~L3153, render switch ~L4026-4049) |
| Team | `components/ess/team/MyTeam.tsx`, `TeamRoster.tsx`, `ui.tsx`, `icons.tsx`, `team.css`; `app/api/ess/team/route.ts`, `app/api/rms/hierarchy/route.ts`, `app/api/rms/orgchart/route.ts`; `lib/rms/client.ts` (`authToken`, `useManagerChain`), `lib/rms/server.ts`, `lib/ess/api.ts`, `components/ess/RoleTabs.tsx` (`useEssMenu`), `app/api/ess/menu/route.ts`, `lib/ess/session.ts` |
| Org chart | `components/ess/AdminModules.tsx` → `app/dashboard/org-chart/page.tsx`; `lib/rms/tree.ts`, `lib/rms/resolve.ts`; `app/globals.css` (`.org-tree`) |
| Performance | `components/ess/Performance.tsx`; `components/pms/CycleHeader.tsx`, `CycleStepper.tsx`, `NextAction.tsx`, `StatCards.tsx`, `EmployeeTabs.tsx`, `ManagerTabs.tsx`, `pms.css`; `lib/pms/*.ts`; `app/api/ess/pms/route.ts` (GET, read-only, not called by web) |
| DB | `supabase/migrations/060_org_chart_diagnostics.sql`, `071_ess_access_reconciliation.sql`, `066_pms_module.sql`, `074_pms_not_found_guards.sql`, `076_pms_persist_scores.sql` |

---

## 0. Shared plumbing

### 0.1 Auth token
- `authToken()` (`lib/rms/client.ts`) returns the ESS session token from `localStorage['ezer_ess_session'].token`. If there isn't one, it falls back to the Supabase auth access token. The value is sent as `Authorization: Bearer <token>`.
- `api(path, employeeId, init?)` (`lib/ess/api.ts`) adds `employee_id=<id>` to the query string (`?` or `&`) and sets `cache:'no-store'` and headers `Content-Type: application/json` + bearer. It reads the body as JSON (`{}` on parse failure). On a non-2xx response it throws `Error(body.error || "HTTP <status>")` with `.status` and `.body` attached.
- Server side, `essRoute(req)` (`lib/ess/session.ts`) runs `requireDashboardUser` (ESS HMAC token or legacy Supabase JWT), then `askedEmployeeId`, then `essContext`. Its error responses:
  - 401 `{ error: "Sign in first. This endpoint needs a dashboard session." }`: no token.
  - 401 `{ error: "Your session has expired. Sign in again." }`: bad or expired token.
  - 403 `{ error: "You can only open your own portal." }`: an ESS user asked for another `employee_id` without admin access (`hasAdminAccess` = super admin, legacy, or VIEW on any module).
  - 400 `{ error: "employee_id is required for the dashboard login." }`: legacy login with no `employee_id`.
  - 500 `{ error: "ess_menu: <msg>. Has migration 071 been run?" }`.

### 0.2 `GET /api/ess/menu` (used by `useEssMenu(emp.id)`)
Response, from `app/api/ess/menu/route.ts`:
```json
{
  "tabs": [{ "id": "home", "label": "Home" }, ...],
  "is_rm": boolean, "direct_reports": number,
  "is_hod": boolean, "hod_departments": string[] /* dept uuids */,
  "roles": [{ "code": string, "name": string, "scope": string|null }],
  "functional_scope": "SELF"|"TEAM"|"DEPT"|"BRANCH"|"ORG",
  "approval_types": string[],
  "modules": { "<Module name>": "NONE"|"VIEW"|"EDIT"|"FULL" },
  "can": { "approvals": boolean, "company": boolean, "reports": boolean },
  "screens": { "allow": {"<screen_key>": boolean}, "configured": {"<module>": boolean} },
  "super_admin": boolean, "view_as": boolean
}
```
- `is_rm` = `ess_direct_reports(emp)` count > 0. That function returns `employees` rows with `l1_manager_id = emp`, `employment_status` Active (or null), and `is_test` false.
- `is_hod` = `ess_hod_departments(emp)` count > 0. That is departments where `departments.hod_employee_id = emp`, UNION distinct `employees.department_id` where `employees.hod_id = emp`.
- The client default before load (`EMPTY_MENU`) has every flag false.

### 0.3 Sidebar visibility of these three sections
`sections = SECTIONS.filter(s => s.k === 'company' ? essMenu.can.company : s.k === 'reports' ? essMenu.can.reports : true)`.
**Team, Org Chart and Performance are shown to every employee.** There is no role gate on the section itself. All three sit in nav group "You & your team" (`['profile','team','orgchart','performance']`). Each section has one item, so no sub-tab pill row is drawn.

| key | label | short | desc (section subtitle) | search keywords |
|---|---|---|---|---|
| `team` | Team | Team | Your manager, your peers and the people who report to you | reportees manager my team |
| `orgchart` | Org Chart | Org | See how the whole company fits together | org chart hierarchy reporting tree |
| `performance` | Performance | PMS | Your goals (KRAs) and the reviews you owe | pms performance goals kra appraisal review |

Render: `case 'team': <MyTeam emp={emp} isMobile={isMobile} />` (isMobile = `window.innerWidth < 1024`); `case 'orgchart': <AdminModuleHost moduleKey="org-chart" />`; `case 'performance': <Performance employeeId={emp.id} />`.

---

## 1. Team section (`MyTeam`)

### 1.1 Purpose
One vertical "line" with you in the middle:
- your reporting chain above you
- a highlighted YOU band holding your team-mates (people who share your L1 manager)
- your direct reports branching below

If you are an RM or HOD, a scope-aware roster table appears below the line.

### 1.2 Data loads (on mount / when `emp.id` changes)
Three requests run in parallel (two inside one `Promise.all`, plus the hook):

**A. `useManagerChain(emp.id)`**: `GET /api/rms/hierarchy?employee_id=<encoded id>` with bearer and `cache:'no-store'`.
- Response 200: `{ "managers": ManagerSlot[], "direct_report_count": number }`. `ManagerSlot` is:
  ```ts
  { relationship_type: 'L1'|'L2'|'L3'|'L4'|'HOD',
    manager: { id, emp_code: string|null, full_name: string|null, designation: string|null,
               department: string|null, office_email: string|null, personal_email: string|null } | null }
  ```
  The array is ordered L1, L2, L3, L4, HOD (`CHAIN_ORDER`). Only levels that exist are present (from `employee_relationships` where `valid_to IS NULL`).
- Errors:
  - 401 `{error:'Sign in to continue.'}`
  - 400 `{error:'employee_id is required.'}`
  - 403 `{error:'You can only see your own reporting line.'}` (non-self without the Employees module)
- The hook's error strings are `json.error || 'Could not load the reporting line.'` and `'Could not reach the server.'`. **MyTeam ignores `error`.** A failure shows the same text as "nobody above you".

**B. Peers**: `GET /api/rms/orgchart?view=peers&employee_id=<id>` with bearer and `cache:'no-store'`. `.catch(() => ({}))`.
- Response: `{ "peers": PeerRef[] }`, where `PeerRef = { id, emp_code, full_name, designation, department, isSelf: boolean, directReports: number }`. It comes from RPC `org_peers(p_employee_id, p_include_self=true)`: everyone with the same active L1 in `employee_relationships`, `date_of_leaving IS NULL`, plus their L1 direct-report counts.
- The client maps each peer to `{ id, full_name, designation, department, isSelf: !!p.isSelf, direct_reports: p.directReports || 0 }`.
- **⚠ PARITY NOTE:** the orgchart route gates every `view` other than `tree` with `requireModule(req,'Employees')`. With `rms_config.enforce_module_access` ON, an ordinary employee gets 403 `{error:'Employees is not part of your access.'}`. The client reads `peersRes.peers || []` and so shows "no team-mates". With enforcement OFF, everyone gets data. The route also does not check that `employee_id` is the caller.

**C. Direct reports**: `GET /api/rms/hierarchy?employee_id=<id>&view=reports` with bearer and `cache:'no-store'`. `.catch(() => ({}))`.
- Response: `{ "reports": [{ id, emp_code, full_name, designation, department }] }`. These are L1 relationships (`type` defaults to `'L1'`; `?type=any` means all types), sorted by `emp_code`.

`busy = loading || chainLoading`. `mates = peers.filter(p => !p.isSelf)`. `chain = managers.slice().reverse()`, so the senior-most manager is at the top (display only).

### 1.3 Layout, in order (`.tm.tm--line`; `.tm--mobile` gives one column)
Panel 1 (`.tm-panel--lead`, border `--ez-brand-edge`):
1. Header: icon tile (LINE_ICON.line SVG, 15×15), title **"Where you sit"**, sub "Above you, beside you, below you, read from the reporting lines HR maintains".
2. While `busy`: `LineSkeleton` (4 skeleton rows: avatar disc and two bars).
3. Otherwise:
   - Label "Reporting line above you".
     - Empty: "Nobody above you. You are at the top of your chain."
     - Otherwise one `LineNode` per chain entry: avatar, name (`m.manager?.full_name`, `'-'` if null), sub = designation (`'-'`), rank pill = `'Head of Department'` for HOD, otherwise the literal `L1` / `L2` / `L3` / `L4`.
   - YOU band (`.tl-you`, brand-tint fill, brand-edge border, radius 14):
     - Head: YouDot (person SVG on a brand disc), "You" with sub "Managers above you, your team below".
     - Label "Your team-mates" + ` (N)` when N > 0.
     - Empty: "Nobody else shares your reporting manager, or you have no manager on record."
     - Otherwise chips: avatar, `full_name || '-'`, and small text `designation || '-'` plus ` · N report`/` · N reports` when `direct_reports > 0`.
   - Label "Your team" (branch).
     - Empty: "Nobody reports to you directly."
     - Otherwise a `LineNode` per report: name, sub = `[designation, department].filter(Boolean).join(' · ')` (`'-'` if empty), no rank.
4. Panel 2: `TeamRoster`, only when `essMenu.is_rm || essMenu.is_hod` (§1.5).

### 1.4 Avatar rules (`components/ess/team/ui.tsx`, pure, safe to copy)
- `initials(name)` = the first letters of the first two space-separated words, uppercased. `'?'` when there is no name.
- `hueOf(name)`: `h = 0; for ch of name: h = (h*31 + charCode) % 360`. Colour is `hsl(h, --ez-avatar-sat, --ez-avatar-light)` on `color-mix(pure 12%, surface)`.
- **Interactions: none.** Nodes and chips have no onClick. The only "interaction" is a `title` tooltip showing the full name on a truncated name. **Tapping a person opens nothing anywhere in the Team section.**

### 1.5 TeamRoster (RM / HOD only)
Props `{ employeeId, isRm, isHod }`. Initial `scope = isRm ? 'TEAM' : 'DEPT'`. It returns null if neither flag is set (the parent already gates this).

Request: `api('/api/ess/team?scope=' + scope, employeeId)`, i.e. `GET /api/ess/team?scope=TEAM|DEPT&employee_id=<id>`. It re-runs when the scope changes.

Server (`app/api/ess/team/route.ts`):
- Effective scope:
  - `DEPT` if asked and `ctx.menu.is_hod`.
  - `ORG` if asked and (`canCompany` or super admin).
  - Otherwise `TEAM`.
  - A non-HOD asking for DEPT silently gets TEAM.
- TEAM with no `is_rm` and not super admin returns 403 `{error:'Nobody reports to you, so there is no team roster to show.'}`.
- IDs come from RPC `ess_scope_employee_ids(p_employee_id, p_scope)`:
  - TEAM = `ess_direct_reports` (employees.l1_manager_id).
  - DEPT = active, non-test employees in (departments you head ∪ **your own department**), excluding you.
  - ORG = everyone active except you.
- Response: `{ "scope": "TEAM"|"DEPT"|"ORG", "rows": Row[] }`. Rows are ordered by `emp_code`:
  ```ts
  { id: string, code: string|null, name: string, designation: string|null,
    department: string|null, direct: boolean /* l1_manager_id === caller */,
    status: string, tone: 'ok'|'warn'|'info' }
  ```
- Status precedence (server side):
  1. If a resignation row exists in `employee_resignation` with status not in (SETTLED, WITHDRAWN): `status = "Notice period · LWD " + fmtDate(final_lwd || lwd_as_per_policy)`, tone `warn`.
  2. Else, if an APPROVED `leave_applications` row has `from_date <= today <= to_date`: `status = "On leave · back " + fmtDate(to_date + 1 day)`, tone `info`.
  3. Else `"Normal"`, tone `ok`.
- `fmtDate` = `toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'})`, e.g. "05 Oct 2026". It returns `'-'` for null.

Layout:
- Header: ROSTER_ICON. Title is "My department" (DEPT) or "My team: direct reports" (TEAM). Sub is "Everyone in the department you head" or "People whose reporting line ends with you".
  - Right side: when the person is BOTH RM and HOD, a segmented control (`aria-pressed`) with "Direct reports" | "Whole department".
  - Otherwise a count chip `rows.length`, shown once rows have loaded.
- Error: `<p class="tm-note warn">{err.message}</p>` (warning tint and colour).
- Loading (`rows === null`): no spinner. The header and footnote render and the table is absent.
- Empty: icon + "Nobody in this scope yet."
- Table columns:
  - Code (`code || '-'`, faint mono)
  - Name (bold)
  - Designation (`|| '-'`)
  - DEPT only: "Reports to you" = `Direct`, or a dim `-`
  - Status pill, right-aligned, with a leading dot in currentColor: `ok` = positive/positiveTint, `warn` = warning/warningTint, `info` = info/infoTint
- Footnote (`.tm-note`, sunken, brand-edge left border):
  - DEPT: "DEPT scope: everyone in the department(s) you head. Company-wide headcount is under the Company tab."
  - TEAM: "TEAM scope: your direct reports only. Your HOD sees this list plus every other team in the department."
- Rows are not clickable.

**⚠ PARITY NOTE, three definitions of "reports to you":**
- Team line: `employee_relationships` L1 (`valid_to IS NULL`).
- Roster and `is_rm`: `employees.l1_manager_id` (active, non-test).
- Performance: `employees.l1_manager_id OR l2_manager_id`, `date_of_leaving IS NULL`.

They can disagree.

### 1.6 "View someone's profile"
- Nothing in MyTeam or TeamRoster opens a profile.
- The only "open another person" feature is **outside** the Team section, in the portal top bar of `components/ess/PortalPage.tsx`. It shows "View team member" when `loadAccessScope(myId).canViewOthers`.
- That button opens a modal: "Open a team member's portal", the access line, a search box "Search name or code…", and a list.
  - Picking a person re-renders `<EmployeePortal employeeId={viewing.id} adminMode>` under a dark bar: "`{SCOPE} VIEW` · Viewing **Name** · code · designation", with a [Back to my portal] button.
  - Empty list text: "No matching employees."
- `loadAccessScope` uses direct anon Supabase queries:
  - `ess_accounts.select('id').eq('employee_id', id).maybeSingle()`
  - `ess_user_roles.select('role_id').eq('ess_account_id', acct.id).eq('is_active', true)`
  - `ess_roles.select('role_name, scope').in('id', roleIds)`
  - `employees.select('company_id, department_id, location_id').eq('id', id).maybeSingle()`
  - `employees.select('id, emp_code, full_name, designation, departments!employees_department_id_fkey(dept_name), locations!location_id(location_name)').eq('employment_status','Active').neq('is_test', true).order('emp_code')`, then `.eq('l1_manager_id', id)` (TEAM) / `.eq('department_id', …)` (DEPT) / `.eq('location_id', …)` (BRANCH) / `.eq('company_id', …)` (COMPANY) / no filter (ORG), `.limit(5000)`
  - Best scope rank: SELF 0 < TEAM 1 < DEPT 2 < BRANCH 3 < COMPANY 4 < ORG 5. `canViewOthers = employees.length > 0`.
- Covered here only for completeness. Detail belongs to the portal-shell spec.

---

## 2. Org Chart section

### 2.1 What renders
- `AdminModuleHost moduleKey="org-chart"` resolves to `ADMIN_MODULE_COMPONENTS['org-chart'] = dynamic(() => import('@/app/dashboard/org-chart/page'), { ssr:false, loading })`.
- **It is the exact same default export the admin dashboard route `/dashboard/org-chart` renders.** It is not a copy and not an iframe.
- Loading placeholder: "Loading module…" (muted, 13px, centred, padding 40).
- Unknown key fallback: "This module is not available inside ESS yet. Open it from the Admin dashboard."
- The page uses its own hardcoded hex palette `P` (purple `#7C3AED` etc.), **not** `lib/ui` tokens. It does not follow dark mode. In RN, map it to tokens: navy→ink, purple→brand, purpleDark→brandDeep, purpleBg/purpleLight→brandTint, border→line, muted→muted, green→positive, red→critical, amber→warning, blue→info.

### 2.2 Who sees what
- Identity: `useGrant()` calls `GET /api/rms/me` with bearer. The response is `{ grant: Grant, managers: ManagerSlot[] }`, and `grant.employeeId` is the signed-in viewer.
  - Note: in "view team member" mode this is still the viewer, not the person being viewed.
- The tree endpoint (`view=tree`, the default) needs only `requireDashboardUser`, so **every signed-in employee can load it**.
- Company pinning: `companyFilter(grant, requested)`. A caller without `crossCompany` (and with a known `companyId`) is always forced to their own company, whatever they request, including `ALL`. Cross-company callers can pick a company or ALL (`null` means every company).
- The "⚠ Diagnostics" button shows only if `canSee(grant,'Employees')`. That is true whenever `grant.enforced` is false, or when the person has ≥ VIEW on Employees. The diagnostics API is `requireModule('Employees')`, so the same rule applies.

### 2.3 Data loads
1. Companies, via the direct anon Supabase query `supabase.from('companies').select('id, company_name').eq('status', 'Active').order('company_name')`. This goes through `scopedCompanies(grant, data)`: non-cross callers see only their own company.
2. Own company, via the direct anon Supabase query `supabase.from('employees').select('company_id').eq('id', grant.employeeId).maybeSingle()`. Default selection = own company if it is in the list, else the first company, else `''`.
3. The tree: `GET /api/rms/orgchart?company_id=<companyId || 'ALL'>` with bearer and `cache:'no-store'`. On failure it falls back to `{tree: []}`. The page reloads on company change.
   - Response `{ "tree": OrgTreeNode[] }`:
     ```ts
     { id, companyId, empCode: string|null, fullName: string|null, designation: string|null,
       department: string|null, grade: string|null, managerId: string|null /* L1 */,
       depth: number, directReports: number, isHod: boolean }
     ```
     It comes from view `v_org_tree`: active (`date_of_leaving IS NULL`) employees, recursive over L1 `employee_relationships`, depth capped at 15, cycle-safe, ordered by depth. `isHod` = named as somebody's HOD relationship.
   - 400 `{error:'company_id is required.'}` if no company resolves.
4. Diagnostics (only when toggled on), in parallel with bearer:
   - `GET /api/rms/orgchart?view=orphans&company_id=<id>` returns `{ orphans: [{ emp_code, full_name, designation, department }] }` (RPC `org_orphans`).
   - `GET /api/rms/orgchart?view=span&company_id=<id>` returns `{ span: [{ emp_code, full_name, designation, department, direct_reports }] }` (view `v_span_of_control`, desc, limit 20).

### 2.4 Pure tree helpers. **Import directly in RN**
`lib/rms/tree.ts` has no imports at all and is pure:
```ts
import { buildForest, flatten, pathTo, countNodes, type TreeNode, type TreeInput } from '<shared>/lib/rms/tree'
```
- `buildForest(rows)`: a row whose `managerId` is not in the list becomes a root. Roots and every sibling group are sorted by `fullName.localeCompare`.
- `flatten(forest)`: depth-first, root first.
- `pathTo(forest, id)`: root→node, inclusive. Returns `[]` if not found.
- `countNodes(forest)`.

`lib/rms/resolve.ts` (`companyFilter`, `scopedCompanies`, `canSee`, `defaultCompanyId`, `emptyGrant`) is pure too, but it imports `./modules.ts` and `./screens.ts` **with `.ts` extensions** (`allowImportingTsExtensions`). Metro or Babel must allow that, or the module needs re-exporting.

### 2.5 Derived view state
- `tierOf(n)`:
  - no `managerId` → `root` "Top of chain" (amber `#B45309`)
  - `isHod` → `hod` "Department Head" (blue `#1D4ED8`)
  - `directReports > 0` → `manager` "Manager" (purple `#7C3AED`)
  - else `ic` "Individual Contributor" (grey `#9CA3AF`)
- **My chain** (`chainForest`), used when `grant.employeeId` is in the forest: a single path made of ancestors (one child each), then ME, then my direct children as leaves (no grandchildren). Otherwise null.
- `chainOnly` defaults to **true**. `inChain = chainOnly && !!chainForest`. In chain mode the collapse set is ignored (nothing collapses).
- `reportIds` = the ids of my direct children in the forest. These cards are painted green wherever they appear.
- Default collapse (`resetToDefault`, runs whenever rows change): collapse every node with `depth >= 1`, so you see roots plus their direct reports.
- Auto fit (`fitToScreen`, 60 ms after the forest or collapse set changes, and on the button):
  - `scale = min((containerW-40)/naturalW, (containerH-40)/naturalH, 1)`
  - `zoom = clamp(round(scale*100), 15, 140)`. It never upscales above 100.

### 2.6 Layout, in order
1. Title row:
   - 38×38 gradient tile with 🌳
   - **"Organisation chart"**
   - pill: "Loading…" or "`{total} people`" (`countNodes(forest)`, the whole company, not just the chain)
2. Sub (indented 50px): "Read straight from the reporting lines set on the Employee Master and the org-chart import. Moving somebody's manager there moves them here."
3. Toolbar card (wraps):
   - Company `<select>`: "All companies" (`''`) plus the company list. Non-cross users see "All companies" and their own company; picking All still returns their own company from the server.
   - Search input, placeholder "Find by name or employee code…" with 🔍. Enter or the **[Find]** button runs search.
   - Divider.
   - Zoom pill: [−] (−10, min 15), `{zoom}%`, [+] (+10, max 140).
   - **[⛶ Fit to screen]**.
   - Divider.
   - Chain toggle, only if `chainForest` exists: shows "🏢 Show whole company" (filled purple) when in chain mode, or "👤 Show my chain" when not.
   - Only when not in chain mode: **[⤢ Expand all]** (clears the collapse set) and **[⤡ Collapse to my level]** (`resetToDefault`).
   - **[⚠ Diagnostics]** toggle (filled when on), if `canSee(grant,'Employees')`.
   - **[⬇ Download JPEG]**, right-aligned gradient. Disabled when downloading or the forest is empty. It shows "Preparing…" while busy.
4. Legend: four pills (coloured dot + tier label), in order root, hod, manager, ic.
5. Body row:
   - Chart canvas: dotted background, `overflow:auto`, `maxHeight:75vh`, padding 28.
     - Loading: "Loading the chart…"
     - Empty forest: "No reporting lines for this company yet. Import the org chart from Bulk Uploader → Org Structure & Roles."
     - Otherwise a scaled wrapper (`transform: scale(zoom/100)`, origin top centre) holding a nested `<ul class="org-tree">` / `<li>`.
   - DiagPanel (300px), when on. Two cards:
     - "No one to approve for them" (red ⚠). Each orphan shows **name**, mono code, and `designation · department`. Empty: "Nobody: every active employee has a manager or is a named department head."
     - "Widest inboxes" (📊). The top 8 span rows show name, department (or `-`), and the count (red if ≥ 15, else purpleDark).
     - Both cards show "Loading…" while loading.

### 2.7 Card (`OrgCard`, 172px wide, radius 12)
- 5px top bar in the tier colour.
- Top-right badge `👥 {directReports}` when > 0.
- 42px gradient avatar disc with initials.
- Name (bold 12, 2-line clamp).
- `empCode` (mono 10, `-`).
- Designation (2-line clamp, `-`).
- Tier label pill (uppercase 8.5).
- Bottom ribbon: "YOU ARE HERE" (purple gradient) if self. "REPORTS TO YOU" (green gradient) if a direct report and not self.
- Report cards get a green tint background and border. A highlighted card (search hit) gets a purple border and ring.
- `title` tooltip: `"{name} · {designation}[ · {department}]"`.
- Expand/collapse button, centred under the card, when it has children:
  - collapsed: `+ {directReports}`, tooltip "Show N direct report(s)"
  - expanded: `−`, tooltip "Collapse this branch"
- Hover lifts the card 3px (CSS).
- **Tap on a card does nothing.** No profile opens and there is no navigation. The only per-card action is the expand/collapse toggle.

Connectors are drawn in pure CSS (`app/globals.css .org-tree`):
- Each `ul` is a flex row with padding-top 22.
- Each `li` uses `::before`/`::after` with 1.5px `#C9BFF0` borders to make the horizontal bus and the vertical drop.
- `li.has-children > .org-node::after` draws a 22px stub down.
- An only-child gets no bus.

### 2.8 Search behaviour
- `needle = q.trim().toLowerCase()`. Empty does nothing.
- It finds the **first** node in `flatten(forest)` (the whole forest, not the visible chain) where `fullName` or `empCode` contains the needle.
- No match: nothing happens (no message).
- On a hit:
  - un-collapse every ancestor on `pathTo`
  - set `highlightId`
  - after 60 ms, `scrollIntoView({behavior:'smooth', block:'center', inline:'center'})`
- **⚠ PARITY NOTE:** in chain mode (the default), a hit outside your chain is not rendered. Nothing visible happens, and there is no hint to switch to "whole company".

### 2.9 Download JPEG
- Uses dynamic `html2canvas`, scale 2, background page colour.
- Line clamps are removed in the clone.
- Output: `canvas.toDataURL('image/jpeg', 0.92)`, file `org-chart-{company-name slug, or "all_companies"}.jpg`.
- The transform is reset to `none` during capture.

---

## 3. Performance section (`components/ess/Performance.tsx`)

### 3.1 Top-level flow
1. **Role detection** (direct anon Supabase, on mount):
   ```ts
   supabase.from('employees').select('id', { count: 'exact', head: true })
     .or(`l1_manager_id.eq.${employeeId},l2_manager_id.eq.${employeeId}`)
     .is('date_of_leaving', null)                                // → reportees
   supabase.from('departments').select('id', { count: 'exact', head: true })
     .eq('hod_employee_id', employeeId)                          // → deptCount (0 if error)
   supabase.from('employees').select('id', { count: 'exact', head: true })
     .eq('hod_id', employeeId).is('date_of_leaving', null)       // → hodOf
   ```
   `roles = { isRM: reportees > 0, isHOD: deptCount > 0 || hodOf > 0, reportees, deptCount }`.
   This is **not** `/api/ess/menu`. It counts L2 reports too.
2. **Module probe**: `supabase.from('pms_periods').select('id').limit(1)`. If `error.code === 'PGRST205'` (relation missing), render `ModulePending`.
3. Rendering:
   - `moduleReady === false`: ModulePending.
   - `!roles`: `<div class="pms"><div class="k">Loading…</div></div>`.
   - The probe may still be pending when the content renders.
4. **Audiences (scope chips)**, `scopes` in order:
   - `me` "Me" (always)
   - `team` "My team ({reportees})" if isRM
   - `dept` "My department" if isHOD

   The chip row (`role="tablist"`, class `chips`/`chip sel`) renders **only when there is more than one scope**. An ordinary employee sees no chips.
5. **Tab strip** for the active scope (bottom border; the active tab has brand colour and underline). The active tab's `blurb` shows under it in `.k` (11px muted). Defaults: me→`dashboard`, team→`team`, dept→`finalise`. Each scope remembers its own tab.

   | Scope | Tabs (`k` · label · blurb) |
   |---|---|
   | me (`EMP_TABS`) | `dashboard` My Dashboard · "where you are in the cycle, and what is owed next"; `kras` My KRAs · "four to ten, totalling exactly 100"; `oneToOne` One-to-One Log · "every discussion, and who has acknowledged it"; `self` Self Rating · "rate your own delivery on each KRA"; `result` My Result · "the final rating and the feedback behind it"; `analytics` My Analytics · "how you and your manager saw the same work" |
   | team (`MGR_TABS`) | `team` Team Dashboard · "who is where, worst deadline first"; `approve` KRA Approval & One-to-One · "check their sets, then log the discussion"; `rate` Rate My Team · "rate each KRA against what they delivered"; `pip` PIP Request · "raise one, and HR decides whether it starts"; `analytics` Team Analytics · "distribution and gaps, for information" |
   | dept (`HOD_TABS`) | `finalise` Review & Finalise · "sign off, exit and notice cases first"; `feedback` Feedback & Recognition · "what they read, and what they receive"; `deptAnalytics` Department Analytics · "the department against the company" |

6. Layout order: `CycleHeader` → scope chips (if >1) → tab strip → blurb → `MySide` | `TeamSide` | `DeptSide`.
7. **CTA routing** (`GO_TO`, used by CycleHeader's NextAction button). It sets both scope and tab:
   - `mine`→(me, kras)
   - `self`→(me, self)
   - `oneone`→(me, oneToOne)
   - `team`→(team, approve)
   - `dept`→(dept, finalise)
   - `fill`→(dept, deptAnalytics)
   - unknown→(me, dashboard)

**Empty / pending states:**
- `NoPeriod` (card): title "No period is open", text "Nothing is running right now. A period opens when HR publishes the cycle configuration, and everybody eligible is enrolled at that moment. There is nothing to do here until then."
- `ModulePending`: title "Waiting on migration 066", body "The performance module's tables do not exist in the database yet. These screens and the whole approval flow are built; they have nothing to read until `supabase/migrations/066_pms_module.sql` is applied. That file creates 15 tables, 9 functions, 10 views and 2 triggers. It is handed to Nayan rather than run from here. This project does not apply schema changes itself. Nothing on this page is broken; it is waiting."
- Per-side loading: `<div class="k">Loading…</div>`.

### 3.2 CycleHeader (always on top; `components/pms/CycleHeader.tsx`)
Props: `roles={ isEmployee:true, isRM, isHOD }`, `onGo={goToAction}`.

Direct anon Supabase queries:
```ts
supabase.from('pms_periods')
  .select('id, period_name, period_code, financial_year, period_no, period_start, period_end, kra_window_from, kra_window_to, self_rating_from, self_rating_to, rm_review_from, rm_review_to, finalise_from, finalise_to, result_publish_date, status, pms_policies(frequency)')
  .in('status', ['KRA_SETTING','IN_PROGRESS','SELF_RATING','RM_REVIEW','FINALISATION','PUBLISHED'])
  .order('period_start', { ascending: false }).limit(1).maybeSingle()
// then, in parallel:
supabase.from('pms_employee_goals').select('weightage, status').eq('period_id', periodId).eq('employee_id', employeeId)
supabase.from('pms_one_to_one').select('employee_ack, manager_ack').eq('period_id', periodId).eq('employee_id', employeeId)
supabase.from('pms_overall_rating').select('workflow_status, published_at, self_score, final_score, final_rating').eq('period_id', periodId).eq('employee_id', employeeId).maybeSingle()
// only if isRM || isHOD:
supabase.from('employees').select('id').or(`l1_manager_id.eq.${employeeId},l2_manager_id.eq.${employeeId}`).is('date_of_leaving', null)
supabase.from('pms_employee_goals').select('employee_id, status').eq('period_id', periodId).in('employee_id', ids)
```
**⚠ PARITY NOTE:** this period query has **no company filter**. `usePeriod` below filters by the employee's company and uses a different status rule (`NOT IN ('CLOSED','SCHEDULED')`). With several companies, the header and the tabs can describe different periods. `/api/ess/pms` uses company plus latest `period_start` with no status filter: a third rule.

Progress, built here. Values are not `settled()` before use. `stageStates`/`nextAction` call `settled` internally.
- `kraCount` = number of goal rows; `weightageTotal` = sum of their weightage.
- `kraSubmitted` = any goal status in `GOAL_SENT` (PENDING_ONE_TO_ONE, PENDING_RM_APPROVAL, LOCKED, SENT_BACK) or `reached(wf,'KRA_DRAFT')`.
- `kraApproved` = any goal `LOCKED` or `reached(wf,'KRA_LOCKED')`.
- `oneToOneLogged` = there is at least one 1-on-1 row. `oneToOneBothConfirmed` = some row has both acks.
- `selfSubmitted` = `self_score != null` or `reached(wf,'SELF_SUBMITTED')`.
- `rmL1Done`, `rmL2Done`, `finalised` = `reached` RM_L1_DONE, RM_L2_DONE, FINALISED.
- `published` = `published_at` is set or `reached(wf,'PUBLISHED')`.
- Queues: `kraApprovals` = count of reportees with ≥1 goal in PENDING_RM_APPROVAL and none LOCKED.
- Rules are always `DEFAULT_RULES` (minKra 4, maxKra 10, total 100, minPerKra 5). The policy is not read here.

Failure handling:
- PGRST205 → pending=true, EMPTY.
- No row → EMPTY: naming `{title:'No review period is open', sub:'Nothing is running right now', code:''}`.
- Any throw → EMPTY.
- While loading: a 132px sunken block at 50% opacity.

Layout:
1. Head panel (gradient surface→canvas, 1px line, radius R.sm):
   - `h2` = `naming.title`.
   - Sub line = `naming.sub` + code chip (`naming.code`, tooltip "The code your HR team files this under").
   - Right helper text: "Hover any stage to see what happens in it." When pending it reads "These are the stages every appraisal goes through. The module is not switched on in this database yet, so nothing is filled in."
   - Then `CycleStepper`.
2. `NextAction` card.
3. `StatCards` (grid, auto-fit, min 178px).

**Period naming** (`lib/pms/language.ts`, pure):
- `title = periodSpan(start, end) || period_name || period_code || 'Review period'`. Span examples: "October to December 2026", "December 2026 to February 2027", or a single month.
- `sub = [whenPhrase, frequencyPhrase(freq).toLowerCase(), positionPhrase(period_no, perYear)]` joined with " · ".
  - whenPhrase: "This quarter" / "Next …" / "Last …".
  - frequency: MONTHLY "Every month", QUARTERLY "Every three months", HALF_YEARLY "Twice a year", ANNUAL "Once a year", otherwise "Review cycle".
  - position: "3rd of 4 this year". perYear: M 12, Q 4, H 2, A 1.
- `code = [period_code, financial_year]` joined with " · ".

**Stepper** (`CycleStepper`):
- 7 stages from `STAGES`, laid out as a grid of equal columns.
- Each stage: a 28px dot, a label (2-line min-height), an optional detail, and a hover/focus tooltip with the blurb (190px, dark).
- State colours:
  - done: dot `C.positive` with a ✓ SVG
  - active: dot `C.brand`, ring `C.brandTint`, numeral, pulsing ring, label brand bold
  - blocked: dot `C.warning`, ring `C.warningTint`, "!" SVG, pulse, label warning bold
  - upcoming: dot `C.sunken`, ink `C.muted`, label `C.faint`
- Connector: `C.line`, filling `C.positive` when the previous stage is done.
- a11y label: "Step n of 7: Label (completed | in progress now | waiting, cannot start | not started)".
- Details:
  - kra: `"{n} KRAs · {w}%"` when n > 0
  - self: `"{humanDate(from)} – {humanDate(to)}"`
  - finalise: `"by {humanDate(to)}"`

STAGES (`lib/pms/cycle.ts`):

| n | key | label | blurb |
|---|---|---|---|
| 1 | kra | KRA Setting | Agree what you will be measured on this period. |
| 2 | oneToOne | One-to-One | You and your manager discuss those KRAs and both confirm it happened. |
| 3 | lock | Weightage Lock | Your manager approves the set. After this the KRAs cannot change. |
| 4 | self | Self Rating | Rate your own delivery against each KRA. |
| 5 | review | Manager Review | RM L1 rates you, then RM L2 reviews. |
| 6 | finalise | HOD Finalise | The HOD settles the final number for the department. |
| 7 | result | Result | Your result and feedback are published to you. |

(Stage 6 blurb exact text: "The HOD settles the final rating for the department.")

**NextAction card** (`NextAction.tsx`):
- `action === null`: positiveTint panel with a ✓ disc. Title "Nothing needs you right now". Text "You are up to date on this cycle. You will see a task here the moment one is yours."
- Otherwise:
  - Background: `blockedBy` set → `C.warningTint` + warning border; `overdue` → `C.critical`; `due`/`info` → `C.brand`. Text is `C.onAccent`.
  - Eyebrow: "Waiting" (blocked) / "Overdue" / "Your next step".
  - Title.
  - Why line, prefixed with **blockedBy** in bold when set.
  - Deadline chip from `daysLeft`: "N days overdue" / "due today" / "1 day left" / "N days left".
  - CTA button (`action.cta`), which calls `onGo(action.tab)`.
- Every title, why and CTA string comes from `nextAction()` (quoted in §3.9).

**StatCards** (4). Value counts up over 620 ms unless reduced motion is on.
1. "Your KRAs": value `kn`, unit "goal"/"goals".
   - tone: neutral if 0; good if 4–10; else warn. fill `min(1, kn/4)`.
   - meaning: "You need between 4 and 10." / "{4-kn} more to reach the minimum of 4." / "That is {kn-10} over the limit of 10." / "Within the 4–10 allowed."
2. "Weightage used": value `wt`, unit "of 100%".
   - tone: good if =100, bad if >100, else warn. fill `wt/100`.
   - meaning: "Adds up exactly. Nothing to change." / "{wt-100}% too much. Take some off a goal." / "{100-wt}% still to share out across your goals."
3. "How often": value = frequencyPhrase or "Not set". meaning "This one covers {Oct – Dec 2026}." or "Your HR team sets the dates."
4. "Your last result":
   - If `final_score != null`: value `final_score`, unit `"· {final_rating}"`, tone brand, meaning "Published for the previous period." (it is actually the current period's row ⚠).
   - Else: value "Not yet", meaning "Your first result appears here once a cycle finishes."
- Tone colours: neutral ink/surface/line; brand brand/brandTint/brandEdge; good positive/positiveTint; warn warning/warningTint; bad critical/criticalTint.

### 3.3 MySide data (`usePeriod` + `loadPeriodData`); every query is direct anon Supabase
```ts
// usePeriod(employeeId)
supabase.from('employees').select('company_id').eq('id', employeeId).maybeSingle()
supabase.from('pms_periods').select('id,period_code,status')
  .not('status', 'in', '("CLOSED","SCHEDULED")')
  [.eq('company_id', companyId) if known]
  .order('period_start', { ascending: false }).limit(1).maybeSingle()
supabase.from('pms_overall_rating')
  .select('workflow_status,self_score,final_rating,final_rating_code,is_readonly')
  .eq('employee_id', employeeId).eq('period_id', period.id).maybeSingle()
// MySide: who
supabase.from('employees').select('emp_code,full_name,designation').eq('id', employeeId).maybeSingle()
// loadPeriodData (sequential)
supabase.from('pms_employee_goals').select('id,seq_no,kra_title,kpi_metric,target_value,category,weightage,status')
  .eq('employee_id', employeeId).eq('period_id', period.id).order('seq_no')
supabase.from('pms_one_to_one').select('id,discussion_type,discussion_date,mode,discussion_points,employee_ack,manager_ack')
  .eq('employee_id', employeeId).eq('period_id', period.id).order('discussion_date', { ascending: true })
supabase.from('pms_reviews').select('goal_id,rater_role,rating,achievement_value,comments')
  .eq('employee_id', employeeId).eq('period_id', period.id)
supabase.from('pms_feedback').select('appreciation_remark,improvement_feedback,development_plan,visible_to_employee')
  .eq('employee_id', employeeId).eq('period_id', period.id).maybeSingle()
```
`usePeriod` runs separately inside MySide, TeamSide and DeptSide, so switching scope re-queries.

Derived values (MySide):
- `kras` = the draft if editing; else the goal rows mapped to `Kra`; else **4 blank rows** (`DEFAULT_RULES.minKra`) as `{seq_no:i, kra_title:'', kpi_metric:'', target_value:'', category:'BUSINESS', weightage:0}`.
- `lockGate = canLockWeightage(logs)`, `publishGate = canPublishResult(logs)`.
- `locked = goals.length > 0 && every goal.status === 'LOCKED'`.
- `selfSubmitted = workflow_status set && !== 'NOT_STARTED' && self_score != null`.
- `published = feedback.visible_to_employee || overall.final_rating != null`.
- `lines` (per goal): self = SELF rating, rmL1, rmL2, final = HOD ?? RM_L2 ?? RM_L1.
- `selfRows` = the draft, or per goal `{goalId, title, weightage, category, achievement: SELF.achievement_value||'', rating: SELF.rating|null, comment: SELF.comments||''}`.
- `progress = settled({...})`. Same fields as `/api/ess/pms`; rmL1Done/rmL2Done = any line has that rating; finalised = `final_rating != null`.
- `stage = currentStage(progress)`.
- `states = stageStates({ label: period_code }, progress, today)`. **No windows are passed**, so this inner stepper is never window-blocked (⚠ it can differ from CycleHeader's stepper).
- `today = localToday()`: the local calendar date as `yyyy-mm-dd`, not UTC.

A message banner sits above every MySide tab when `msg` is set: `.banner.b-blue` with ℹ️ and the message.

### 3.4 Tab: My Dashboard (`DashboardTab`)
1. Card. Title `"{full_name} · {emp_code}"`. Sub = `[designation, department, "RM L1: x", "RM L2: y", "HOD: z"]`, keeping only truthy values; in ESS only the designation is passed.
   - Body: a 7-dot stepper (`.stepper`). The step class is `done` if the state is done, else `now` if key === current stage, else plain. Dot = index+1, `t` = label, `d` = detail ("N KRAs" for kra when goals exist).
2. A 4-stat grid (`.grid.g4`):
   - "Owed from you" (accent: brand background, onAccent text): value `ACTION_LABEL[stage]`, note `ACTION_NOTE[stage]`:
     - kra: "Write your KRAs" / "4 to 10, totalling 100"
     - oneToOne: "The KRA discussion" / "Both of you have to acknowledge it"
     - lock: "Waiting on your manager" / "They lock the weightages once acknowledged"
     - self: "Your self rating" / "Rate every KRA, then submit (it locks)"
     - review: "With your manager" / "Nothing owed from you right now"
     - finalise: "With the HOD" / "Nothing owed from you right now"
     - result: "Read your result" / "Acknowledge once you have read it"
   - "My KRAs": value `goals.length`.
     - `setOk = kraCount >= 4 && weightage === 100`, where weightage is the sum over `kras`, including the draft/blank rows.
     - note: "Totalling {w}. The set is valid", or "Totalling {w}. Needs 4–10 KRAs at exactly 100" with tone warn (warningTint).
   - "How often": value literally "This period", note `period_code`.
   - "Last time": value `final_rating` (current period ⚠) + ` · {band label}`, or `-`. Note "No previous period on record" if `self_score` is null, else `"Weighted score {self_score}"`.
3. `.banner.b-blue`: "This is a **developmental** review. The rating is not linked to any increment, variable pay, bonus or CTC. It exists to give you feedback and to decide what support you get next. Recognition here is a certificate, a nomination or an award, never a cash component."

### 3.5 Tab: My KRAs (`KraTab`): goal creation and editing
Pure logic is in `lib/pms/kra.ts` (`checkKras`, `canAdd`, `canDelete`, `meter`, `suggestSplit`, `CATEGORIES`, `CATEGORY_LABEL`).

Banner at top:
- If `locked`, `.b-amber` 🔒: "Your weightages are **locked**. They were settled in the KRA one-to-one and acknowledged by both of you, which is what makes them the thing your rating is measured against. A change now needs your manager to reopen them."
- Otherwise `.b-amber` ⚠️: "You write your own KRAs and weightages, but a **one-to-one with your manager is required before they lock**. {lockGate.because}"

Weightage meter (`.wmeter`, sunken):
- Big number = `check.total`, coloured ok / bad / plain.
- Progress bar: green if good, red if bad, else amber. Width `meter.pct`.
- Text below: `"{meter.says} · {count} KRA|KRAs (minimum 4, maximum 10)"`.
  - meter.says: total=100 → "Totals 100. Ready to send."; >100 → "{total}: that is {short} too many."; else "{total} of 100, {-short} still to allocate."
- When not locked, a **[+ Add KRA]** ghost button. It is disabled when there are 10 rows, with tooltip "10 is the maximum. Merge two before adding another." It appends `{seq_no: len+1, '', '', '', 'BUSINESS', 0}`.

Card "My KRAs". Sub: "At least 4, at most 10, and the weightages must total exactly 100."
- Table columns: `#` | KRA / objective | KPI metric | Target | Category | Weightage (number) | (remove, when not locked).
- Per row:
  - `kra_title` input, placeholder "What you are accountable for"
  - `kpi_metric` input, placeholder "How it is measured"
  - `target_value` input, placeholder "The number to hit"
  - category select: Business, Process, People, Customer, Compliance, Learning (values `BUSINESS…LEARNING`)
  - weightage number input, min 0, max 100, `Number(v) || 0`. Red border (`--ez-critical`) when the row is in `check.thin` (below 5).
  - All inputs are read-only when locked.
- Remove **[×]**: disabled at ≤ 4 rows, tooltip "4 is the minimum. Edit this one instead of removing it." Removing renumbers `seq_no` from 1.
- Empty (unreachable in practice): "Nothing written yet" / "Add 4 to 10 KRAs. They are what your rating will be measured against, so they are worth the time."
- Faults banner (`.b-red`), when any: "**Before this can be sent:**" followed by a list, each item `KRA {seq}: ` + message. Messages in `checkKras` order:
  - count < 4: "Add {4-count} more. A rating needs at least 4 KRAs to rest on."
  - count > 10: "Remove {count-10}. Past 10 the weightages get too thin to mean anything."
  - total ≠ 100: "{d} short of 100. Weightage has to total exactly 100, not at least." or "{-d} over 100. Take {-d} off somewhere before this can be sent."
  - per row with a title and weight < 5: "Weightage {w} is below the minimum of 5. A KRA carrying less than that is not worth rating separately."
  - per row with an empty title (after the thin checks): "This row has no KRA written in it yet."
  - `canSubmit = faults.length === 0`
- Buttons (when not locked):
  - Primary: "Saving…" / "Send to my manager" / "Cannot send yet: {n} to fix". Disabled if `!canSubmit || saving`.
  - When total ≠ 100 and rows > 0: ghost **"Split 100 evenly"**. It sets weightages to `suggestSplit(n)` (floor(100/n) each, remainder on row 1).

**Submit action**:
```ts
supabase.from('pms_employee_goals').insert(
  kras.map(k => ({ seq_no, kra_title, kpi_metric, target_value, category, weightage,
                   employee_id: employeeId, period_id: period.id, status: 'PENDING_RM_APPROVAL' })))
```
- Success: msg "Sent to your reporting manager.", draft cleared, data reloaded.
- PGRST205 error: "The performance module is not live yet: migration 066 has not been applied."
- Any other error: the raw `error.message`.

**⚠ PARITY NOTES:**
1. Per the repo DDL, `pms_employee_goals.company_id` is `NOT NULL`, there is no default, and no trigger fills it. This insert omits it, so it should fail with a not-null violation unless the live DB differs. Verify on live.
2. The form stays editable after submission (status PENDING_RM_APPROVAL, not LOCKED). A second submit re-inserts the same `seq_no`s and hits `UNIQUE(period_id, employee_id, seq_no)`. There is no update/upsert path and no SENT_BACK edit path.
3. The rules are the hardcoded `DEFAULT_RULES`. The policy's own min/max/total are ignored here (the DB `pms_validate_kras` uses the policy).

### 3.6 Tab: One-to-One Log (`OneToOneTab`)
Logic is in `lib/pms/oneToOne.ts` (`canLockWeightage`, `canPublishResult`, `logRows`, `ackState`, `waitingOn`, labels).

1. Gate banner:
   - Lock open → `.b-green` ✓ "The KRA one-to-one is acknowledged by both of you, so your **weightages are locked**."
   - Otherwise `.b-amber` ⚠️ "Your weightages are **not locked yet**. {lock.because}"
2. Card "One-to-one discussion log". Sub "Every discussion stays on record: KRA setting, mid-period, and the final review."
   - Columns: Date | Type | With | What was discussed | You | Manager.
   - Rows = `logRows(logs)`: the logs sorted by date, then placeholder rows appended for KRA_SETTING and/or FINAL_REVIEW if none is logged.
   - Date = `humanDate` ("1 Jan 2027") or `-`.
   - Type pill: KRA_SETTING `p-brand`, MID_PERIOD `p-blue`, FINAL_REVIEW `p-amber`, ADHOC `p-grey`. Labels "KRA setting", "Mid-period check-in", "Final review", "Ad hoc".
   - With = the literal "your manager".
   - Discussed = `discussion_points` or `-`. A placeholder row shows `TYPE_PURPOSE[type]` in muted text:
     - KRA_SETTING: "Settles the KRAs and their weightages. Until both sides acknowledge this, the weightage cannot be locked."
     - MID_PERIOD: "A course correction while there is still time to act on it. Optional unless the policy says otherwise."
     - FINAL_REVIEW: "The conversation about the rating, held before it is published. The result cannot be published without it."
     - ADHOC: "Anything else worth having on record."
   - You / Manager: `p-green` "✓ acknowledged" or `p-grey` "not yet".
   - Footer: "Both sides have to acknowledge. One tick on its own is a manager asserting a conversation happened; two is a record worth relying on later." When the publish gate is shut, ` {publish.because}` is appended.
3. Card "Log a discussion". Sub "Recorded against this period, and shown to your manager to acknowledge."
   - Date (date input).
   - Type select (default KRA_SETTING; KRA setting / Mid-period check-in / Final review / Ad hoc).
   - How select (default IN_PERSON; In person / Video call / Phone).
   - Textarea "What was discussed", placeholder "Weightage changes and why, targets agreed, support asked for".
   - Muted purpose text for the selected type.
   - Button: "Saving…" / "Log it and acknowledge". Disabled until there is a date and non-blank points, and while saving. Clicking clears the date and points immediately.

**Insert**:
```ts
supabase.from('pms_one_to_one').insert({ period_id, employee_id, discussion_type, discussion_date, mode,
  discussion_points, employee_ack: true, employee_ack_at: new Date().toISOString() })
```
- Error: the top banner shows `error.message`. Success: reload.
- The employee cannot acknowledge a manager-logged row. There is no ack button.
- **⚠ PARITY NOTE:** the DDL has `company_id NOT NULL` and `manager_id NOT NULL`, and both are omitted. Expect a failure unless the live schema differs.

Gate text (`gateOn`):
- No log of that type: `"No {type label lowercased} discussion has been logged. {unblocks}"`.
- Log exists but not both acks: `"{waitingOn(latest)}. {unblocks}"`, where waitingOn is "Waiting on the manager to acknowledge" / "Waiting on the employee to acknowledge" / "Neither side has acknowledged this yet".
- Lock unblocks text: "Weightages stay editable until it is, because locking them is what makes them the thing the rating is measured against."
- Publish unblocks text: "A rating that reaches somebody before the conversation does is how an appraisal turns into a grievance."

### 3.7 Tab: Self Rating (`SelfRatingTab`)
If `!locked`: `.b-amber` 🔒 "Self rating opens once your weightages are locked. {lockGate.because}". Nothing else renders.

Otherwise:
1. Banner:
   - submitted → 🔒 amber: "Your self rating is **submitted and locked**, and your manager's rating is now open. It locks at submission on purpose: a self assessment edited after seeing a manager's number is not a self assessment."
   - else `.b-blue` ℹ️: "Rate your own delivery on each KRA. Once you submit, this **locks** and your manager can rate. They cannot rate before you." (`windowNote` is not passed.)
2. Three stats:
   - "KRAs rated": `"{rated} of {n}"`, note "{u} still to do" (warn) or "All done" (good, positive value colour).
   - "Your weighted score": `score(lines,'self').toFixed(2)` or `-`, note "Weighted by the weightage on each KRA".
   - "That lands at": `bandForScore(mine).label` or `-`, note "Rate every KRA to see this" or "What your own ratings average to".
3. Card "Self rating". Sub "Your achievement, your rating, and a comment on each KRA. It locks when you submit."
   - Columns: KRA (bold) | Wt | What you delivered (input, placeholder "The number you actually hit") | Your rating (1–5 chip radiogroup; chip tooltip "n: Label") | Comment (input, placeholder "Evidence a manager could check").
   - All read-only once submitted.
   - Empty: "No KRAs to rate" / "Your KRA set has to be locked before self rating opens."
   - Button (when not submitted and rows exist): "Submitting…" / "{u} KRA(s) still unrated" (disabled) / "Submit (this locks it)".

**Rating scale** (`DEFAULT_BANDS`, `lib/pms/scoring.ts`). The policy's `pms_rating_scale` table is not used by the web UI.

| value | label | improvementMandatory | minCommentChars |
|---|---|---|---|
| 5 | Outstanding | no | 40 |
| 4 | Exceeds | no | 30 |
| 3 | Meets | no | 30 |
| 2 | Partially meets | yes | 80 |
| 1 | Below expectations | yes | 120 |

- `score(lines, who)` = Σ(rating × weightage) / Σ(weightage over rated lines only), rounded to 2 dp. null if nothing is rated.
- `bandForScore` rounds to the nearest integer.

**Submit**:
```ts
supabase.from('pms_reviews').upsert(selfRows.map(r => ({
  period_id, employee_id, goal_id: r.goalId, rater_id: employeeId, rater_role: 'SELF',
  achievement_value: r.achievement || null, rating: r.rating, comments: r.comment || null,
  submitted: true, submitted_at: new Date().toISOString() })),
  { onConflict: 'period_id,employee_id,goal_id,rater_role' })
```
- Error: banner with `error.message`. Success: draft cleared, `reload()` + `loadPeriodData()`.
- DB trigger `trg_pms_sync_role_score` recomputes `pms_overall_rating.self_score`.
- **⚠** `company_id` is again omitted from a NOT NULL column.

### 3.8 Tabs: My Result and My Analytics
**My Result** (`ResultTab`).

Not published:
- Card "Your result is not published yet".
- Text: "Nothing is shown here until the result is published: no rating, no scores, no manager comments. That is deliberate: a rating that reaches you before the conversation does turns a review into a notification."
- When the publish gate is shut, also show "**What is outstanding:** {publishGate.because}".

Published:
1. `.b-green` ✓ "Published." ESS passes `finalisedOn`/`finalisedBy` as null, so no date or name appears.
2. Four stats:
   - "Final rating" (accent): `{final_rating} · {band}`, note "Weighted score {score(lines,'final')}".
   - "Your own score": self score, note "+0.50 against the final" (`gap` delta = self − final).
   - "Department average": always `-` / "Not available" in ESS.
   - "Finalised by": `-`.
3. Card "KRA by KRA". Sub "Every rating in the chain, and what each one contributed."
   - Columns: KRA | Wt | You | RM L1 | RM L2 | **Final** | Contributed.
   - Contributed = `(final × weightage / 100).toFixed(2)`. Null values show `-`.
4. Three cards:
   - "🏆 Appreciation": `appreciation_remark`, or "Nothing written for this period."
   - "📈 Where to improve": `improvement_feedback`, or "Nothing written for this period."
   - "🎁 Recognition": always empty in ESS: "Nothing recorded for this period." plus "Recognition only: a certificate, a nomination or an award. Never a cash component."
5. There is no Acknowledge button in ESS (`onAcknowledge` is not passed).

**⚠ PARITY NOTE:** web `published` is true whenever `final_rating` is set, and it then shows the feedback text even if `visible_to_employee` is false. `/api/ess/pms` withholds feedback unless `visible_to_employee`. Decide which rule RN follows; the server one is the documented intent.

**My Analytics** (`AnalyticsTab`).

Not published: card "Nothing to compare yet": "These charts compare your ratings with your manager's, so they only appear once a result has been published. Before that there is nothing to put beside your own numbers."

Published:
1. Card "How you and your manager saw the same work". Sub "The pale bar is your rating, the solid one is the final. A wide difference is a conversation, not a verdict."
   - One `.abar` per line: name (150px), a track holding two stacked half-bars (self in brandEdge, final in brand, width = value/5), and a value `"{self} → {final}"` with " ‼" if MAJOR_GAP (|Δ| ≥ 2) or " =" if Δ = 0.
   - Then a banner:
     - If any line is a major gap: amber "Two points or more apart on **{titles}**. {MAJOR text}". MAJOR text = "You and your manager are reading this one very differently. Worth raising in the next one-to-one. Bring the evidence you rated yourself on."
     - Otherwise green "Overall {gap.says lowercased}". Says texts: ALIGNED "You and your manager saw this the same way." / MINOR "A one-point difference. Usually a difference in what "on target" meant, rather than a disagreement about the work." / no data "Not enough ratings in yet to compare."
2. Card "Where your strengths are". Sub "By category, weighted. A low category is where development goes, not a mark against you."
   - `byCategory(lines,'final')` bars (categories with no KRAs are omitted). Value `toFixed(2)` or `-`.
3. Card "How this has moved". Sub "Your weighted score over the last few periods."
   - `trend` is always `[]` in ESS, so it shows "This is your first completed period, so there is nothing to compare it against yet."

### 3.9 `nextAction()` strings (employee branch first, then RM, then HOD)
`roles.isEmployee !== false`:
1. `!kraSubmitted`. `d = daysLeft(kra window)`.
   - n = 0: "Write your KRAs" / cta "Add your first KRA" / why "Your KRAs are what you will be rated on this period. You need between 4 and 10, and their weightage must add up to exactly 100." tab mine.
   - invalid: "Finish your KRA set" / "Fix and send to manager" / "Almost there: {you have n of at least 4 | you have n, more than the 10 allowed | weightage adds to T, not 100}. Your manager cannot approve the set until it satisfies both rules."
   - valid: "Send your KRAs to your manager" / "Send to manager" / "{n} KRAs totalling {T}. Your manager reviews them with you before they are locked."
2. `!oneToOneBothConfirmed`: "Confirm your one-to-one", tab oneone, info.
   - If logged: cta "Confirm the discussion", why "Your manager has logged the discussion. Both of you confirm it before the KRAs are locked."
   - Otherwise: cta "Log the discussion", why "Before your KRAs are locked, you and your manager talk them through and both confirm it happened."
3. `!selfSubmitted`:
   - not approved: "Waiting on your manager" / cta "See your KRAs" / blockedBy "Your KRAs have not been approved yet." / why "Self rating opens once your manager approves and locks your KRA set. Nothing to do until then." (tab mine)
   - outside the window, early: "Self rating is not open yet" / "See your KRAs" / blockedBy "The self-rating window has not started." / why "Your KRAs are locked and nothing is owed until {date}, when self rating opens. Reviewing them now is the useful thing to do."
   - outside the window, late: "You missed the self-rating window" (overdue) / cta "Ask your manager to reopen it" / blockedBy "Self rating closed on {date}." / why "Your manager can still rate you without it, but your own view of your delivery will not be on record. Ask them to reopen the window if it matters to you."
   - no window configured but `inWindow` false: unreachable, because an undefined window counts as open.
   - in the window: "Rate yourself" / "Start self rating" / "Score your own delivery against each KRA. Your manager sees this alongside their own rating, so it is your chance to make the case."

RM:
- `kraApprovals`: "Approve N KRA set(s)", due, cta "Open the approval queue", why "Your reportees cannot start rating themselves until you approve and lock their KRAs."
- `ratingsDue` (never supplied in ESS): "Rate N reportee(s)".

HOD:
- `finalisationsDue` (never supplied): "Finalise N rating(s)".

Otherwise: null.

Urgency: `daysLeft` null → info; < 0 → overdue; ≤ 3 → due; else info.

### 3.10 Cycle/state rules (`lib/pms/cycle.ts`, pure)
- `settled(p)` back-fills earlier flags from later ones: published ⇒ finalised ⇒ rmL2Done ⇒ rmL1Done ⇒ selfSubmitted ⇒ kraApproved ⇒ (oneToOneBothConfirmed and kraSubmitted); oneToOneBothConfirmed ⇒ oneToOneLogged.
- `currentStage`: published or finalised → result; rmL2Done → finalise; rmL1Done or selfSubmitted → review; kraApproved → self; oneToOneBothConfirmed → lock; kraSubmitted → oneToOne; else kra.
- `stageStates`:
  - before the current stage → done; after → upcoming.
  - at the current stage:
    - result: done if published, else active.
    - otherwise, if the stage's window (kra/self/review/finalise) exists and today is outside it: `upcoming` if before `from`, else `blocked`.
    - else blocked if (self && !kraApproved) or (lock && !oneToOneBothConfirmed).
    - else active.
- `inWindow(undefined)` = true. Window bounds are inclusive ISO strings.
- `humanDate('2027-01-01')` → "1 Jan 2027".
- Statuses (`lib/pms/status.ts`):
  - Period status: SCHEDULED, KRA_SETTING, IN_PROGRESS, SELF_RATING, RM_REVIEW, FINALISATION, PUBLISHED, CLOSED.
  - Goal status: DRAFT, PENDING_ONE_TO_ONE, PENDING_RM_APPROVAL, LOCKED, SENT_BACK, TERMINATED.
  - Workflow ladder (`reached(status, mark)` = index compare): NOT_STARTED < KRA_DRAFT < KRA_LOCKED < SELF_DRAFT < SELF_SUBMITTED < RM_L1_DONE < RM_L2_DONE < FINALISED < PUBLISHED < ACKNOWLEDGED.
- Who moves state: the employee writes goals (PENDING_RM_APPROVAL), 1-on-1 rows and SELF reviews.
  - Locking happens only via RPC `pms_lock_kras(p_employee_id, p_period_id, p_manager_id)`. It returns `'LOCKED'`, `'BLOCKED: <msg>'` or `'ERROR: …'`. It sets goals LOCKED and workflow KRA_LOCKED, and requires a both-acked KRA_SETTING row when the policy says so.
  - Finalisation happens via `pms_finalise`.
  - Both are reachable only through `POST /api/pms/admin` (`action:'kra_lock'` / `'finalise'`), the admin dashboard surface. **ESS calls neither.**
- DB guards:
  - `trg_pms_self_first` rejects a non-SELF submitted review before a submitted SELF review exists, with "Self rating must be submitted before manager rating", when the policy has `self_rating_mandatory`.
  - `trg_pms_readonly` blocks updates to a read-only overall row: "Record is read-only (employee exited and rating finalised)".
- RLS on all `pms_*` tables is allow-all for anon/authenticated. Nothing in the DB stops a client writing another employee's rows.

### 3.11 Manager side, "My team" (TeamSide)
Data comes from `usePeriod` (§3.3) and `useRoster(employeeId, period, 'rm')`, all direct anon Supabase:
```ts
supabase.from('pms_overall_rating')
  .select('employee_id,workflow_status,kra_count,total_weightage,self_score,rm_l1_score,rm_l2_score,final_rating,rm_l1_id,rm_l2_id,employment_flag')
  .eq('period_id', period.id)
  .or(`rm_l1_id.eq.${employeeId},rm_l2_id.eq.${employeeId}`)    // rm;  hod: .eq('hod_id', employeeId)
supabase.from('employees').select('id,emp_code,full_name,date_of_leaving').in('id', ids)
```
This is the frozen chain snapshot on the overall row, not live reporting.

`TeamMember` mapping:
- `{ employeeId, code, name ('Unknown' if missing), dateOfLeaving, flagOverride: employment_flag, kraCount, totalWeightage }`
- `oneToOneDone: workflow_status !== 'NOT_STARTED' && total_weightage === 100` (a heuristic, not 1-on-1 rows)
- `selfSubmitted: self_score != null`, `selfScore`, `rmL1Score`, `rmL2Score`, `finalRating`, `finalised: final_rating != null`

`employment_flag` is NOT NULL (default ACTIVE), so the flag is always the DB's value.

Queue logic (`lib/pms/team.ts`, pure):
- `teamQueue` sorts by queuePriority (NOTICE_PERIOD 0, EXITED 1, ACTIVE 2, NEW_JOINER 3), then actionable first, then name.
- `next`, first match wins:
  1. finalised or NEW_JOINER: "Nothing owed on this one right now."
  2. 0 KRAs: "No KRAs written yet. They cannot be rated at all until there are."
  3. weight ≠ 100: "Their weightages total {w}, not 100. Send it back before the one-to-one."
  4. no 1-on-1: "Hold the KRA one-to-one and acknowledge it, so the weightage can lock."
  5. no self rating: "Waiting on their self rating. You cannot rate first."
  6. no L1 score: "Your rating is owed."
  7. no L2 score: "With RM L2 now."
  8. otherwise: "Ready to be finalised."
- `priorityNote`:
  - NOTICE with LWD ≥ 0: "Last working day in {d} day(s). After it this record locks and the rating can never be given."
  - NOTICE past LWD: "Last working day has passed. This should already have been rated."
  - EXITED: "Already left. Read-only once finalised; the result is emailed before their login closes."
- `flagFor` (used if there is no override): EXITED if dateOfLeaving ≤ today; NOTICE if leaving is in the future or a resignation date exists; NEW_JOINER if joined < 30 days ago; else ACTIVE.

Shared row UI (`QueueTable`):
- Columns: Code | Employee | Employment | KRAs | Wt (ok/bad colour by =100) | 1-on-1 (`p-green ✓` / `p-grey not yet`) | Self (`p-green submitted` / `p-amber waiting`) | Self score | What is owed (`next` + bold `priorityNote`) [+ extra column].
- Row tint: `exitrow` (#FFF4ED), `noticerow` (#FEFCE8).
- FlagPill:
  - EXITED: `p-orange` "Left the company · {date}"
  - NOTICE: `p-amber` "Notice · last day {date}"
  - NEW_JOINER: `p-blue` "New joiner"
  - else `p-green` "Active"
- Empty: "Nobody here yet" + text.

ExitBanner (amber 🔶), shown when anyone is on notice or exited:
- "**{n} person is / people are serving notice**: rate them before their last working day, after which the record locks and the rating can never be given."
- "**{n} has / have already left**: still finalisable, but read-only once done, and the result is emailed before their login closes."

Tabs:
- **Team Dashboard**:
  - ExitBanner.
  - 5 stats:
    - "Your rating is owed" (accent): count of next === "Your rating is owed.", note "Nobody else can do these" / "Nothing waiting on you"
    - "Team size"
    - "Self ratings in" `"x of n"`, note "You cannot rate before they submit"
    - "Serving notice" (warn if > 0), note "Rate before their last day" / "None"
    - "Finalised" `of n`
  - Card "My team: your team", sub "Ordered by whose deadline cannot move, then by what is actually owed."
  - Empty text: "Nobody reports to you in the org data for this period, or migration 066 has not been applied yet."
- **KRA Approval & One-to-One**:
  - Blue banner: "A set is valid at **4 to 10 KRAs totalling exactly 100**. Weightage locks only once you and they have both acknowledged the KRA one-to-one. One tick is a manager asserting a conversation happened, two is a record."
  - Card "Waiting on the discussion", sub "Sets to check, and the one-to-ones that lock them". Rows filtered to `!selfSubmitted || !oneToOneDone`. Empty: "Every set is settled and locked."
  - Action column:
    - invalid set: a reason input (placeholder "What they need to change") plus **[Send back]**
    - valid but no 1-on-1: **[Acknowledge & lock]**
    - otherwise: `p-green locked`
  - Footer: "Sending a set back needs a reason. "Rejected" on its own means the employee guesses at what to change, and the set comes back wrong a second time."
  - **⚠ In ESS, no handlers are passed, so both buttons are permanently disabled.** There is no write.
- **Rate My Team**: `member` is always null (nothing sets `picked`), so it always shows card "Pick somebody to rate": "Choose a team member from the dashboard. Their KRAs and their own ratings appear here beside yours."
  - The full form exists in code: stats, a per-KRA chip rating, comments, an overall comment validated by `checkFeedback`, and submit text "{n} KRA(s) still to rate" / "Submit my rating".
  - `onSubmit` is `() => {}`, so it is unreachable and inert.
  - If the member has not submitted a self rating: "{name}: not yet" + "They have not submitted their self rating yet. Rating first would anchor their assessment to yours, and the database refuses it in any case."
- **PIP Request**:
  - Blue banner: "You raise the request; **HR decides whether a PIP starts**. That is not a formality: the plan is the documentation trail that answers a claim under the Industrial Disputes Act, and HR gatekeeping is what keeps it consistent enough to rely on. HR can adjust your dates, drop an area, send it back, or decline it."
  - Card "Raise a PIP request", sub "Every area needs a measurable target and a way to check it. An area without one cannot be reviewed, and a plan nobody can review protects nobody."
    - Who select: "Choose a team member", then `"{name} ({code})[ · last rated {r}]"`.
    - "Support you are offering" input, placeholder "Training, mentoring, a change of workload".
    - Areas table: # | Improvement area | Where they are ("0.6% error rate") | Target ("under 0.2%") | How it is measured ("monthly run audit") | Review on (date).
    - [+ Add an area].
    - Submit "Send the request to HR" / "Sending…". `ready` = a person is chosen and ≥ 1 area has area, target and measure filled.
  - **⚠ `onRaise` is not passed, so submit is always disabled.**
- **Team Analytics**:
  - Card "How your team was rated", sub "For information. There is no curve to fit. With no pay attached, a forced distribution would be rationing nothing."
    - Rows for ratings 5..1: label `"{r} · {band}"`, bar = n/rated, value `"{n} · {pct}%"`.
    - If nothing is rated: "Nothing has been finalised yet, so there is no distribution to show."
  - Stats:
    - "your team average" `-`
    - "Company average" `-`
    - "Rated 2 or below" (count), note "Each of these owes improvement feedback"
  - Card "Where the strength is, by category", sub "A low category across a whole team is a training need, not a run of individual failures." Lines are `[]`, so it shows "No finalised ratings yet."

### 3.12 HOD side, "My department" (DeptSide)
Roster from `useRoster(..., 'hod')` (`.eq('hod_id', employeeId)`).
- **Review & Finalise** (`FinaliseTab`, role HOD, chain `SELF_RM1_RM2_HOD`, finaliser `RM1_RM2_HOD`; both hardcoded, not read from policy):
  - Blue banner: "The chain is **Self → RM L1 → RM L2 → HOD**, and under this policy **RM L1, RM L2 or HOD** may finalise. A row cannot be finalised while a step ahead of it is still open. That is not a nicety, it is the difference between a rating that went through the chain and one that skipped it."
  - ExitBanner.
  - Stats:
    - "Awaiting finalisation" (accent) "of N"
    - "Finalised"
    - "Exit or notice" (warn), note "Clear these first. Their deadline cannot move" / "None outstanding"
    - "your department average" (unweighted mean of final ratings)
  - Card "Finalisation queue: your department", sub "Exit and notice rows are pinned to the top, because after a last working day the record locks for good."
    - Columns: Code | Employee | Employment | Self | RM L1 | RM L2 | Final rating | Action.
    - Final rating:
      - finalised → `p-green "{r} · finalised"`
      - otherwise a select "Choose" plus "5 · Outstanding"…"1 · Below expectations", disabled unless `canFinalise`
    - Action:
      - finalised → "done"
      - `canFinalise` → [Finalise]
      - `insteadDo` starting "RM L2" → [Nudge RM L2]
      - otherwise the `insteadDo` text
    - `insteadDo` texts:
      - "Your role cannot finalise under this policy. {The HOD | RM L2 or the HOD} does."
      - "No self rating on record. The chain has not started, so there is nobody downstream to chase yet."
      - "RM L2 has not submitted. Nudge them. Finalising now would skip a step of the chain."
    - Empty: "Nothing to finalise" plus the EMPTY_TEAM text.
  - **⚠ `onFinalise`/`onNudge` are not passed, so the buttons are disabled.**
- **Feedback & Recognition**: `member` is always null, so it shows "Pick somebody": "Choose a person from the finalisation queue to write their feedback." The full editor in code is unreachable:
  - appreciation and improvement textareas
  - recognition rows, types: Certificate, Spot award, Training nomination, Special mention, Star performer, Other
  - publish gating via `checkFeedback` and `canPublishResult`
  - `checkFeedback` faults:
    - "Improvement feedback is required at {v} ({label}). This is the rating somebody may have to act on, and it needs to say what would change it."
    - "At least {min} characters of comment at this rating. There are {n}."
    - "Neither an appreciation remark nor improvement feedback has been written."
    - "No rating has been given yet."
- **Department Analytics**: `TeamAnalyticsTab` with scopeLabel "your department" (same as §3.11).

**Net effect for parity:** in ESS today, the manager and HOD audiences are **read-only dashboards**. All manager writes are disabled or unreachable.

### 3.13 `GET /api/ess/pms`: read-only server summary (not used by web; built for mobile)
- Auth: `essRoute`. Accepts `?employee_id=` (view-as rules in §0.1).
- Period: the caller's company's latest `period_start` (nulls last), **no status filter**. The IST date is used as "today".
- No period:
```json
{ "period": null, "stage": null, "stages": [], "kras": [], "one_to_ones": [], "result": null,
  "diagnostics": { "noCompany": bool, "noPeriod": true, "noKras": true, "noOneToOnes": true, "noResult": true } }
```
- With a period:
```ts
{
  period: { id, label /* period_name ?? period_code ?? financial_year ?? 'This cycle' */, code, financial_year, status,
            starts_on, ends_on,
            windows: { kra: {from,to}|null, self: …|null, review: …|null, finalise: …|null },
            result_publish_date },
  policy: { min_kra, max_kra, total_weightage, min_weightage_per_kra,      // policy values, else DEFAULT_RULES
            one_to_one_mandatory /* default true */, self_rating_mandatory /* default true */ },
  stage:  { key, n, label, blurb },
  stages: [{ key, n, label, blurb, state: 'done'|'active'|'upcoming'|'blocked' }],   // 7, WITH windows
  next_action: Action | null,   // { title, why, cta, tab, urgency, daysLeft?, blockedBy? } — employee branch only
  kras: [{ id, seq_no, title, metric, target, category, weightage: number, status,
           self, rm_l1, rm_l2, final /* HOD??RM_L2??RM_L1 */: number|null, achievement: string|null }],
  weightage_total: number,
  kra_set_valid: boolean,
  one_to_ones: (Log & { placeholder?: true })[],   // logRows(): id, discussion_type, discussion_date, mode, discussion_points, employee_ack, manager_ack
  gates: { weightage_lock: { open, because }, publish: { open, because } },
  result: { kra_count, total_weightage, self_score, rm_l1_score, rm_l2_score, hod_score, final_score,
            final_rating, final_rating_code, self_vs_final_gap, workflow_status, published_at,
            employee_ack, employee_ack_at, is_eligible, ineligible_reason } | null,
  feedback: { appreciation, improvement, development_plan } | null,   // only if visible_to_employee
  rating_scale: [{ rating_value, rating_code, rating_label, score_from, score_to, colour_hex }],  // company, active, sort_order
  diagnostics: { noCompany, noPeriod:false, noPolicy, noKras, noOneToOnes, noResult, notPublished }
}
```
There is **no** server write endpoint for employee KRAs, 1-on-1s or self ratings. The web writes directly with the anon key (§3.5–3.7).

### 3.14 Pure modules RN can import directly
None of these imports supabase, next, React or browser APIs. Intra-lib imports use `.ts` extensions (`import … from './cycle.ts'`), so configure Babel/TS `allowImportingTsExtensions`, or copy the files.
```ts
import { STAGES, DEFAULT_RULES, settled, currentStage, stageStates, nextAction, kraSetValid, inWindow, daysLeft, humanDate, type Progress, type Period, type Roles, type Queues, type Rules, type Action, type ActionTab, type StageKey, type StageState } from '@/lib/pms/cycle'
import { checkKras, canAdd, canDelete, meter, suggestSplit, CATEGORIES, CATEGORY_LABEL, type Kra, type Category } from '@/lib/pms/kra'
import { canLockWeightage, canPublishResult, logRows, ackState, waitingOn, DISCUSSION_TYPES, TYPE_LABEL, TYPE_PURPOSE, MODES, MODE_LABEL, type Log } from '@/lib/pms/oneToOne'
import { score, gap, byCategory, bandFor, bandForScore, checkFeedback, canManagerRate, DEFAULT_BANDS, type Line } from '@/lib/pms/scoring'
import { teamQueue, finaliseQueue, teamStats, distribution, type TeamMember } from '@/lib/pms/team'
import { flagFor, daysToLwd, queuePriority, FLAG_LABEL, FLAG_MEANING } from '@/lib/pms/employment'
import { canFinalise, blockedByRmL2, CHAIN_LABEL, FINALISER_LABEL, may } from '@/lib/pms/hierarchy'
import { PERIOD_OPEN, GOAL_SENT, GOAL_STATUS, GOAL_AWAITING_RM, WORKFLOW, reached } from '@/lib/pms/status'
import { nameThePeriod, periodSpan, periodSpanShort, frequencyPhrase } from '@/lib/pms/language'
import { buildForest, flatten, pathTo, countNodes } from '@/lib/rms/tree'
import { buildChain, CHAIN_ORDER, type ManagerSlot } from '@/lib/rms/hierarchy'
import { companyFilter, scopedCompanies, canSee } from '@/lib/rms/resolve'   // pulls ./modules.ts, ./screens.ts (also pure)
```
Do **not** import these in RN:
- `lib/pms/adminClient.ts` (imports `@/lib/auth-headers`, browser)
- `lib/rms/client.ts` (localStorage, `@/lib/supabase`, React hooks)
- `lib/rms/server.ts`, `lib/ess/session.ts`, `lib/api-auth.ts` (`next/server`, service key)
- `lib/ess-scope.ts` (`@/lib/supabase`)
- `components/ess/team/ui.tsx` (`initials`/`hueOf` are pure but live in a TSX file; copy them)

---

## 4. Implementation notes for React Native

1. **Auth / fetch.** Port `api()` exactly: add `employee_id`, send the bearer, `no-store`, and throw `body.error || HTTP n`. Store the token in SecureStore. The token comes from `/api/ess-auth/login`.
2. **Team screen.** Use a ScrollView with the three blocks.
   - Reverse `managers` for display.
   - Filter out `isSelf` before counting mates.
   - Gate the roster on `menu.is_rm || menu.is_hod` from `/api/ess/menu`, not on Performance's own counts.
   - For the roster, use a FlatList of cards (code, name, designation, status pill; a "Direct" badge in DEPT) rather than a table on phones. Draw the TEAM/DEPT segmented control only for dual-role users.
   - Expect the peers call to 403 under module enforcement (§1.2B) and render the same empty text.
   - The web has no tap-to-profile. If RN adds one, it is new behaviour.
3. **Org chart on the web.** It is a pure DOM tree: nested `ul/li` flexbox with CSS pseudo-element connectors, inside an `overflow:auto` div. Zoom is a CSS `transform: scale()` (15–140%, ±10, auto fit-to-screen). There is no SVG or canvas, no drag-to-pan beyond native scrollbars, and no pinch. Export uses html2canvas.
   - Phone equivalent, recommended:
     - (a) Default to **"My chain"**: a vertical list of the ancestors, YOU, and your direct reports. It is already computed by `pathTo`. On a phone it is just a column of cards and needs no 2-D canvas.
     - (b) **"Whole company"** as a drill-down list (tap a manager to push its children; breadcrumb = `pathTo`), or a 2-D tree in `react-native-svg` inside a `GestureDetector` with pinch/pan (`react-native-gesture-handler` and `reanimated` are already in `apps/mobile/package.json`).
     - Lay out the tree yourself (a simple tidy-tree: leaf width 172 + 20 gap; parents centred over children). Draw elbow connectors as SVG paths.
     - Keep the default collapse at depth ≥ 1, the `+N`/`−` toggles, and the tier colours and labels. Show the "YOU ARE HERE" / "REPORTS TO YOU" ribbons and the `👥 N` badge.
     - Search should hit the whole forest, switch out of chain mode automatically when the hit is outside it (fixing the web gap, or match the web and do nothing), expand ancestors, and scroll/zoom to the node.
     - JPEG export: optional. Use `react-native-view-shot` plus expo-sharing if it is wanted.
     - Diagnostics: show only for `canSee(grant,'Employees')`. The grant comes from `GET /api/rms/me`.
     - Company picker: only cross-company users have more than one real option.
4. **Performance.**
   - For **reads**, prefer `GET /api/ess/pms`. It is server-side, company-correct and window-aware, and it applies the feedback-visibility rule. Reproducing the web's ~15 anon queries carries over their inconsistencies (three period-selection rules, the windowless inner stepper, feedback shown before visibility).
   - For **writes**, parity today means direct anon Supabase inserts/upserts into `pms_employee_goals`, `pms_one_to_one` and `pms_reviews` (§3.5–3.7). Per repo DDL these omit NOT NULL `company_id` (and `manager_id` for 1-on-1s). Test against the live DB first. The cleaner route is a new authenticated `POST /api/ess/pms` that stamps `company_id`/`manager_id` server-side and enforces `checkKras` with the policy rules.
   - Audience chips: replicate Performance's own role queries (L1 **or** L2 reportees; HOD via `departments.hod_employee_id` or `employees.hod_id`), or align on `/api/ess/menu` deliberately.
   - Manager and HOD tabs are read-only in ESS today. Render the queues with `teamQueue`/`finaliseQueue` and keep every action control disabled (or hidden) for parity.
   - Tables become per-KRA cards on a phone.
     - KRA editor: title, metric, target, category picker, numeric weightage, the meter bar, add/remove (respect `canAdd`/`canDelete`), "Split 100 evenly", the faults list, and a submit label driven by `checkKras`.
     - Self rating: five chip radio buttons (1–5) per KRA.
   - Stepper: 7 dots in a horizontal ScrollView, or a vertical timeline. The blurb tooltip becomes long-press or tap. Use the token colours: done positive, active brand, blocked warning, upcoming sunken/muted.
   - NextAction CTA must route both scope and tab via `GO_TO`.
   - Use local `yyyy-mm-dd` for `today` (web) or IST (server), consistently.
5. **Tokens.** Map pms.css and team.css classes onto `apps/mobile/src/ui/theme.ts`:
   - `b-amber` → warning/warningTint
   - `b-blue` → info/infoTint
   - `b-green` → positive/positiveTint
   - `b-red` → critical/criticalTint
   - `p-brand` → brandTint/brandDeep
   - `p-grey` → sunken/muted
   - `p-orange` → `#FFEDD5`/`#9A3412` (pms-only literal)
   - exit row `#FFF4ED`, notice row `#FEFCE8`
   - accent stat → brand fill with onAccent text
   - The org chart's purple hex palette should be re-tokenised.
