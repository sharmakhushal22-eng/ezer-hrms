'use client'
import { useState } from 'react'

const stats = [
  { label: 'Total Employees', value: '1,247', sub: '▲ 12 this month', color: '#7C3AED', up: true },
  { label: 'Active', value: '1,198', sub: '96.1% active', color: '#16A34A', up: true },
  { label: 'On Leave Today', value: '34', sub: '⚠ 3 long leaves', color: '#3B82F6', up: false },
  { label: 'Payroll (May)', value: '₹24.5L', sub: '▲ ₹1.2L vs Apr', color: '#F97316', up: true },
  { label: 'Compliance Due', value: '3', sub: '⚠ Action needed', color: '#EF4444', up: false },
]

const companies = [
  { name: 'Sharma Sons', count: 412, pct: 85, color: '#7C3AED' },
  { name: 'Sharma Petro', count: 315, pct: 65, color: '#3B82F6' },
  { name: 'Sharma Rail', count: 243, pct: 50, color: '#16A34A' },
  { name: 'Sharma Bros', count: 189, pct: 40, color: '#F97316' },
  { name: 'Sharma Trans', count: 88, pct: 20, color: '#EF4444' },
]

const locations = [
  { name: 'Delhi HQ', emp: 312, top: '28%', left: '38%', color: '#7C3AED' },
  { name: 'Panipat Factory', emp: 145, top: '35%', left: '32%', color: '#7C3AED' },
  { name: 'Gurgaon Branch', emp: 89, top: '45%', left: '30%', color: '#3B82F6' },
  { name: 'Jaipur Depot', emp: 67, top: '60%', left: '22%', color: '#16A34A' },
  { name: 'Mathura Refinery', emp: 203, top: '55%', left: '48%', color: '#F97316' },
  { name: 'Agra Warehouse', emp: 78, top: '65%', left: '55%', color: '#7C3AED' },
  { name: 'Ahmedabad', emp: 156, top: '72%', left: '28%', color: '#3B82F6' },
  { name: 'Mumbai Office', emp: 197, top: '78%', left: '40%', color: '#16A34A' },
]

const compliance = [
  { status: 'Overdue', label: 'PT Return — Maharashtra', sub: 'Was due 30 Apr', action: 'File Now', statusColor: '#DC2626', bg: '#FEE2E2' },
  { status: 'Due Soon', label: 'PF Challan — All locations', sub: 'Due 15 May', action: '3 days left', statusColor: '#D97706', bg: '#FEF3C7' },
  { status: 'Due Soon', label: 'ESI Return — Monthly', sub: 'Due 21 May', action: '9 days left', statusColor: '#D97706', bg: '#FEF3C7' },
  { status: 'Filed', label: 'TDS Return Q4 — Form 26Q', sub: 'Filed 28 Apr', action: '✓ Done', statusColor: '#16A34A', bg: '#DCFCE7' },
  { status: 'Filed', label: 'Factory License Renewal', sub: 'Valid till Dec 2026', action: '✓ Valid', statusColor: '#16A34A', bg: '#DCFCE7' },
]

const activities = [
  { icon: '👤', bg: '#EDE9FE', text: 'Rahul Sharma joined Sharma Sons — Delhi HQ', time: 'Today, 9:30 AM' },
  { icon: '✅', bg: '#DCFCE7', text: 'Payroll approved — Sharma Rail (243 employees)', time: 'Yesterday, 6:15 PM' },
  { icon: '🚪', bg: '#FEE2E2', text: 'F&F settled — Priya Singh, Sharma Bros (₹1,24,500)', time: '2 days ago' },
  { icon: '⚠️', bg: '#FEF3C7', text: 'PF challan pending — Sharma Petro, Mathura', time: '3 days ago' },
  { icon: '📄', bg: '#DBEAFE', text: 'Experience letter generated — 3 employees', time: '4 days ago' },
]

const celebrations = {
  today: [
    { name: 'Rahul Sharma', type: 'birthday', company: 'Sharma Sons' },
    { name: 'Priya Singh', type: 'anniversary', years: 5, company: 'Sharma Sons' },
  ],
  upcoming: [
    { name: 'Amit Kumar', type: 'birthday', day: 'Tomorrow', company: 'Sharma Rail' },
    { name: 'Rohit Verma', type: 'anniversary', years: 3, day: 'Wed', company: 'Sharma Bros' },
    { name: 'Sunita Devi', type: 'birthday', day: 'Thu', company: 'Sharma Petro' },
    { name: 'Vikram Singh', type: 'anniversary', years: 10, day: 'Fri', company: 'Sharma Trans' },
  ]
}

const navItems = [
  { icon: '🏠', label: 'Dashboard', active: true },
  { icon: '👥', label: 'Employees' },
  { icon: '📅', label: 'Attendance' },
  { icon: '💰', label: 'Payroll' },
  { icon: '⚖️', label: 'Compliance' },
  { icon: '🎯', label: 'Recruitment' },
  { icon: '📊', label: 'Reports' },
]

export default function Dashboard() {
  const [hoveredLoc, setHoveredLoc] = useState<number | null>(null)
  const [wishedToday, setWishedToday] = useState<string[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#F0F4F8', fontFamily: '"DM Sans","Segoe UI",sans-serif', fontSize: '13px' }}>

      {/* SIDEBAR */}
      <div style={{
        width: sidebarOpen ? '200px' : '56px',
        transition: 'width 0.25s ease',
        background: '#1E1B4B',
        display: 'flex',
        flexDirection: 'column',
        alignItems: sidebarOpen ? 'flex-start' : 'center',
        padding: sidebarOpen ? '14px 12px' : '14px 0',
        gap: '4px',
        flexShrink: 0,
        overflow: 'hidden',
      }}>
        <div onClick={() => setSidebarOpen(!sidebarOpen)} style={{ width: '36px', height: '36px', background: '#7C3AED', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '14px', marginBottom: '12px', cursor: 'pointer', flexShrink: 0 }}>
          {sidebarOpen ? '←' : 'Ez'}
        </div>

        {navItems.map((n, i) => (
          <div key={i} style={{ width: sidebarOpen ? '100%' : '36px', height: '36px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '10px', padding: sidebarOpen ? '0 10px' : '0', justifyContent: sidebarOpen ? 'flex-start' : 'center', fontSize: '16px', cursor: 'pointer', background: n.active ? '#7C3AED' : 'transparent', flexShrink: 0 }}>
            <span style={{ flexShrink: 0 }}>{n.icon}</span>
            {sidebarOpen && <span style={{ fontSize: '13px', fontWeight: n.active ? 500 : 400, whiteSpace: 'nowrap', color: n.active ? '#fff' : 'rgba(255,255,255,0.6)' }}>{n.label}</span>}
          </div>
        ))}

        <div style={{ flex: 1 }} />
        <div style={{ width: sidebarOpen ? '100%' : '36px', height: '36px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '10px', padding: sidebarOpen ? '0 10px' : '0', justifyContent: sidebarOpen ? 'flex-start' : 'center', fontSize: '16px', cursor: 'pointer', flexShrink: 0 }}>
          <span>⚙️</span>
          {sidebarOpen && <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap' }}>Settings</span>}
        </div>
      </div>

      {/* MAIN */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

        {/* Topbar */}
        <div style={{ background: '#fff', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ fontSize: '12px', color: '#64748B' }}>
            Sharma Group &nbsp;›&nbsp; <span style={{ color: '#7C3AED', fontWeight: 500 }}>Dashboard</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ fontSize: '11px', color: '#64748B', background: '#F1F5F9', padding: '4px 10px', borderRadius: '6px' }}>May 2026</div>
            <div style={{ width: '32px', height: '32px', background: '#F1F5F9', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', cursor: 'pointer', position: 'relative' }}>
              🔔<div style={{ position: 'absolute', top: '6px', right: '6px', width: '6px', height: '6px', background: '#EF4444', borderRadius: '50%' }} />
            </div>
            <div style={{ width: '32px', height: '32px', background: '#7C3AED', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '12px', fontWeight: 600 }}>KS</div>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, padding: '14px', overflowY: 'auto' }}>

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: '8px', marginBottom: '12px' }}>
            {stats.map((st, i) => (
              <div key={i} style={{ background: '#fff', borderRadius: '10px', padding: '10px 12px', border: '1px solid #E2E8F0', borderTop: `3px solid ${st.color}` }}>
                <div style={{ fontSize: '10px', color: '#94A3B8', marginBottom: '4px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.04em' }}>{st.label}</div>
                <div style={{ fontSize: '20px', fontWeight: 700, color: '#0F172A', marginBottom: '2px' }}>{st.value}</div>
                <div style={{ fontSize: '10px', color: st.up ? '#16A34A' : '#D97706' }}>{st.sub}</div>
              </div>
            ))}
          </div>

          {/* Map + Company */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
            <div style={{ background: '#fff', borderRadius: '10px', padding: '12px 14px', border: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '10px', display: 'flex', justifyContent: 'space-between' }}>
                📍 Branch Locations — India <span style={{ fontSize: '10px', color: '#7C3AED', cursor: 'pointer' }}>View All</span>
              </div>
              <div style={{ background: 'linear-gradient(135deg,#EFF6FF,#F0FDF4)', borderRadius: '8px', height: '210px', position: 'relative', overflow: 'hidden' }}>
                {locations.map((loc, i) => (
                  <div key={i} style={{ position: 'absolute', top: loc.top, left: loc.left }} onMouseEnter={() => setHoveredLoc(i)} onMouseLeave={() => setHoveredLoc(null)}>
                    <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: loc.color, boxShadow: `0 0 0 3px ${loc.color}33`, cursor: 'pointer', transform: hoveredLoc === i ? 'scale(1.5)' : 'scale(1)', transition: 'transform .2s' }} />
                    {hoveredLoc === i && (
                      <div style={{ position: 'absolute', bottom: '16px', left: '50%', transform: 'translateX(-50%)', background: '#1E293B', color: '#fff', fontSize: '10px', padding: '4px 8px', borderRadius: '4px', whiteSpace: 'nowrap', zIndex: 10 }}>
                        {loc.name} — {loc.emp} emp
                      </div>
                    )}
                  </div>
                ))}
                <div style={{ position: 'absolute', top: '8px', right: '8px', background: 'rgba(255,255,255,0.9)', borderRadius: '6px', padding: '4px 8px', fontSize: '10px', fontWeight: 600, color: '#374151' }}>{locations.length} Locations</div>
                <div style={{ position: 'absolute', bottom: '8px', right: '8px', background: 'rgba(255,255,255,0.9)', borderRadius: '6px', padding: '5px 8px' }}>
                  {[{ color: '#7C3AED', label: 'HQ/Factory' }, { color: '#3B82F6', label: 'Branch' }, { color: '#16A34A', label: 'Warehouse' }].map((l, j) => (
                    <div key={j} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: j < 2 ? '2px' : 0 }}>
                      <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: l.color }} />
                      <span style={{ fontSize: '9px', color: '#374151' }}>{l.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ background: '#fff', borderRadius: '10px', padding: '12px 14px', border: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '10px', display: 'flex', justifyContent: 'space-between' }}>
                🏢 Company-wise Headcount <span style={{ fontSize: '10px', color: '#7C3AED', cursor: 'pointer' }}>Details</span>
              </div>
              {companies.map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <div style={{ width: '78px', fontSize: '11px', color: '#64748B', textAlign: 'right', flexShrink: 0 }}>{c.name}</div>
                  <div style={{ flex: 1, height: '8px', background: '#F1F5F9', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${c.pct}%`, background: c.color, borderRadius: '4px' }} />
                  </div>
                  <div style={{ width: '30px', fontSize: '11px', color: '#374151', fontWeight: 500 }}>{c.count}</div>
                </div>
              ))}
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginTop: '10px' }}>
                <svg width="64" height="64" viewBox="0 0 64 64" style={{ flexShrink: 0 }}>
                  <circle cx="32" cy="32" r="22" fill="none" stroke="#F1F5F9" strokeWidth="10" />
                  <circle cx="32" cy="32" r="22" fill="none" stroke="#7C3AED" strokeWidth="10" strokeDasharray="58 80" strokeDashoffset="0" transform="rotate(-90 32 32)" />
                  <circle cx="32" cy="32" r="22" fill="none" stroke="#3B82F6" strokeWidth="10" strokeDasharray="44 94" strokeDashoffset="-58" transform="rotate(-90 32 32)" />
                  <circle cx="32" cy="32" r="22" fill="none" stroke="#16A34A" strokeWidth="10" strokeDasharray="34 104" strokeDashoffset="-102" transform="rotate(-90 32 32)" />
                  <text x="32" y="36" textAnchor="middle" fontSize="10" fontWeight="700" fill="#0F172A">1,247</text>
                </svg>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {companies.map((c, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', color: '#64748B' }}>
                      <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: c.color, flexShrink: 0 }} />
                      {c.name}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>

            {/* Compliance */}
            <div style={{ background: '#fff', borderRadius: '10px', padding: '12px 14px', border: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '10px', display: 'flex', justifyContent: 'space-between' }}>
                ⚖️ Compliance This Month <span style={{ fontSize: '10px', color: '#7C3AED', cursor: 'pointer' }}>View All</span>
              </div>
              {compliance.map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '6px 0', borderBottom: i < compliance.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                  <div style={{ padding: '2px 7px', borderRadius: '10px', fontSize: '9px', fontWeight: 500, flexShrink: 0, background: c.bg, color: c.statusColor }}>{c.status}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '11px', fontWeight: 500, color: '#374151', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</div>
                    <div style={{ fontSize: '10px', color: '#94A3B8' }}>{c.sub}</div>
                  </div>
                  <div style={{ fontSize: '10px', color: c.statusColor, fontWeight: 500, flexShrink: 0 }}>{c.action}</div>
                </div>
              ))}
            </div>

            {/* Activity */}
            <div style={{ background: '#fff', borderRadius: '10px', padding: '12px 14px', border: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '10px', display: 'flex', justifyContent: 'space-between' }}>
                🕐 Recent Activity <span style={{ fontSize: '10px', color: '#7C3AED', cursor: 'pointer' }}>View All</span>
              </div>
              {activities.map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: '8px', padding: '6px 0', borderBottom: i < activities.length - 1 ? '1px solid #F1F5F9' : 'none', alignItems: 'flex-start' }}>
                  <div style={{ width: '26px', height: '26px', borderRadius: '7px', background: a.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', flexShrink: 0 }}>{a.icon}</div>
                  <div>
                    <div style={{ fontSize: '11px', color: '#374151', lineHeight: '1.4' }}>{a.text}</div>
                    <div style={{ fontSize: '10px', color: '#94A3B8', marginTop: '2px' }}>{a.time}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Celebrations */}
            <div style={{ background: '#fff', borderRadius: '10px', padding: '12px 14px', border: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '10px', display: 'flex', justifyContent: 'space-between' }}>
                🎉 Birthdays & Anniversaries <span style={{ fontSize: '10px', color: '#7C3AED', cursor: 'pointer' }}>All</span>
              </div>
              <div style={{ fontSize: '10px', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: '6px' }}>Today</div>
              {celebrations.today.map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '6px 0', borderBottom: '1px solid #F1F5F9' }}>
                  <div style={{ fontSize: '18px' }}>{c.type === 'birthday' ? '🎂' : '🌟'}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '11px', fontWeight: 500, color: '#374151' }}>{c.name}</div>
                    <div style={{ fontSize: '10px', color: '#94A3B8' }}>{c.type === 'birthday' ? 'Happy Birthday!' : `${(c as any).years} Years with us!`} · {c.company}</div>
                  </div>
                  <button onClick={() => setWishedToday(p => [...p, c.name])} style={{ padding: '3px 8px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '10px', fontWeight: 500, background: wishedToday.includes(c.name) ? '#DCFCE7' : '#7C3AED', color: wishedToday.includes(c.name) ? '#16A34A' : '#fff', transition: 'all .2s' }}>
                    {wishedToday.includes(c.name) ? '✓ Sent' : 'Wish'}
                  </button>
                </div>
              ))}
              <div style={{ fontSize: '10px', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '.04em', margin: '8px 0 6px' }}>This Week</div>
              {celebrations.upcoming.map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '5px 0', borderBottom: i < celebrations.upcoming.length - 1 ? '1px solid #F8FAFC' : 'none' }}>
                  <div style={{ fontSize: '14px' }}>{c.type === 'birthday' ? '🎂' : '🌟'}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '11px', color: '#374151' }}>{c.name}</div>
                    <div style={{ fontSize: '10px', color: '#94A3B8' }}>{c.type === 'anniversary' ? `${(c as any).years}yr anniversary` : 'Birthday'} · {c.day}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}