// lib/letterheads.tsx — Sharma Group company letterheads for every generated document
// (offer letters, HR letters, etc.). Satori-compatible header/footer (next/og ImageResponse):
// all elements display:flex, px units, solid/gradient-via-backgroundImage only.
import React from 'react'

export interface Letterhead {
  code: string
  name: string
  type: string            // 'Private Limited'
  eyebrow: string         // 'A Sharma Group Company'
  badge: string           // 'SRS'
  addr: string[]          // address + contact lines
  cin: string; gstin: string; pan: string; extra?: string
  headerBg: string        // SOLID css color (satori-safe — no gradients)
  headerText: string      // main text color on header
  headerSub: string       // muted text color on header
  accent: string          // footer bar / accent
  footerRegistered: string
  confidential: string
}

// The 3 Sharma Group companies (from the provided letterheads).
export const LETTERHEADS: Record<string, Letterhead> = {
  SRS: {
    code: 'SRS', name: 'Sharma Retail Solutions', type: 'Private Limited', eyebrow: 'A Sharma Group Company', badge: 'SRS',
    addr: ['Tower B, DLF Cyber City', 'Gurugram, Haryana — 122 002', 'Ph: +91 124 456 7892', 'E: info@sharmaretail.in', 'W: www.sharmaretail.in'],
    cin: 'U52100DL2018PTC330456', gstin: '07AAKSR1234B1ZP', pan: 'AAKSR1234B', extra: 'Incorp. 2018 · Delhi',
    headerBg: '#0E7490', headerText: '#FFFFFF', headerSub: 'rgba(255,255,255,0.72)', accent: '#1D4ED8',
    footerRegistered: 'Registered Office: Tower B, DLF Cyber City, Gurugram, Haryana — 122 002, India',
    confidential: 'This letter is confidential and intended solely for the named addressee. Unauthorised disclosure or copying is strictly prohibited.',
  },
  SSM: {
    code: 'SSM', name: 'Sharma Sons Manufacturing', type: 'Private Limited', eyebrow: 'A Sharma Group Company · Since 2010', badge: 'SSM',
    addr: ['Plot 12, Sector 5, Dwarka', 'New Delhi — 110 075', 'Ph: +91 11 2891 7654', 'E: works@sharmasons.in', 'W: www.sharmasons.in'],
    cin: 'U29100HR2010PTC040123', gstin: '06AAHSS2345C1ZR', pan: 'AAHSS2345C', extra: 'UDYAM-HR-05-0034821',
    headerBg: '#1B2A4A', headerText: '#FFFFFF', headerSub: 'rgba(255,255,255,0.7)', accent: '#E85D04',
    footerRegistered: 'Registered Office: Plot 12, Sector 5, Dwarka, New Delhi — 110 075, India · ISO 9001:2015 Certified',
    confidential: 'This document is confidential. Contents are not to be reproduced without prior written consent of Sharma Sons Manufacturing Pvt Ltd.',
  },
  STC: {
    code: 'STC', name: 'Sharma Trading Corporation', type: 'Established · Bombay', eyebrow: 'A Sharma Group Company · Mumbai', badge: 'STC',
    addr: ['Office 301, Nariman Point', 'Mumbai, Maharashtra — 400 021', 'Ph: +91 22 6612 4400', 'E: trade@sharmatcorp.in', 'W: www.sharmatcorp.in'],
    cin: 'U51909MH2005PTC291234', gstin: '27AAHST3456D1ZS', pan: 'AAHST3456D', extra: 'IEC 0305021987',
    headerBg: '#6B0F1A', headerText: '#FFFFFF', headerSub: 'rgba(255,255,255,0.72)', accent: '#B8860B',
    footerRegistered: 'Registered Office: Office 301, Nariman Point, Mumbai, Maharashtra — 400 021, India',
    confidential: 'This correspondence is confidential and privileged. Any unauthorised review, use, disclosure or distribution is prohibited.',
  },
}

// Resolve the right letterhead from a company name/code. Matches by keyword so
// "Sharma Sons Manufacturing Pvt Ltd", "SSM", "sharmasons" all map to SSM.
export function resolveLetterhead(companyNameOrCode?: string | null): Letterhead {
  const s = (companyNameOrCode || '').toLowerCase()
  if (/\bsrs\b|retail/.test(s)) return LETTERHEADS.SRS
  if (/\bstc\b|trading|nariman/.test(s)) return LETTERHEADS.STC
  if (/\bssm\b|sons|manufactur/.test(s)) return LETTERHEADS.SSM
  return LETTERHEADS.SSM // default group company
}

// ── HTML letterhead (for email/HTML documents: ack email, loan agreement, transfer letter) ──
const _esc = (s: any) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))
export function letterheadHeaderHtml(lh: Letterhead): string {
  return `<div style="background:${lh.headerBg};color:#fff;padding:20px 28px;display:flex;justify-content:space-between;align-items:flex-start">
    <div style="display:flex;align-items:center">
      <div style="width:52px;height:52px;border-radius:12px;background:rgba(255,255,255,.15);border:2px solid rgba(255,255,255,.35);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;margin-right:14px">${_esc(lh.badge)}</div>
      <div><div style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.6)">${_esc(lh.eyebrow)}</div>
      <div style="font-size:21px;font-weight:700;line-height:1.1">${_esc(lh.name)}</div>
      <div style="font-size:11px;color:rgba(255,255,255,.65)">${_esc(lh.type)}</div></div>
    </div>
    <div style="text-align:right;font-size:11px;color:rgba(255,255,255,.8);line-height:1.8">${lh.addr.map(_esc).join('<br>')}</div>
  </div>
  <div style="height:5px;background:${lh.accent}"></div>
  <div style="padding:6px 28px;font-size:11px;color:#6B7280;border-bottom:1px solid #EEE">CIN: ${_esc(lh.cin)} &nbsp;·&nbsp; GSTIN: ${_esc(lh.gstin)} &nbsp;·&nbsp; PAN: ${_esc(lh.pan)}${lh.extra ? ' &nbsp;·&nbsp; ' + _esc(lh.extra) : ''}</div>`
}
export function letterheadFooterHtml(lh: Letterhead): string {
  return `<div style="border-top:1px dashed #E5E7EB;padding:8px 28px;font-size:10px;color:#9CA3AF">${_esc(lh.confidential)}</div>
  <div style="height:4px;background:${lh.accent}"></div>
  <div style="background:${lh.headerBg};color:rgba(255,255,255,.85);padding:12px 28px;font-size:11px">${_esc(lh.footerRegistered)}<br><span style="color:rgba(255,255,255,.6)">CIN: ${_esc(lh.cin)} · GSTIN: ${_esc(lh.gstin)} · ${_esc(lh.eyebrow)}</span></div>`
}

// ── Satori-compatible header (for ImageResponse) ──
export function LetterheadHeader({ lh, date }: { lh: Letterhead; date: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 28 }}>
      <div style={{ display: 'flex', flexDirection: 'column', backgroundColor: lh.headerBg, padding: '26px 34px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 72, height: 72, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.15)', border: '2px solid rgba(255,255,255,0.35)' }}>
              <div style={{ display: 'flex', fontSize: 22, fontWeight: 800, color: lh.headerText }}>{lh.badge}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', fontSize: 13, color: lh.headerSub, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>{lh.eyebrow}</div>
              <div style={{ display: 'flex', fontSize: 32, fontWeight: 700, color: lh.headerText }}>{lh.name}</div>
              <div style={{ display: 'flex', fontSize: 15, color: lh.headerSub, marginTop: 3 }}>{lh.type}</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            {lh.addr.map((l, i) => <div key={i} style={{ display: 'flex', fontSize: 13, color: lh.headerSub, lineHeight: 1.7 }}>{l}</div>)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 22, marginTop: 16, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.15)' }}>
          <div style={{ display: 'flex', fontSize: 12, color: lh.headerSub }}>CIN: {lh.cin}</div>
          <div style={{ display: 'flex', fontSize: 12, color: lh.headerSub }}>GSTIN: {lh.gstin}</div>
          <div style={{ display: 'flex', fontSize: 12, color: lh.headerSub }}>PAN: {lh.pan}</div>
          {lh.extra ? <div style={{ display: 'flex', fontSize: 12, color: lh.headerSub }}>{lh.extra}</div> : null}
        </div>
      </div>
      <div style={{ display: 'flex', height: 5, backgroundColor: lh.accent }} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <div style={{ display: 'flex', fontSize: 16, color: '#6B7280' }}>{date}</div>
      </div>
    </div>
  )
}

// ── Satori-compatible footer (for ImageResponse) ──
export function LetterheadFooter({ lh }: { lh: Letterhead }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto' }}>
      <div style={{ display: 'flex', fontSize: 12, color: '#9CA3AF', paddingTop: 10, paddingBottom: 8, borderTop: '1px dashed #E5E7EB' }}>{lh.confidential}</div>
      <div style={{ display: 'flex', height: 4, backgroundColor: lh.accent }} />
      <div style={{ display: 'flex', flexDirection: 'column', backgroundColor: lh.headerBg, padding: '14px 20px' }}>
        <div style={{ display: 'flex', fontSize: 12, color: 'rgba(255,255,255,0.85)' }}>{lh.footerRegistered}</div>
        <div style={{ display: 'flex', fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 3 }}>CIN: {lh.cin} · GSTIN: {lh.gstin} · {lh.eyebrow}</div>
      </div>
    </div>
  )
}
