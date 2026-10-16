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
  // The option sheet (step 2): the three ways, the progress nav, the way back.
  play: 'M7 4.5l12 7.5-12 7.5z',
  cal: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 8v4l3 2',
  back: 'M19 12H5M11 6l-6 6 6 6',
  check: 'M5 12l5 5L20 7',
  plus: 'M12 5v14M5 12h14',
  // The side rail and the phone tab bar of the full-page module.
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  claims: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  advances: 'M3 7a2 2 0 0 1 2-2h14v4M3 7v10a2 2 0 0 0 2 2h16V9H5a2 2 0 0 1-2-2zM17 14h.01',
  limits: 'M5 4h13a1 1 0 0 1 1 1v15H6a1 1 0 0 1-1-1zM5 19a2 2 0 0 1 2-2h12M9 8h6',
  more: 'M4 6h16M4 12h16M4 18h16',
  // The trip planner (build step 3): the route, the modes, the place picker.
  people: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 19v-1a4 4 0 0 0-3-3.9M16 3.1a3.5 3.5 0 0 1 0 6.8',
  minus: 'M5 12h14',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  target: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3',
  pin: 'M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  rightc: 'M9 6l6 6-6 6',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  compass: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15.5 8.5l-2 5-5 2 2-5z',
  plane: 'M22 2L11 13M22 2l-7 20-4-9-9-4z',
  route: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 17h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7',
  swap: 'M7 20V5M7 5L4 8M7 5l3 3M17 4v15M17 19l-3-3M17 19l3-3',
  shield: 'M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z',
  car: 'M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11M3 16v-3a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3M6 19v-2M18 19v-2M3 16h18M7 14h.01M17 14h.01',
  bus: 'M6 4h12a2 2 0 0 1 2 2v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a2 2 0 0 1 2-2zM4 11h16M8 14h.01M16 14h.01M7 17v2.5M17 17v2.5',
  // The prototype's path (design/prototype/source). Two screens already asked
  // for "train" and were silently getting the information glyph instead.
  train: 'M7 3h10a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2zM5 11h14M9 14h.01M15 14h.01M8 17l-2 4M16 17l2 4',
  clock: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  // Vehicles and the RC check (build step 4).
  verify: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.5-4.5M8.5 11l2 2 3-3.5',
  bike: 'M5.5 18.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18.5 18.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM5.5 15.5l4-6.5h4.5l4.5 6.5M14 9l-1.2-3H10M9.5 9l3 6.5',
  file: 'M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7zM14 3v4h4',
  receipt: 'M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4',
}

export default function TeIcon({ name, size }: { name: keyof typeof PATHS | string; size?: 'sm' | 'lg' }) {
  return (
    <svg className={size ? `ic ${size}` : 'ic'} viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name] ?? PATHS.info} />
    </svg>
  )
}
