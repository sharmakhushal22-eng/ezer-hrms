import { ImageResponse } from 'next/og'
import { PDFDocument } from 'pdf-lib'

export interface OfferImageData {
  candidate_name?: string
  designation?: string
  company_name?: string
  annual_ctc?: number
  variable_pct?: number
  monthly_basic?: number
  monthly_hra?: number
  monthly_inhand?: number
  joining_bonus?: number
  retention_bonus?: number
  esop_value?: number
  proposed_doj?: string
  from_name?: string
  date?: string
}

const inr = (n?: number) => (n && n > 0 ? '₹ ' + Math.round(n).toLocaleString('en-IN') : '—')

function row(label: string, value: string, strong = false) {
  return (
    <div
      key={label}
      style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 0', borderBottom: '1px solid #EDE9FE' }}
    >
      <div style={{ color: '#4B5563', fontSize: 23 }}>{label}</div>
      <div style={{ color: strong ? '#7C3AED' : '#111827', fontSize: 23, fontWeight: 700 }}>{value}</div>
    </div>
  )
}

// Renders a professional A4-portrait offer letter to a PNG Buffer.
export async function renderOfferLetterPng(d: OfferImageData): Promise<Buffer> {
  const company = d.company_name || 'Our Company'
  const date =
    d.date || new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
  const doj = d.proposed_doj
    ? new Date(d.proposed_doj).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
    : 'To be confirmed'
  const variable = d.annual_ctc && d.variable_pct ? d.annual_ctc * (d.variable_pct / 100) : 0
  const fixed = d.annual_ctc ? d.annual_ctc - variable : 0

  const compRows = [
    row('Annual CTC (Fixed + Variable)', inr(d.annual_ctc), true),
    row(`Fixed / Variable (${d.variable_pct || 0}%)`, `${inr(fixed)}   /   ${inr(variable)}`),
    row('Monthly Basic', inr(d.monthly_basic)),
    row('Monthly HRA', inr(d.monthly_hra)),
    row('Est. Net Take-Home (monthly)', inr(d.monthly_inhand)),
    d.joining_bonus ? row('Joining Bonus', inr(d.joining_bonus)) : null,
    d.retention_bonus ? row('Retention Bonus', inr(d.retention_bonus)) : null,
    d.esop_value ? row('ESOP Grant Value', inr(d.esop_value)) : null,
  ].filter(Boolean)

  const img = new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          backgroundColor: '#FFFFFF',
          padding: '64px 72px',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', flexDirection: 'column', borderBottom: '4px solid #7C3AED', paddingBottom: 18, marginBottom: 30 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', fontSize: 48, fontWeight: 800, color: '#1E1B4B' }}>{company}</div>
            <div style={{ display: 'flex', fontSize: 18, color: '#9CA3AF' }}>{date}</div>
          </div>
          <div style={{ display: 'flex', fontSize: 24, color: '#7C3AED', fontWeight: 700, letterSpacing: 5, marginTop: 10 }}>
            OFFER OF EMPLOYMENT
          </div>
        </div>

        <div style={{ display: 'flex', fontSize: 25, color: '#111827', marginBottom: 12 }}>Dear {d.candidate_name || 'Candidate'},</div>
        <div style={{ display: 'flex', fontSize: 22, color: '#374151', lineHeight: 1.5, marginBottom: 26 }}>
          We are delighted to extend an offer of employment for the position of {d.designation || 'the role'} at {company} — we were impressed by your background and look forward to welcoming you to our team.
        </div>

        {/* Compensation */}
        <div style={{ display: 'flex', flexDirection: 'column', backgroundColor: '#F8F7FF', border: '1px solid #E9E5FF', borderRadius: 16, padding: '20px 30px', marginBottom: 28 }}>
          <div style={{ display: 'flex', fontSize: 20, fontWeight: 700, color: '#6D28D9', letterSpacing: 3, marginBottom: 6 }}>
            COMPENSATION SUMMARY
          </div>
          {compRows}
        </div>

        <div style={{ display: 'flex', fontSize: 23, marginBottom: 10 }}>
          <div style={{ display: 'flex', color: '#111827' }}>Proposed Date of Joining:&nbsp;</div>
          <div style={{ display: 'flex', color: '#111827', fontWeight: 700 }}>{doj}</div>
        </div>
        <div style={{ display: 'flex', fontSize: 18, color: '#6B7280', lineHeight: 1.5, marginBottom: 30 }}>
          This offer is valid for 7 days and is contingent upon successful background verification, submission of the
          required documents, and medical fitness.
        </div>

        {/* Signature */}
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto' }}>
          <div style={{ display: 'flex', fontSize: 21, color: '#111827', fontWeight: 700 }}>{d.from_name || 'HR Team'}</div>
          <div style={{ display: 'flex', fontSize: 18, color: '#6B7280' }}>Human Resources, {company}</div>
          <div style={{ display: 'flex', fontSize: 14, color: '#C4B5FD', marginTop: 20 }}>Generated by EZER HRMS · Confidential</div>
        </div>
      </div>
    ),
    { width: 1000, height: 1414 },
  )

  return Buffer.from(await img.arrayBuffer())
}

// Wraps the offer-letter PNG into a single-page A4 PDF (the image is already
// A4-proportioned, so it fills the page edge-to-edge).
export async function pngToPdf(png: Buffer): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  const image = await pdf.embedPng(png)
  const A4W = 595.28
  const A4H = 841.89
  const scale = A4W / image.width
  const w = image.width * scale
  const h = image.height * scale
  const page = pdf.addPage([A4W, A4H])
  page.drawImage(image, { x: 0, y: A4H - h, width: w, height: h })
  return Buffer.from(await pdf.save())
}
