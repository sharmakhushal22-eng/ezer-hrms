// ============================================================
// EZER HRMS — Loan Agreement API (sign both ways + review)
// Path: app/api/ess/loans/agreement/route.ts
// ============================================================
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { resolveLetterhead, letterheadHeaderHtml, letterheadFooterHtml } from '@/lib/letterheads';
export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
);

const esc = (s: any) => String(s ?? '').replace(/[&<>]/g, (c: string) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
const inr = (n: any) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

// ============================================================
// GET — fetch agreement. JSON by default; ?format=html → letterheaded printable agreement.
// ?request_id=xxx
// ============================================================
export async function GET(req: NextRequest) {
  const requestId = req.nextUrl.searchParams.get('request_id');
  const format = req.nextUrl.searchParams.get('format');
  const { data: agr } = await supabase
    .from('loan_agreements').select('*').eq('request_id', requestId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!agr) return NextResponse.json({ error: 'No agreement' }, { status: 404 });

  if (format === 'html') {
    const [{ data: request }, { data: emp }] = await Promise.all([
      supabase.from('loan_requests').select('*').eq('id', agr.request_id).maybeSingle(),
      supabase.from('employees').select('full_name, emp_code, company_id').eq('id', agr.employee_id).maybeSingle(),
    ]);
    const { data: co } = emp?.company_id ? await supabase.from('companies').select('company_name').eq('id', emp.company_id).maybeSingle() : { data: null } as any;
    const { data: lt } = request?.loan_type_id ? await supabase.from('loan_types').select('name').eq('id', request.loan_type_id).maybeSingle() : { data: null } as any;
    const lh = resolveLetterhead(co?.company_name);
    const sched = (Array.isArray(agr.schedule_snapshot) ? agr.schedule_snapshot : (typeof agr.schedule_snapshot === 'string' ? JSON.parse(agr.schedule_snapshot) : [])) as any[];
    const rows = sched.map(r => `<tr><td>${r.installment_number}</td><td>${esc(r.due_date)}</td><td style="text-align:right">${inr(r.emi_amount)}</td><td style="text-align:right">${inr(r.principal_component)}</td><td style="text-align:right">${inr(r.interest_component)}</td><td style="text-align:right">${inr(r.closing_balance)}</td></tr>`).join('');
    const total = sched.reduce((s, r) => s + (Number(r.emi_amount) || 0), 0);
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Loan Agreement — ${esc(agr.agreement_number)}</title>
<style>body{font-family:'DM Sans','Segoe UI',Arial,sans-serif;color:#1E1B4B;max-width:760px;margin:0 auto 32px;line-height:1.6}
.wrap{padding:16px 28px}h1{font-size:18px;border-bottom:2px solid ${lh.accent};padding-bottom:8px}
table.sch{width:100%;border-collapse:collapse;font-size:12px;margin-top:10px}
table.sch th{background:#F5F3FF;text-align:left;padding:6px 8px;color:#6B7280;font-size:10px;text-transform:uppercase}
table.sch td{padding:5px 8px;border-top:1px solid #F1EDFB}
.kv{display:flex;flex-wrap:wrap;gap:6px 22px;margin:10px 0;font-size:13px}.kv b{color:#111}
.sig{margin-top:30px;font-size:13px;color:#374151}
@media print{body{margin:0}}</style></head><body>
${letterheadHeaderHtml(lh)}
<div class="wrap">
<h1>LOAN AGREEMENT</h1>
<div style="font-size:12px;color:#6B7280;margin:8px 0">Agreement No: <b>${esc(agr.agreement_number)}</b> · Status: ${esc(agr.status)}</div>
<div class="kv">
  <div>Employee: <b>${esc(emp?.full_name)}</b> (${esc(emp?.emp_code)})</div>
  <div>Loan Type: <b>${esc(lt?.name || '—')}</b></div>
  <div>Principal: <b>${inr(request?.requested_amount)}</b></div>
  <div>Tenure: <b>${esc(request?.requested_tenure_months)} months</b></div>
  <div>Indicative EMI: <b>${inr(request?.indicative_emi)}</b></div>
</div>
<h3 style="font-size:13px;margin-top:14px">Repayment Schedule</h3>
<table class="sch"><thead><tr><th>#</th><th>Due date</th><th style="text-align:right">EMI</th><th style="text-align:right">Principal</th><th style="text-align:right">Interest</th><th style="text-align:right">Balance</th></tr></thead>
<tbody>${rows || '<tr><td colspan="6">Schedule pending disbursement.</td></tr>'}</tbody>
<tfoot><tr><td colspan="2" style="font-weight:700;border-top:2px solid ${lh.accent}">Total</td><td style="text-align:right;font-weight:700;border-top:2px solid ${lh.accent}">${inr(total)}</td><td colspan="3" style="border-top:2px solid ${lh.accent}"></td></tr></tfoot></table>
<p style="font-size:11px;color:#6B7280;margin-top:14px">The employee authorises recovery of the above EMIs via monthly salary deduction until the loan is fully repaid, and agrees that any outstanding balance on separation will be recovered from the full & final settlement.</p>
<div class="sig">Accepted &amp; agreed:<br><br>${agr.esign_name ? '<b>' + esc(agr.esign_name) + '</b> (e-signed)' : '________________________'}<br>${esc(emp?.full_name)} · ${esc(emp?.emp_code)}${agr.signed_at ? ' · ' + new Date(agr.signed_at).toLocaleDateString('en-IN') : ''}</div>
</div>
${letterheadFooterHtml(lh)}
</body></html>`;
    return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  return NextResponse.json({ agreement: agr });
}

// ============================================================
// POST — employee signs (BOTH options)
// Body ESIGN:  { agreement_id, employee_id, signature_type:'ESIGN',
//               esign_name, esign_image_url? }
// Body UPLOAD: { agreement_id, employee_id, signature_type:'UPLOAD',
//               signed_pdf_url }
// ============================================================
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { agreement_id, employee_id, signature_type,
          esign_name, esign_image_url, signed_pdf_url } = body;

  const { data: agr } = await supabase
    .from('loan_agreements').select('*').eq('id', agreement_id).single();
  if (!agr) return NextResponse.json({ error: 'Agreement not found' }, { status: 404 });
  if (agr.status !== 'GENERATED') {
    return NextResponse.json({ error: 'Already signed or processed' }, { status: 400 });
  }

  // Validate by type
  if (signature_type === 'ESIGN') {
    if (!esign_name) return NextResponse.json({ error: 'Name required for e-sign' }, { status: 400 });
  } else if (signature_type === 'UPLOAD') {
    if (!signed_pdf_url) return NextResponse.json({ error: 'Signed PDF required' }, { status: 400 });
  } else {
    return NextResponse.json({ error: 'Invalid signature_type' }, { status: 400 });
  }

  await supabase.from('loan_agreements').update({
    signature_type,
    esign_name: signature_type === 'ESIGN' ? esign_name : null,
    esign_image_url: signature_type === 'ESIGN' ? esign_image_url : null,
    signed_pdf_url: signature_type === 'UPLOAD' ? signed_pdf_url : null,
    signed_at: new Date().toISOString(),
    status: 'UNDER_REVIEW'
  }).eq('id', agreement_id);

  await supabase.from('loan_audit_log').insert({
    request_id: agr.request_id, employee_id, action: 'AGREEMENT_SIGNED',
    new_value: { signature_type }, performed_by: employee_id, source: 'ESS'
  });

  return NextResponse.json({ success: true, status: 'UNDER_REVIEW' });
}

// ============================================================
// PATCH — HR/Finance reviews the signed agreement
// Body: { agreement_id, reviewer_id, action:'APPROVED'|'REJECTED', review_remarks }
// ============================================================
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { agreement_id, reviewer_id, action, review_remarks } = body;

  const { data: agr } = await supabase
    .from('loan_agreements').select('*').eq('id', agreement_id).single();
  if (!agr) return NextResponse.json({ error: 'Agreement not found' }, { status: 404 });

  await supabase.from('loan_agreements').update({
    status: action, reviewed_by: reviewer_id,
    reviewed_at: new Date().toISOString(), review_remarks
  }).eq('id', agreement_id);

  await supabase.from('loan_audit_log').insert({
    request_id: agr.request_id, employee_id: agr.employee_id,
    action: `AGREEMENT_${action}`, new_value: { review_remarks },
    performed_by: reviewer_id, source: 'ADMIN'
  });

  // APPROVED -> ready for finance disbursement (PUT /api/loans/admin)
  return NextResponse.json({ success: true, status: action });
}
