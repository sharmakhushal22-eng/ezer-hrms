// components/te/TeIcon.tsx — the handful of icons the starter screens use.
// The path data is the prototype's (design/html/*.html, <svg class="ic">). The
// stylesheet draws them: stroke and size come from `.te .ic` in te.css.
const PATHS: Record<string, string> = {
  local: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 17h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7',
  domestic: 'M7 3h10a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2zM5 11h14M9 14h.01M15 14h.01M8 17l-2 4M16 17l2 4',
  international: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z',
  other: 'M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4',
  go: 'M5 12h14M13 6l6 6-6 6',
  close: 'M6 6l12 12M18 6L6 18',
  warn: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7h.01',
}

export default function TeIcon({ name, size }: { name: keyof typeof PATHS | string; size?: 'sm' | 'lg' }) {
  return (
    <svg className={size ? `ic ${size}` : 'ic'} viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name] ?? PATHS.info} />
    </svg>
  )
}
