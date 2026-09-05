'use client';
import { authHeaders } from '@/lib/auth-headers';

import { useEffect, useMemo, useRef, useState } from 'react';
import IdCard from './IdCard';
import PhotoUploader from './PhotoUploader';
import type { ProfileField, ProfilePayload, ProfileTab } from '@/lib/profile/types';

interface Props {
  data: ProfilePayload & { tabs: ProfileTab[] };
  photoUrl: string | null;
  isSelf: boolean;
}

const initials = (n: string) =>
  n.split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();

export default function ProfileShell({ data, photoUrl, isSelf }: Props) {
  const e = data.employee as any;
  const [tab, setTab] = useState(data.tabs[0]?.key ?? 'personal');
  const [photo, setPhoto] = useState(photoUrl);
  const [showPhoto, setShowPhoto] = useState(false);
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [req, setReq] = useState<ProfileField | null>(null);
  const [q, setQ] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [mini, setMini] = useState(false);
  const idRef = useRef<HTMLDivElement | null>(null);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const [glider, setGlider] = useState({ left: 0, width: 0 });

  const say = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2900); };

  useEffect(() => {
    if (!idRef.current) return;
    const io = new IntersectionObserver(([x]) => setMini(!x.isIntersecting), {
      rootMargin: '-70px 0px 0px 0px',
    });
    io.observe(idRef.current);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const a = tabsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (a) setGlider({ left: a.offsetLeft, width: a.offsetWidth });
  }, [tab]);

  const active = useMemo(() => data.tabs.find(t => t.key === tab), [tab, data.tabs]);

  const sendRequest = async (newValue: string, reason: string) => {
    if (!req) return;
    const r = await fetch('/api/ess/profile/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({
        code: e.employee_code, fieldKey: req.key, fieldLabel: req.label, newValue, reason,
      }),
    });
    const j = await r.json();
    setReq(null);
    say(r.ok ? `Update request sent for "${req.label}"` : (j.message ?? j.error ?? 'Could not send.'));
  };

  const routeLine = (f: ProfileField) => {
    if (/bank|ifsc|account/i.test(f.key))
      return 'Goes to Payroll, not HR. A cancelled cheque or a statement in the same name is needed before it reaches the next salary batch.';
    if (/address/i.test(f.key))
      return `Goes to ${e.rm_l1_name ?? 'your reporting manager'} then HR. An address change also updates the Professional Tax state and HRA exemption from the next payroll month.`;
    if (/marital|family|nominee/i.test(f.key))
      return 'Goes to HR. Nominee shares in one scheme must add up to exactly 100% before it can be filed.';
    return `Goes to ${e.rm_l1_name ?? 'your reporting manager'} then HR. Track it under Records.`;
  };

  const chain = [
    e.md_name && [e.md_name, 'Managing Director'],
    e.hod_name && [e.hod_name, 'HOD'],
    e.rm_l2_name && [e.rm_l2_name, 'Reporting Manager L2'],
    e.rm_l1_name && [e.rm_l1_name, 'Reporting Manager L1'],
    [e.full_name, `${isSelf ? 'You' : 'This person'} · ${e.reportee_count ?? 0} reportees`],
  ].filter(Boolean) as [string, string][];

  const kpis: [string, string | number, string][] = [
    ['Tenure', `${e.tenure_years ?? 0}.${e.tenure_months ?? 0}`, 'yrs'],
    ['Profile score', data.completeness, '%'],
    ['Reportees', e.reportee_count ?? 0, 'people'],
    ['Documents', data.documents.filter((d: any) => d.status === 'verified').length, 'verified'],
    ['Assets', data.assets.length, 'issued'],
    ['Open items', data.pending.length, 'pending'],
  ];

  return (
    <div className="ez-shell">
      {/* ── sticky mini header ── */}
      <div className={`ez-mini ${mini ? 'ez-on' : ''}`}>
        <span className="ez-miniav">
          {photo ? <img src={photo} alt="" /> : initials(e.full_name)}
        </span>
        <div>
          <div className="ez-mininm">{e.full_name}</div>
          <div className="ez-minisb">{e.employee_code} · {e.designation}</div>
        </div>
      </div>

      {/* ── cover ── */}
      <div className="ez-cover">
        <div className="ez-au"><i /><i /><i /></div>
        <div className="ez-mesh" />
        <div className="ez-sheen" />
      </div>

      {/* ── identity ── */}
      <section className="ez-id" ref={idRef}>
        <div style={{ position: 'relative', marginTop: -58 }}>
          <div
            className="ez-av"
            role={isSelf ? 'button' : undefined}
            tabIndex={isSelf ? 0 : -1}
            onClick={() => isSelf && setShowPhoto(true)}
            onKeyDown={ev => isSelf && ev.key === 'Enter' && setShowPhoto(true)}
          >
            {photo ? <img src={photo} alt="" /> : <span className="ez-ini">{initials(e.full_name)}</span>}
            {isSelf && <span className="ez-veil">Change photo</span>}
            <span className={`ez-dot ${e.status === 'active' ? '' : 'ez-away'}`} />
          </div>
        </div>

        <div>
          <h1 className="ez-name">{e.full_name}</h1>
          <p className="ez-desig">{e.designation} · <b>{e.department_name}</b></p>
          <div className="ez-tags">
            <span className="ez-tg ez-code">{e.employee_code}</span>
            <span className={`ez-tg ${e.date_of_leaving ? 'ez-warn' : 'ez-ok'}`}>
              {e.date_of_leaving ? 'Serving notice' : (e.status ?? 'Active')}
            </span>
            {e.grade && <span className="ez-tg">{e.grade}{e.job_level ? ` · ${e.job_level}` : ''}</span>}
            {e.employment_type && <span className="ez-tg">{e.employment_type}</span>}
            {e.shift_name && <span className="ez-tg">{e.shift_name}</span>}
          </div>
          <div className="ez-facts">
            <div>🏢 <b>{e.company_name}</b></div>
            <div>📍 <b>{e.location_name}</b></div>
            <div>📅 Joined <b>{e.date_of_joining}</b></div>
            <div>⏳ <b>{e.tenure_years} yrs {e.tenure_months} mos</b></div>
            {e.workstation && <div>🪑 <b>{e.workstation}</b></div>}
          </div>
        </div>

        <div className="ez-acts">
          {isSelf && <button className="ez-btn ez-pri" onClick={() => setTab('personal')}>Edit profile</button>}
          {isSelf && (
            <button
              className="ez-btn"
              onClick={() => setReq(active?.groups[0]?.fields.find(f => f.state === 'request') ?? null)}
            >
              Request an update
            </button>
          )}
          <a
            className="ez-btn"
            href={`data:text/vcard;charset=utf-8,${encodeURIComponent(
              `BEGIN:VCARD\nVERSION:3.0\nFN:${e.full_name}\nORG:${e.company_name}\nTITLE:${e.designation}\nTEL;TYPE=CELL:${e.mobile ?? ''}\nEMAIL:${e.official_email ?? ''}\nEND:VCARD`
            )}`}
            download={`${e.employee_code}.vcf`}
          >
            Save contact
          </a>
        </div>
      </section>

      {/* ── kpis ── */}
      <div className="ez-kpis">
        {kpis.map(([l, v, u], i) => (
          <div className="ez-kpi" key={l} style={{ animationDelay: `${i * 45}ms` }}>
            <div className="ez-kl">{l}</div>
            <div className="ez-kv">{v}<small>{u}</small></div>
          </div>
        ))}
      </div>

      <div className="ez-body">
        {/* ── rail ── */}
        <aside className="ez-rail">
          <div className="ez-card">
            <div className="ez-hd">
              <h3>Profile completeness</h3>
              <span className={`ez-pill ${data.pending.length ? 'ez-warn' : 'ez-ok'}`}>
                {data.pending.length ? `${data.pending.length} pending` : 'all clear'}
              </span>
            </div>
            <div className="ez-bd">
              <div className="ez-ringrow">
                <div className="ez-ring">
                  <svg width="88" height="88" viewBox="0 0 88 88">
                    <circle className="ez-tk" cx="44" cy="44" r="37" />
                    <circle
                      className="ez-fl" cx="44" cy="44" r="37"
                      strokeDasharray={232}
                      strokeDashoffset={232 - (232 * data.completeness) / 100}
                    />
                  </svg>
                  <div className="ez-ct"><b>{data.completeness}%</b><span>complete</span></div>
                </div>
                <div className="ez-subtle">
                  {data.pending.length
                    ? 'Finishing these keeps payroll and statutory records clean.'
                    : 'Every field is filled and verified.'}
                </div>
              </div>
              <ul className="ez-todo">
                {data.pending.map(t => <li key={t}><i />{t}</li>)}
              </ul>
            </div>
          </div>

          <div className="ez-card">
            <div className="ez-hd"><h3>Reporting chain</h3>
              <span className="ez-subtle">{e.reportee_count ?? 0} reportees</span></div>
            <div className="ez-bd">
              <ul className="ez-chain">
                {chain.map(([n, r], i) => (
                  <li key={n + i} className={i === chain.length - 1 ? 'ez-self' : ''}>
                    <span className="ez-p">{initials(n)}</span>
                    <div><div className="ez-n">{n}</div><div className="ez-r">{r}</div></div>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {isSelf && (
            <IdCard
              name={e.full_name}
              code={e.employee_code}
              designation={e.designation ?? ''}
              company={(e.company_name ?? '').replace(/ P(vt|VT).*/, '')}
              photoUrl={photo}
              initials={initials(e.full_name)}
              bloodGroup={e.blood_group}
              doj={e.date_of_joining}
              emergency={e.emergency_contact_1}
            />
          )}
        </aside>

        {/* ── main ── */}
        <main>
          <div className="ez-tabwrap">
            <div className="ez-tabs" ref={tabsRef} role="tablist">
              <span className="ez-gl" style={{ left: glider.left, width: glider.width }} />
              {data.tabs.map(t => (
                <button
                  key={t.key} role="tab" className="ez-tab"
                  aria-selected={t.key === tab} onClick={() => setTab(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="ez-legend">
            <span><b style={{ color: '#059669' }}>Direct</b> — change it yourself</span>
            <span><b style={{ color: '#D97706' }}>Request</b> — goes for approval</span>
            <span><b style={{ color: '#64748B' }}>Locked</b> — HR maintains it</span>
            <span><b style={{ color: '#7C3AED' }}>Event</b> — starts another workflow</span>
            <input
              className="ez-find" placeholder="Filter fields" value={q}
              onChange={ev => setQ(ev.target.value)}
            />
          </div>

          {active?.groups.map((g, gi) => {
            const fields = g.fields.filter(
              f => !q || (f.label + ' ' + (f.value ?? '')).toLowerCase().includes(q.toLowerCase())
            );
            if (!fields.length) return null;
            return (
              <section className="ez-sec" key={g.title} style={{ animationDelay: `${gi * 55}ms` }}>
                <div className="ez-sechd"><h2>{g.title}</h2></div>
                <div className="ez-g3">
                  {fields.map(f => (
                    <div className={`ez-fld ${f.wide ? 'ez-span2' : ''}`} key={f.key}>
                      <span className={`ez-st ez-${f.state}`}>
                        {f.state[0].toUpperCase() + f.state.slice(1)}
                      </span>
                      <div className="ez-k">{f.label}</div>
                      <div className={`ez-v ${f.mono ? 'ez-mono' : ''}`}>
                        {f.restricted
                          ? <span className="ez-no">Restricted — HR, Payroll and Admin only</span>
                          : f.masked
                            ? <>
                                <span className={`ez-msk ${reveal[f.key] ? 'ez-show' : ''}`}>{f.value}</span>
                                <button
                                  className="ez-eye"
                                  onClick={() => setReveal(r => ({ ...r, [f.key]: !r[f.key] }))}
                                  aria-label="Reveal value"
                                >👁</button>
                              </>
                            : f.value}
                      </div>
                      {f.hint && <div className="ez-hint">{f.hint}</div>}
                      <div className="ez-src">{f.column}</div>
                      {isSelf && !f.restricted && (f.state === 'request' || f.state === 'event') && (
                        <div className="ez-fx"><button onClick={() => setReq(f)}>Request</button></div>
                      )}
                      {isSelf && !f.restricted && f.state === 'direct' && (
                        <div className="ez-fx"><button onClick={() => setReq(f)}>Edit</button></div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </main>
      </div>

      {/* ── request modal ── */}
      {req && (
        <RequestModal
          field={req}
          route={routeLine(req)}
          onClose={() => setReq(null)}
          onSend={sendRequest}
        />
      )}

      <PhotoUploader
        open={showPhoto}
        onClose={() => setShowPhoto(false)}
        onDone={url => { setPhoto(url); say('Photo updated.'); }}
      />

      {toast && (
        <div className="ez-toasts"><div className="ez-toast"><span className="ez-ti">✓</span>{toast}</div></div>
      )}
    </div>
  );
}

function RequestModal({
  field, route, onClose, onSend,
}: {
  field: ProfileField; route: string; onClose: () => void;
  onSend: (v: string, r: string) => void;
}) {
  const [v, setV] = useState('');
  const [r, setR] = useState('');
  return (
    <div className="ez-scrim ez-on" onClick={ev => ev.target === ev.currentTarget && onClose()}>
      <div className="ez-modal">
        <div className="ez-mh">
          <h3>Request an update</h3>
          <p>HR sees the old and the new value side by side before approving.</p>
        </div>
        <div className="ez-mb">
          <label className="ez-lb">Field</label>
          <input className="ez-inp" readOnly value={field.label} />
          <label className="ez-lb" style={{ marginTop: 12 }}>New value</label>
          <textarea className="ez-inp ez-ta" value={v} onChange={ev => setV(ev.target.value)}
                    placeholder="Type the corrected value" />
          <label className="ez-lb" style={{ marginTop: 12 }}>Reason</label>
          <input className="ez-inp" value={r} onChange={ev => setR(ev.target.value)}
                 placeholder="Shifted to a new flat in June" />
          <div className="ez-note" style={{ marginTop: 12 }}>{route}</div>
        </div>
        <div className="ez-mf">
          <button className="ez-btn" onClick={onClose}>Cancel</button>
          <button className="ez-btn ez-pri" disabled={!v.trim()} onClick={() => onSend(v, r)}>
            Send request
          </button>
        </div>
      </div>
    </div>
  );
}
