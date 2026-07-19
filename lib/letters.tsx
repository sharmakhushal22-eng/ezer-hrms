import { ImageResponse } from 'next/og'
import { resolveLetterhead, LetterheadHeader, LetterheadFooter } from '@/lib/letterheads'

// Generic professional A4 letter (reuses the same look as the offer letter).
// Used for Resignation-Acceptance, Joining-Confirmation, pre-boarding, etc.
export interface LetterData {
  company_name?: string
  title: string // e.g. "JOINING CONFIRMATION LETTER"
  recipient?: string // candidate name
  date?: string
  paragraphs?: string[]
  highlights?: { label: string; value: string }[] // optional key/value box (Position, DOJ, ...)
  from_name?: string
}

export async function renderLetterPng(d: LetterData): Promise<Buffer> {
  const company = d.company_name || 'Our Company'
  const date =
    d.date || new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
  const paragraphs = d.paragraphs || []
  const highlights = d.highlights || []

  const lh = resolveLetterhead(company)
  const img = new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          backgroundColor: '#FFFFFF',
          padding: '40px 56px 0',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Company letterhead header */}
        <LetterheadHeader lh={lh} date={date} />
        <div style={{ display: 'flex', fontSize: 23, color: lh.accent, fontWeight: 700, letterSpacing: 4, marginBottom: 18 }}>{d.title}</div>

        <div style={{ display: 'flex', fontSize: 24, color: '#111827', marginBottom: 14 }}>Dear {d.recipient || 'Candidate'},</div>

        {paragraphs.map((p, i) => (
          <div key={i} style={{ display: 'flex', fontSize: 21, color: '#374151', lineHeight: 1.5, marginBottom: 16 }}>
            {p}
          </div>
        ))}

        {highlights.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', backgroundColor: '#F8F7FF', border: '1px solid #E9E5FF', borderRadius: 14, padding: '14px 26px', marginTop: 6, marginBottom: 6 }}>
            {highlights.map((h, i) => (
              <div
                key={i}
                style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: i < highlights.length - 1 ? '1px solid #EDE9FE' : 'none' }}
              >
                <div style={{ display: 'flex', fontSize: 21, color: '#4B5563' }}>{h.label}</div>
                <div style={{ display: 'flex', fontSize: 21, color: '#111827', fontWeight: 700 }}>{h.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Signature */}
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 30 }}>
          <div style={{ display: 'flex', fontSize: 20, color: '#111827', fontWeight: 700 }}>{d.from_name || 'HR Team'}</div>
          <div style={{ display: 'flex', fontSize: 18, color: '#6B7280' }}>Human Resources, {lh.name}</div>
        </div>

        {/* Company letterhead footer */}
        <LetterheadFooter lh={lh} />
      </div>
    ),
    { width: 1000, height: 1414 },
  )

  return Buffer.from(await img.arrayBuffer())
}
