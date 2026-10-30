// What an approval decision touches. A leave or attendance decision changes the
// requester's balances and calendar, Home's "pending on you" figure and the bell.
import { invalidate } from '@/core/query'

export const afterDecision = () => invalidate('approvals', 'today', 'notifications', 'leave', 'attendance')
