// src/features/profile/Documents.tsx — editors.tsx DocumentsPanel: what is
// asked for (PROFILE_DOCS), what is on file (here or from onboarding), and an
// upload per document. GET / POST /api/ess/profile/self-service.
//
// Shown in the Documents tab on your own profile and in the Documents sheet
// that "Fix" and Edit profile open.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Button, Notice, Txt } from '@/ui/primitives'
import { SelectSheet } from '@/ui/overlays'
import { selfService, useProfileDocuments, type DocOnFile, type DocRequired } from './api'
import { DOC_SOURCES, PickError, pickDoc, type DocSource } from './files'
import { Pill, type PillKind } from './bits'
import type { Done } from './Editors'

const DOC_STATUS: Record<string, { text: string; tone: PillKind }> = {
  verified: { text: 'Verified', tone: 'good' },
  uploaded: { text: 'With HR for verification', tone: 'warn' },
  pending: { text: 'With HR for verification', tone: 'warn' },
  rejected: { text: 'Not accepted. Upload again', tone: 'bad' },
  expired: { text: 'Expired. Upload a current one', tone: 'bad' },
}

function DocLink({ url }: { url: string }) {
  return (
    <Pressable onPress={() => void WebBrowser.openBrowserAsync(url)} hitSlop={8} accessibilityRole="link" style={{ paddingVertical: 6, paddingHorizontal: 4 }}>
      <Txt size={F.small} w={600} tone="brand">View</Txt>
    </Pressable>
  )
}

function DocRow({ req, doc, busy, first, onUpload }: {
  req: DocRequired; doc: DocOnFile | undefined; busy: boolean; first: boolean; onUpload: () => void
}) {
  const { C } = useTheme()
  const st = doc ? DOC_STATUS[doc.status] ?? DOC_STATUS.uploaded : null
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: S.md, borderTopWidth: first ? 0 : 1, borderTopColor: C.line }}>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Txt size={F.small} w={600}>{req.label}{req.mandatory ? '' : <Txt size={F.small} tone="faint"> · optional</Txt>}</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          {st ? <Pill kind={st.tone} label={st.text} /> : <Pill label="Not uploaded" />}
          {doc?.source === 'onboarding' && <Txt size={F.tiny} tone="muted">from onboarding</Txt>}
          {!!doc?.remarks && doc.status === 'rejected' && <Txt size={F.tiny} tone="critical">{doc.remarks}</Txt>}
          {!doc && !!req.hint && <Txt size={F.tiny} tone="muted">{req.hint}</Txt>}
        </View>
      </View>
      {!!doc?.url && <DocLink url={doc.url} />}
      <Button title={busy ? 'Uploading…' : doc ? 'Replace' : 'Upload'} variant={doc ? 'outline' : 'primary'} size="sm" disabled={busy} onPress={onUpload} />
    </View>
  )
}

export function DocumentsPanel({ onChanged }: { onChanged: Done }) {
  const { C } = useTheme()
  const q = useProfileDocuments()
  const [busy, setBusy] = React.useState<string | null>(null)
  const [err, setErr] = React.useState<string | null>(null)
  const [choosing, setChoosing] = React.useState<string | null>(null)

  const upload = async (code: string, src: DocSource) => {
    setErr(null)
    let f
    try { f = await pickDoc(src) } catch (e) { setErr(e instanceof PickError ? e.message : 'That file could not be opened.'); return }
    if (!f) return
    setBusy(code)
    try {
      const r = await selfService({ action: 'document', doc_type: code }, f)
      await q.refetch()
      onChanged(r.message ?? 'Uploaded.')
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not reach the server.') }
    finally { setBusy(null) }
  }

  if (!q.data) {
    return q.error ? <Notice tone="critical">{q.error instanceof Error ? q.error.message : 'Could not reach the server.'}</Notice>
      : <Txt size={F.small} tone="faint">Loading documents…</Txt>
  }
  const required = q.data.required ?? []
  const documents = q.data.documents ?? []

  // The newest copy per type wins: a re-upload here outranks the one from onboarding.
  const latest = new Map<string, DocOnFile>()
  for (const d of [...documents].sort((a, b) => String(b.uploaded_at ?? '').localeCompare(String(a.uploaded_at ?? '')))) {
    if (!latest.has(d.doc_type)) latest.set(d.doc_type, d)
  }
  const asked = new Set(required.map(r => r.code))
  const others = [...latest.values()].filter(d => !asked.has(d.doc_type))
  const done = required.filter(r => r.mandatory && latest.get(r.code)).length
  const need = required.filter(r => r.mandatory).length

  return (
    <View>
      <Txt size={F.small} tone="soft" style={{ marginBottom: S.sm }}>
        <Txt size={F.small} w={700}>{done} of {need}</Txt> required documents on file. Uploads save straight away; HR verifies each one.
      </Txt>
      {!!err && <Notice tone="critical" style={{ marginBottom: S.sm }}>{err}</Notice>}
      {required.map((r, i) => (
        <DocRow key={r.code} req={r} doc={latest.get(r.code)} busy={busy === r.code} first={i === 0} onUpload={() => setChoosing(r.code)} />
      ))}
      {others.length > 0 && (
        <>
          <Txt size={F.micro} w={700} tone="muted" upper style={{ marginTop: S.md, marginBottom: 4 }}>Also on file</Txt>
          {others.map((d, i) => {
            const st = DOC_STATUS[d.status] ?? DOC_STATUS.uploaded
            return (
              <View key={d.id} style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: S.sm, borderTopWidth: i ? 1 : 0, borderTopColor: C.line }}>
                <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                  <Txt size={F.small} w={600}>{d.label}</Txt>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                    <Pill kind={st.tone} label={st.text} />
                    {d.source === 'onboarding' && <Txt size={F.tiny} tone="muted">from onboarding</Txt>}
                  </View>
                </View>
                {!!d.url && <DocLink url={d.url} />}
              </View>
            )
          })}
        </>
      )}
      <SelectSheet visible={!!choosing} onClose={() => setChoosing(null)} title="Upload" searchable={false}
        options={DOC_SOURCES.map(o => ({ value: o.value, label: o.label }))}
        onPick={v => { const c = choosing; setChoosing(null); if (c) void upload(c, v) }} />
    </View>
  )
}
