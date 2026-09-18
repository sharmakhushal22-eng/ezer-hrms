import type { FolderCode } from './types';

type P = { className?: string; style?: React.CSSProperties };

function I({ children, className = 'i', style }: P & { children: React.ReactNode }) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}

export const Ic = {
  chat: (p: P = {}) => <I {...p}><path d="M4 5h16v11H8l-4 4z" /></I>,
  chatLines: (p: P = {}) => <I {...p}><path d="M4 5h16v11H8l-4 4z" /><path d="M8 9h8M8 12h5" /></I>,
  star: (p: P = {}) => <I {...p}><path d="M12 3l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.4 6.8 19.2l1-5.9L3.5 9.2l5.9-.8z" /></I>,
  megaphone: (p: P = {}) => <I {...p}><path d="M4 10v4h3l6 4V6l-6 4z" /><path d="M16 9a4 4 0 010 6" /><path d="M18.5 6.5a8 8 0 010 11" /></I>,
  megaphoneOff: (p: P = {}) => <I {...p}><path d="M4 10v4h3l6 4V6l-6 4z" /><path d="M16 9a4 4 0 010 6" /><path d="M3 3l18 18" /></I>,
  plus: (p: P = {}) => <I {...p}><path d="M12 5v14M5 12h14" /></I>,
  search: (p: P = {}) => <I {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></I>,
  back: (p: P = {}) => <I {...p}><path d="M15 5l-7 7 7 7" /></I>,
  chevron: (p: P = {}) => <I {...p}><path d="M9 5l7 7-7 7" /></I>,
  close: (p: P = {}) => <I {...p}><path d="M6 6l12 12M18 6L6 18" /></I>,
  check: (p: P = {}) => <I {...p}><path d="M5 12l4 4L19 6" /></I>,
  bell: (p: P = {}) => <I {...p}><path d="M6 8a6 6 0 0112 0v5l2 3H4l2-3z" /><path d="M10 19a2 2 0 004 0" /></I>,
  bellOff: (p: P = {}) => <I {...p}><path d="M6 8a6 6 0 0112 0v5l2 3H4l2-3z" /><path d="M4 4l16 16" /></I>,
  mail: (p: P = {}) => <I {...p}><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 8l9 6 9-6" /></I>,
  lock: (p: P = {}) => <I {...p}><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 018 0v3" /></I>,
  clip: (p: P = {}) => <I {...p}><path d="M20 12l-8.5 8.5a5 5 0 01-7-7L13 5a3.3 3.3 0 014.7 4.7L9.5 18a1.6 1.6 0 01-2.3-2.3L15 8" /></I>,
  send: (p: P = {}) => <I {...p}><path d="M4 12L20 4l-4 16-4-7z" /></I>,
  down: (p: P = {}) => <I {...p}><path d="M12 5v14M5 12l7 7 7-7" /></I>,
  trash: (p: P = {}) => <I {...p}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></I>,
  heart: (p: P = {}) => <I {...p}><path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z" /></I>,
  reply: (p: P = {}) => <I {...p}><path d="M9 14l-5-5 5-5" /><path d="M4 9h10a6 6 0 016 6v4" /></I>,
  desk: (p: P = {}) => <I {...p}><path d="M3 9l9-6 9 6v11H3z" /><path d="M9 20v-6h6v6" /></I>,
};

/** Glyph for a SYSTEM stream, keyed by folder. Falls back to the bell. */
export function FolderGlyph({ code, className }: { code: FolderCode; className?: string }) {
  const p = { className };
  switch (code) {
    case 'TIME': return <I {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /><path d="M9 15l2 2 4-4" /></I>;
    case 'HR': return <I {...p}><path d="M6 3h9l5 5v13H6z" /><path d="M14 3v6h6M9 13h6M9 17h6" /></I>;
    case 'PAYROLL': return <I {...p}><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M7 12h.01M17 12h.01" /></I>;
    case 'FUNZONE': return <I {...p}><path d="M6 12h4M8 10v4M15 11h.01M18 13h.01" /><path d="M7 7h10a4 4 0 014 4v2a4 4 0 01-4 4H7a4 4 0 01-4-4v-2a4 4 0 014-4z" /></I>;
    case 'PERFORMANCE': return <I {...p}><path d="M4 19V5M4 19h16" /><path d="M8 15l3-4 3 2 4-6" /></I>;
    default: return Ic.bell(p);
  }
}
