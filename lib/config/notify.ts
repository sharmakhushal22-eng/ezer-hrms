// lib/config/notify.ts — an in-app notification (bell + Tasks & Approvals) whose words come
// from Configuration. SERVER ONLY.
//
// Same insert as lib/ess/session notify(); only the title and body are looked up — for the
// given scope (the record's company / branch), else the recipient's own. Never throws: a
// notification must not fail the action that caused it.
import { notify } from '@/lib/ess/session'
import { employeeScope, renderNotification, type ScopeArg } from './store'
import type { Vars } from './render'

export async function notifyFromTemplate(
  employeeId: string | null | undefined,
  key: string,
  vars: Vars,
  opts: { link?: string; category?: string; scope?: ScopeArg } = {},
): Promise<void> {
  if (!employeeId) return
  try {
    const n = await renderNotification(key, opts.scope ?? await employeeScope(employeeId), vars)
    await notify(employeeId, n.title, n.body, opts.link ?? '/ess', opts.category ?? 'APPROVAL')
  } catch (e) {
    console.warn(`notification "${key}" not sent:`, e)
  }
}
