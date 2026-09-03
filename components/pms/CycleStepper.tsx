'use client'
// components/pms/CycleStepper.tsx — the seven stages, and where we are.
//
// This is the single most instructive thing on the screen. An appraisal is a
// process most people meet twice a year and never learn; the stepper answers
// "what happens, in what order, and where are we" before the reader has
// clicked anything.
//
// Three decisions worth keeping:
//
//   Every stage carries its own sentence, not just a noun. "Weightage Lock"
//   teaches nobody anything. It is shown on hover and focus, and on small
//   screens where the rail collapses it is shown outright for the active
//   stage, because that is the one the reader needs.
//
//   BLOCKED is drawn differently from ACTIVE. A stage whose window is open
//   but whose precondition is missing is the single most confusing state in
//   any workflow tool — the calendar says go, the buttons are disabled, and
//   nothing says why. It gets its own colour and its own reason line.
//
//   The connector between two stages is filled only as far as the cycle has
//   actually got. A fully drawn line with a dot part-way along reads as
//   decoration; a line that stops reads as progress.

import { useId, useEffect, useState } from 'react'
import { STAGES, type StageKey, type StageState } from '@/lib/pms/cycle'
import { C, F, W, R } from '@/lib/ui'

export interface CycleStepperProps {
  states: Record<StageKey, StageState>
  /** Optional per-stage detail: "6 KRAs · 100%", "Open till 10 Jan". */
  detail?: Partial<Record<StageKey, string>>
  /** Compact rail for the ESS portal's narrower column. */
  dense?: boolean
}

const TONE: Record<StageState, { dot: string; ink: string; ring: string; label: string }> = {
  done:     { dot: 'var(--pms-done)',    ink: 'var(--pms-done-ink)',  ring: 'transparent',        label: 'completed' },
  active:   { dot: 'var(--pms-active)',  ink: '#FFFFFF',              ring: 'var(--pms-active-ring)', label: 'in progress now' },
  blocked:  { dot: 'var(--pms-blocked)', ink: '#FFFFFF',              ring: 'var(--pms-blocked-ring)', label: 'waiting — cannot start' },
  upcoming: { dot: 'var(--pms-todo)',    ink: 'var(--pms-todo-ink)',  ring: 'transparent',        label: 'not started' },
}

export default function CycleStepper({ states, detail, dense }: CycleStepperProps) {
  const rid = useId().replace(/[:]/g, '')

  // Assume calm until the browser says otherwise, so a server render never
  // ships motion to somebody who asked for none.
  const [calm, setCalm] = useState(true)
  useEffect(() => {
    const q = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setCalm(q.matches)
    on(); q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [])

  return (
    <div className="pms-stepper" role="list" aria-label="Appraisal cycle progress"
         data-dense={dense ? '1' : '0'} data-calm={calm ? '1' : '0'}>
      {STAGES.map((s, i) => {
        const st = states[s.key] ?? 'upcoming'
        const t = TONE[st]
        const prev = i > 0 ? (states[STAGES[i - 1].key] ?? 'upcoming') : null
        // The line INTO this stage is filled when the stage before it is done.
        const filled = prev === 'done'
        return (
          <div key={s.key} className="pms-step" role="listitem" data-state={st}
               aria-current={st === 'active' ? 'step' : undefined}
               style={{ animationDelay: calm ? undefined : `${i * 45}ms` }}>
            {i > 0 && <span className="pms-line" data-filled={filled ? '1' : '0'} aria-hidden />}
            <button type="button" className="pms-dot-wrap"
                    aria-describedby={`${rid}-${s.key}`}
                    // A stage is not a control; it is a thing you can inspect.
                    // Button only so the blurb is reachable from the keyboard.
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'help' }}>
              <span className="pms-dot" style={{ background: t.dot, color: t.ink, boxShadow: `0 0 0 4px ${t.ring}` }}>
                {st === 'done' ? (
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                       strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M3.5 8.5l3 3 6-6.5" />
                  </svg>
                ) : st === 'blocked' ? (
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                       strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                    <path d="M8 4.4v4.2M8 11.4v.2" />
                  </svg>
                ) : s.n}
              </span>
              <span className="pms-step-label">{s.label}</span>
              {detail?.[s.key] && <span className="pms-step-detail">{detail[s.key]}</span>}
              {/* Screen readers get the state as words, not as a colour. */}
              <span className="ez-sr">{t.label}</span>
            </button>
            <span id={`${rid}-${s.key}`} role="tooltip" className="pms-blurb">{s.blurb}</span>
          </div>
        )
      })}

      <style>{`
        .pms-stepper{
          --pms-done:        ${C.positive};
          --pms-done-ink:    #FFFFFF;
          --pms-active:      ${C.brand};
          --pms-active-ring: ${C.brandTint};
          --pms-blocked:     ${C.warning};
          --pms-blocked-ring:${C.warningTint};
          --pms-todo:        ${C.sunken};
          --pms-todo-ink:    ${C.muted};
          display:grid; grid-auto-flow:column; grid-auto-columns:1fr;
          gap:0; align-items:start; width:100%;
        }
        .pms-step{ position:relative; display:flex; flex-direction:column; align-items:center;
                   text-align:center; padding:0 4px; min-width:0 }
        /* The connector starts at the previous dot's centre and ends at this
           one's, so it reads as the gap BETWEEN stages rather than a rule
           under them. */
        .pms-line{
          position:absolute; top:13px; right:50%; left:-50%; height:2px; border-radius:2px;
          background:${C.line};
        }
        /* The completed part of the line GROWS from the previous stage, so
           progress is something that happened rather than something that was
           always there. */
        .pms-line::after{
          content:''; position:absolute; inset:0; border-radius:inherit;
          background:${C.positive}; transform-origin:left center; transform:scaleX(0);
          transition: transform .5s cubic-bezier(.2,.8,.2,1);
        }
        .pms-line[data-filled="1"]::after{ transform:scaleX(1) }
        .pms-dot-wrap{ display:flex; flex-direction:column; align-items:center; gap:7px;
                       position:relative; z-index:1; width:100%; font:inherit; color:inherit }
        /* The dot is a physical token: lit from above, sitting on the rail
           rather than printed on it. The inset highlight is what does the
           work — a flat disc with a drop shadow reads as a sticker. */
        .pms-dot{
          width:28px; height:28px; border-radius:50%; display:grid; place-items:center;
          font-size:${F.tiny}px; font-weight:${W.bold}; flex-shrink:0;
          position:relative; z-index:1;
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.45),
            0 1px 2px rgba(16,36,100,.22),
            0 3px 8px -3px rgba(16,36,100,.28);
          transition: box-shadow .22s ease, background .22s ease,
                      transform .22s cubic-bezier(.2,.8,.2,1);
        }
        .pms-dot-wrap:hover .pms-dot{ transform: translateY(-2px) scale(1.06) }

        /* The stage you are ON breathes. One element, slowly, so it reads as
           "here" rather than as an alarm — and it is the only thing moving
           once the entrance has finished. */
        .pms-step[data-state="active"] .pms-dot::after,
        .pms-step[data-state="blocked"] .pms-dot::after{
          content:''; position:absolute; inset:-5px; border-radius:50%;
          border:2px solid currentColor; opacity:.28;
          animation: pmsPulse 2.4s cubic-bezier(.4,0,.6,1) infinite;
        }
        @keyframes pmsPulse{
          0%,100%{ transform:scale(.92); opacity:.30 }
          50%    { transform:scale(1.14); opacity:0 }
        }

        /* Each stage arrives in turn, so the rail draws itself once on load
           and the reader's eye follows the order of the process. */
        .pms-stepper[data-calm="0"] .pms-step{
          animation: pmsStepIn .40s cubic-bezier(.2,.8,.2,1) both;
        }
        @keyframes pmsStepIn{
          from{ opacity:0; transform: translateY(7px) }
          to  { opacity:1; transform: translateY(0) }
        }
        .pms-step-label{ font-size:${F.tiny}px; font-weight:${W.semi}; color:${C.inkSoft};
                         line-height:1.25; max-width:11ch }
        .pms-step[data-state="active"] .pms-step-label{ color:${C.brand}; font-weight:${W.bold} }
        .pms-step[data-state="blocked"] .pms-step-label{ color:${C.warning}; font-weight:${W.bold} }
        .pms-step[data-state="upcoming"] .pms-step-label{ color:${C.faint} }
        .pms-step-detail{ font-size:${F.micro}px; color:${C.muted}; line-height:1.3; max-width:13ch }

        /* The sentence. Hidden until wanted, but present in the DOM and tied
           to the dot with aria-describedby so it is not mouse-only. */
        .pms-blurb{
          position:absolute; top:calc(100% + 8px); left:50%; transform:translate(-50%,-4px);
          width:190px; padding:8px 10px; border-radius:${R.sm}px; z-index:5;
          background:${C.dark}; color:${C.onDark}; font-size:${F.micro}px; line-height:1.45;
          opacity:0; pointer-events:none; transition:opacity .16s ease, transform .16s ease;
          box-shadow:0 6px 20px -6px rgba(6,17,58,.5);
        }
        .pms-dot-wrap:hover + .pms-blurb,
        .pms-dot-wrap:focus-visible + .pms-blurb{ opacity:1; transform:translate(-50%,0) }

        /* EDGE CLAMP. The blurb is 190px centred on its dot, so the first and
           last stages hang ~95px past the rail. Absolute positioning keeps it
           out of the parent's layout but NOT out of the document's scroll
           width, so between roughly 760 and 900px the page picked up a few
           pixels of sideways scroll — invisible, and enough to make the whole
           layout feel loose on a tablet. The end stages anchor to their own
           edge instead of to their centre. */
        .pms-step:first-child .pms-blurb{ left:0; transform:translate(0,-4px) }
        .pms-step:first-child .pms-dot-wrap:hover + .pms-blurb,
        .pms-step:first-child .pms-dot-wrap:focus-visible + .pms-blurb{ transform:translate(0,0) }
        .pms-step:last-child .pms-blurb{ left:auto; right:0; transform:translate(0,-4px) }
        .pms-step:last-child .pms-dot-wrap:hover + .pms-blurb,
        .pms-step:last-child .pms-dot-wrap:focus-visible + .pms-blurb{ transform:translate(0,0) }

        /* Below the widest tablet the rail is tight enough that even the
           second stage in from each end can reach past. Narrowing the blurb
           costs a line of wrapping and buys the page back. */
        @media (max-width: 900px){
          .pms-blurb{ width:158px }
        }

        .ez-sr{ position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0);
                clip-path:inset(50%); white-space:nowrap }

        @media (prefers-reduced-motion: reduce){
          .pms-dot, .pms-blurb, .pms-line::after{ transition:none }
          .pms-stepper .pms-step{ animation:none }
          .pms-dot::after{ animation:none; opacity:.30 }
          .pms-dot-wrap:hover .pms-dot{ transform:none }
        }

        /* Narrow: the rail becomes a column and stops pretending to be a
           timeline. Labels get their full width back rather than wrapping to
           three words a line. */
        @media (max-width: 720px){
          .pms-stepper{ grid-auto-flow:row; grid-auto-columns:auto; gap:2px }
          .pms-step{ flex-direction:row; align-items:center; gap:10px; text-align:left; padding:5px 0 }
          .pms-dot-wrap{ flex-direction:row; align-items:center; gap:10px; justify-content:flex-start }
          .pms-step-label, .pms-step-detail{ max-width:none }
          .pms-line{ top:-4px; left:12px; right:auto; width:2px; height:10px }
          .pms-blurb{ position:static; transform:none; opacity:1; width:auto; background:none;
                      color:${C.muted}; box-shadow:none; padding:0 0 0 36px; text-align:left }
          /* On a phone every blurb visible at once is noise; only the stage
             the reader is actually on earns the space. */
          .pms-step:not([data-state="active"]):not([data-state="blocked"]) .pms-blurb{ display:none }
        }
      `}</style>
    </div>
  )
}
