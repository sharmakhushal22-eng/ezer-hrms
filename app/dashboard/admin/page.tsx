'use client'
import { useState } from 'react'
import CompanySetup from './CompanySetup'
import MasterSetup from './master/page'

type Tab = 'company' | 'master'

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('company')

  return (
    <div style={{ minHeight:'100vh', background:'#F0F4F8', fontFamily:'"DM Sans","Segoe UI",sans-serif' }}>
      
      {/* Top Bar */}
      <div style={{ background:'#1E1B4B', padding:'14px 24px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div>
          <div style={{ fontSize:'15px', fontWeight:600, color:'#fff' }}>Admin Setup</div>
          <div style={{ fontSize:'11px', color:'rgba(255,255,255,0.5)', marginTop:'2px' }}>Company Configuration · Master Data · ezerhrms.com</div>
        </div>
        <div style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)' }}>Sharma Group</div>
      </div>

      {/* Tabs */}
      <div style={{ background:'#fff', borderBottom:'1px solid #E2E8F0', padding:'0 24px', display:'flex' }}>
        {[
          { id:'company', label:'🔧 Company Setup', desc:'New company onboard karo — 7 step wizard' },
          { id:'master',  label:'⚙️ Master Setup',  desc:'Dropdowns manage karo — Add/Edit/Disable' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id as Tab)}
            style={{ padding:'13px 20px', border:'none', background:'transparent', cursor:'pointer', textAlign:'left' as const,
              borderBottom: tab===t.id ? '2.5px solid #7C3AED' : '2.5px solid transparent',
              marginRight:'4px' }}>
            <div style={{ fontSize:'13px', fontWeight: tab===t.id ? 600:400, color: tab===t.id ? '#7C3AED':'#64748B' }}>{t.label}</div>
            <div style={{ fontSize:'10px', color:'#94A3B8', marginTop:'1px' }}>{t.desc}</div>
          </button>
        ))}
      </div>

      {/* Content */}
      <div>
        {tab==='company' && <CompanySetup />}
        {tab==='master'  && <MasterSetup />}
      </div>

    </div>
  )
}