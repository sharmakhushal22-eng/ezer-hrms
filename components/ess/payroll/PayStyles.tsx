'use client'
// components/ess/payroll/PayStyles.tsx — the look of ESS → Payroll.
//
// The Payroll tabs keep the structure they always had (same sections, same order, same
// fields); this stylesheet only finishes them so they read like the rest of the portal.
// It is deliberately the Leave screen's visual language (components/ess/LeaveSection.tsx):
// white panels with a hairline and a soft shadow, a soft brand-wash summary hero, small
// tiles with slim meters, pill chips, 38px inputs, a solid primary button. Nothing here is
// new design — it is the portal's existing one, applied to Payroll.
//
// Every colour resolves through the --ez-* theme variables (lib/ui/theme.css), so light,
// dark and high-contrast repaint by themselves. Render <PayStyles /> once per screen and
// wrap the screen in className="ezp".

const CSS = `
.ezp {
  --p-r-sm: 8px; --p-r-md: 10px; --p-r-lg: 14px; --p-r-xl: 18px; --p-gap: 12px;
  font-family: var(--ez-font, "DM Sans", "Segoe UI", system-ui, sans-serif);
  font-size: 13px; line-height: 1.5; color: var(--ez-ink);
  -webkit-font-smoothing: antialiased;
  --p-hero:
    radial-gradient(560px 240px at 100% 0%, color-mix(in srgb, var(--ez-brand) 16%, transparent) 0%, transparent 65%),
    radial-gradient(380px 200px at 0% 100%, color-mix(in srgb, var(--ez-info) 12%, transparent) 0%, transparent 65%),
    linear-gradient(135deg, var(--ez-surface) 0%, color-mix(in srgb, var(--ez-brand) 7%, var(--ez-surface)) 100%);
  --p-hero-edge: color-mix(in srgb, var(--ez-surface) 85%, transparent);
  --p-hero-fill: var(--ez-surface);
  --p-hero-sub: var(--ez-muted);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-ez-theme="light"]) .ezp {
    --p-hero: linear-gradient(135deg, var(--ez-dark) 0%, var(--ez-dark-soft) 55%, var(--ez-dark-mid) 100%);
    --p-hero-edge: var(--ez-on-dark-line);
    --p-hero-fill: color-mix(in srgb, var(--ez-on-dark) 8%, transparent);
    --p-hero-sub: var(--ez-on-dark-muted);
  }
}
:root[data-ez-theme="dark"] .ezp {
  --p-hero: linear-gradient(135deg, var(--ez-dark) 0%, var(--ez-dark-soft) 55%, var(--ez-dark-mid) 100%);
  --p-hero-edge: var(--ez-on-dark-line);
  --p-hero-fill: color-mix(in srgb, var(--ez-on-dark) 8%, transparent);
  --p-hero-sub: var(--ez-on-dark-muted);
}
.ezp *, .ezp *::before, .ezp *::after { box-sizing: border-box; }

/* Screen title — the line under the Payroll tabs */
.ezp-title { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin: 4px 0 14px; }
.ezp-title h2 { margin: 0; font-size: 17px; font-weight: 700; letter-spacing: -.015em; color: var(--ez-ink); }
.ezp-title p { margin: 3px 0 0; font-size: 12.5px; color: var(--ez-muted); }

/* Summary hero — the soft wash card that opens Leave, Home and Attendance */
.ezp-hero {
  position: relative; overflow: hidden; border-radius: var(--p-r-xl); padding: 18px 18px 16px; margin-bottom: var(--p-gap);
  background: var(--p-hero); color: var(--ez-ink);
  box-shadow: var(--ez-shadow-flat), 0 10px 28px -20px color-mix(in srgb, var(--ez-brand-deep) 45%, transparent);
}
:root[data-ez-theme="dark"] .ezp-hero { color: var(--ez-on-dark); }
@media (prefers-color-scheme: dark) { :root:not([data-ez-theme="light"]) .ezp-hero { color: var(--ez-on-dark); } }
.ezp-hero-label { margin: 0 0 2px; font-size: 12px; font-weight: 500; color: var(--p-hero-sub); }
.ezp-hero-num { margin: 0; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.ezp-hero-num b { font-size: 34px; line-height: 1.05; font-weight: 700; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.ezp-hero-num span { font-size: 13px; font-weight: 500; color: var(--p-hero-sub); }
.ezp-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; margin-top: 14px; }
.ezp-tile { background: var(--p-hero-fill); border: 1px solid var(--p-hero-edge); border-radius: var(--p-r-md); padding: 9px 11px 10px; min-width: 0; }
.ezp-tile-name { font-size: 11px; color: var(--p-hero-sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 4px; }
.ezp-tile-num { font-size: 19px; font-weight: 700; line-height: 1.15; font-variant-numeric: tabular-nums; }
.ezp-tile-num small { font-size: 11px; font-weight: 500; color: var(--p-hero-sub); }

/* Stat tiles outside the hero — same tile, on a panel */
.ezp-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
.ezp-stat { background: var(--ez-surface); border: 1px solid var(--ez-line); border-radius: var(--p-r-md); padding: 10px 12px 11px; min-width: 0; }
.ezp-stat-name { font-size: 11px; color: var(--ez-muted); margin-bottom: 4px; }
.ezp-stat-num { font-size: 18px; font-weight: 700; line-height: 1.15; color: var(--ez-ink); font-variant-numeric: tabular-nums; }
.ezp-stat-num.is-brand { color: var(--ez-brand); } .ezp-stat-num.is-ok { color: var(--ez-positive); }
.ezp-stat-num.is-warn { color: var(--ez-warning); } .ezp-stat-num.is-bad { color: var(--ez-critical); }

/* Panel — every group of content sits in one */
.ezp-panel {
  background: var(--ez-surface); border: 1px solid var(--ez-line-strong); border-radius: var(--p-r-lg);
  padding: 14px 15px 15px; margin-bottom: var(--p-gap);
  box-shadow: var(--ez-shadow-flat), 0 6px 18px -10px color-mix(in srgb, var(--ez-ink) 14%, transparent);
}
.ezp-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.ezp-head h3 { margin: 0; font-size: 14px; font-weight: 600; letter-spacing: -.01em; color: var(--ez-ink); }
.ezp-head-meta { margin-left: auto; font-size: 11.5px; font-weight: 500; color: var(--ez-muted); }
.ezp-sub { margin: -8px 0 12px; font-size: 12px; color: var(--ez-muted); }
.ezp-cols { display: grid; gap: var(--p-gap); }
@media (min-width: 880px) { .ezp-cols { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; } .ezp-cols > .ezp-panel { margin-bottom: 0; } .ezp-cols { margin-bottom: var(--p-gap); } }

/* Rows of label · value inside a panel */
.ezp-row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 9px 0; border-top: 1px solid var(--ez-line); font-size: 13px; }
.ezp-row:first-child { border-top: 0; padding-top: 2px; }
.ezp-row > span:first-child { color: var(--ez-ink-soft); }
.ezp-row > b, .ezp-row > span:last-child { font-variant-numeric: tabular-nums; }
.ezp-row.is-total { border-top: 1px solid var(--ez-line-strong); font-weight: 700; }

/* Slim meter */
.ezp-meter { height: 6px; border-radius: 999px; background: var(--ez-sunken); overflow: hidden; display: flex; }
.ezp-meter > i { display: block; height: 100%; background: var(--ez-brand); transition: width .35s cubic-bezier(.4,0,.2,1); }
.ezp-meter > i.is-ok { background: var(--ez-positive); } .ezp-meter > i.is-warn { background: var(--ez-warning); }
.ezp-meter > i.is-bad { background: var(--ez-critical); } .ezp-meter > i.is-soft { background: var(--ez-brand-edge); }
.ezp-meter-cap { display: flex; justify-content: space-between; gap: 8px; margin-top: 6px; font-size: 11.5px; color: var(--ez-muted); font-variant-numeric: tabular-nums; }

/* Chips and pills */
.ezp-chip { display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 9px; border-radius: 999px; font-size: 11px; font-weight: 600; white-space: nowrap;
  background: var(--ez-sunken); color: var(--ez-ink-soft); border: 1px solid var(--ez-line); }
.ezp-chip.is-brand { background: var(--ez-brand-tint); color: var(--ez-brand-deep); border-color: var(--ez-brand-edge); }
.ezp-chip.is-ok { background: var(--ez-positive-tint); color: var(--ez-positive); border-color: var(--ez-positive-edge); }
.ezp-chip.is-warn { background: var(--ez-warning-tint); color: var(--ez-warning); border-color: var(--ez-warning-edge); }
.ezp-chip.is-bad { background: var(--ez-critical-tint); color: var(--ez-critical); border-color: var(--ez-critical-edge); }
.ezp-chip.is-info { background: var(--ez-info-tint); color: var(--ez-info); border-color: var(--ez-info-edge); }

/* Notes — the calm replacement for blocks of coloured text */
.ezp-note { border-radius: var(--p-r-md); padding: 11px 13px; font-size: 12.5px; line-height: 1.6; margin-bottom: var(--p-gap);
  background: var(--ez-info-tint); border: 1px solid var(--ez-info-edge); color: var(--ez-ink-soft); }
.ezp-note b, .ezp-note strong { color: var(--ez-ink); font-weight: 600; }
.ezp-note.is-warn { background: var(--ez-warning-tint); border-color: var(--ez-warning-edge); }
.ezp-note.is-bad { background: var(--ez-critical-tint); border-color: var(--ez-critical-edge); }
.ezp-note.is-ok { background: var(--ez-positive-tint); border-color: var(--ez-positive-edge); }
.ezp-note-t { display: block; font-weight: 700; margin-bottom: 2px; }
.ezp-note.is-warn .ezp-note-t { color: var(--ez-warning); } .ezp-note.is-bad .ezp-note-t { color: var(--ez-critical); }
.ezp-note.is-ok .ezp-note-t { color: var(--ez-positive); } .ezp-note .ezp-note-t { color: var(--ez-info); }
.ezp-note ul { margin: 4px 0 0; padding-left: 18px; list-style: disc; } .ezp-note li { margin: 2px 0; display: list-item; }

/* Empty state */
.ezp-empty { border: 1px dashed var(--ez-line-strong); border-radius: var(--p-r-md); padding: 16px 14px; font-size: 12.5px; line-height: 1.6; color: var(--ez-muted); text-align: center; }
.ezp-empty b { color: var(--ez-ink-soft); font-weight: 600; display: block; }

/* Fields */
.ezp-field { margin-bottom: 14px; }
.ezp-label { display: block; margin-bottom: 6px; font-size: 12px; font-weight: 600; color: var(--ez-ink-soft); }
.ezp-hint { margin: 6px 0 0; font-size: 11.5px; line-height: 1.5; color: var(--ez-muted); }
.ezp-input { width: 100%; height: 38px; padding: 0 11px; font: 400 13px var(--ez-font, inherit); font-family: inherit; color: var(--ez-ink);
  background: var(--ez-surface); border: 1px solid var(--ez-line-strong); border-radius: var(--p-r-md); outline: none;
  transition: border-color .14s ease, box-shadow .14s ease; }
textarea.ezp-input { height: auto; min-height: 76px; padding: 9px 11px; resize: vertical; line-height: 1.5; }
.ezp-input::placeholder { color: var(--ez-faint); }
.ezp-input:focus { border-color: var(--ez-brand); box-shadow: 0 0 0 3px var(--ez-brand-tint); }
.ezp-input:disabled, .ezp-input[readonly] { background: var(--ez-sunken); color: var(--ez-ink-soft); }
.ezp-grid2 { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }

/* Buttons */
.ezp-btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 38px; padding: 0 18px; border-radius: var(--p-r-md);
  border: 1px solid var(--ez-brand-deep); background: linear-gradient(180deg, var(--ez-brand), var(--ez-brand-deep)); color: var(--ez-on-accent);
  font: 600 13px inherit; font-family: inherit; cursor: pointer; white-space: nowrap;
  box-shadow: 0 1px 2px color-mix(in srgb, var(--ez-brand-deep) 24%, transparent), 0 8px 20px -6px color-mix(in srgb, var(--ez-brand) 36%, transparent);
  transition: transform .12s ease, box-shadow .12s ease; }
.ezp-btn:hover:not(:disabled) { transform: translateY(-1px); }
.ezp-btn:disabled { opacity: .5; cursor: not-allowed; box-shadow: none; transform: none; }
.ezp-btn.is-block { width: 100%; }
.ezp-ghost { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 12px; border-radius: var(--p-r-sm);
  border: 1px solid var(--ez-line-strong); background: var(--ez-surface); color: var(--ez-ink-soft); font: 600 12px inherit; font-family: inherit; cursor: pointer; white-space: nowrap;
  transition: color .14s ease, border-color .14s ease, background .14s ease; }
.ezp-ghost:hover:not(:disabled) { color: var(--ez-brand); border-color: var(--ez-brand-edge); background: var(--ez-brand-tint); }
.ezp-ghost.is-danger { color: var(--ez-critical); border-color: var(--ez-critical-edge); }
.ezp-ghost:disabled { opacity: .5; cursor: not-allowed; }
.ezp-check { display: flex; gap: 10px; align-items: flex-start; padding: 11px 13px; border-radius: var(--p-r-md); border: 1px solid var(--ez-line); background: var(--ez-sunken); font-size: 12.5px; color: var(--ez-ink-soft); cursor: pointer; line-height: 1.55; }
.ezp-check input { margin-top: 2px; width: 16px; height: 16px; accent-color: var(--ez-brand); flex: none; }

/* Tables */
.ezp-table-wrap { overflow-x: auto; border: 1px solid var(--ez-line); border-radius: var(--p-r-md); }
.ezp-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.ezp-table th { text-align: left; font-size: 11px; font-weight: 600; color: var(--ez-muted); background: var(--ez-sunken); padding: 9px 12px; border-bottom: 1px solid var(--ez-line); white-space: nowrap; }
.ezp-table td { padding: 9px 12px; border-bottom: 1px solid var(--ez-line); color: var(--ez-ink); vertical-align: middle; }
.ezp-table tr:last-child td { border-bottom: 0; }
.ezp-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.ezp-table tr.is-total td { font-weight: 700; background: var(--ez-sunken); }

.ezp-num { font-variant-numeric: tabular-nums; }
.ezp-muted { color: var(--ez-muted); } .ezp-brand { color: var(--ez-brand); } .ezp-ok { color: var(--ez-positive); }
.ezp-warn { color: var(--ez-warning); } .ezp-bad { color: var(--ez-critical); }

@media (max-width: 640px) {
  .ezp-hero { padding: 16px 14px 14px; } .ezp-panel { padding: 13px 12px 14px; } .ezp-hero-num b { font-size: 28px; }
}
`

/** Render once per payroll screen (React dedupes identical <style> content cheaply). */
export default function PayStyles() {
  return <style dangerouslySetInnerHTML={{ __html: CSS }} />
}
