// src/features/profile/IdCardScreen.tsx — the digital ID card on its own page,
// opened from "Digital ID" on My Details (the website opens a Digital ID
// drawer with the same card and the PDF download). It opens on the QR because
// a phone pulled out at the gate wants the code first.
import * as React from 'react'
import { View } from 'react-native'
import { invalidate } from '@/core/query'
import { Screen } from '@/ui/Screen'
import { S } from '@/ui/theme'
import { Card, Loading, Notice } from '@/ui/primitives'
import { useProfile } from './api'
import { val } from './format'
import { IdCard, IdCardDownload, StaticIdCard } from './IdCard'

export default function IdCardScreen() {
  const q = useProfile()
  const p = q.data
  let body: React.ReactNode
  if (q.error) body = <Card><Notice tone="critical">{q.error instanceof Error ? q.error.message : 'Could not reach the server.'}</Notice></Card>
  else if (!p) body = <Card><Loading /></Card>
  else {
    const emp = p.employee
    const self = p.isSelf ?? p.viewer_role === 'self'
    body = self ? (
      <View style={{ gap: S.md }}>
        <IdCard startOnQr name={val(emp.full_name)} designation={val(emp.designation)} company={val(emp.company_name)} code={val(emp.employee_code)}
          doj={emp.date_of_joining as string | null} blood={emp.blood_group as string | null} emergency={emp.emergency_contact_1 as string | null} photoUrl={p.photoUrl} />
        <IdCardDownload />
      </View>
    ) : <StaticIdCard name={val(emp.full_name)} designation={val(emp.designation)} company={val(emp.company_name)} photoUrl={p.photoUrl} />
  }
  return <Screen title="Digital ID" subtitle="Show the QR at the gate. The code refreshes every few seconds." onRefresh={() => invalidate('profile')}>{body}</Screen>
}
