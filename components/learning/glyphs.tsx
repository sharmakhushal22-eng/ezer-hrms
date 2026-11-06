// components/learning/glyphs.tsx — the icons EZER Learn needs that lib/ui/icons does not have.
// Same construction as the shared set: a 20 by 20 box, 1.6 stroke, round ends, currentColor.
import type { ReactNode } from 'react'

type P = { size?: number; filled?: boolean }

function G({ size = 18, children, fill }: { size?: number; children: ReactNode; fill?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth={1.6}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0, display: 'block' }}>
      {children}
    </svg>
  )
}

export const GPlay = ({ size }: P) => <G size={size} fill><path d="M6.2 3.6c0-.8.9-1.3 1.6-.9l9 5.6c.6.4.6 1.3 0 1.7l-9 5.6c-.7.4-1.6-.1-1.6-.9V3.6Z" /></G>
export const GPause = ({ size }: P) => <G size={size} fill><rect x="4.5" y="3.5" width="3.8" height="13" rx="1.2" /><rect x="11.7" y="3.5" width="3.8" height="13" rx="1.2" /></G>
export const GBack10 = ({ size }: P) => <G size={size}><path d="M4 10a6 6 0 1 0 1.8-4.3" /><path d="M4 3.5v3h3" /><text x="10" y="12.6" fontSize="6.2" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none">10</text></G>
export const GFwd10 = ({ size }: P) => <G size={size}><path d="M16 10a6 6 0 1 1-1.8-4.3" /><path d="M16 3.5v3h-3" /><text x="10" y="12.6" fontSize="6.2" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none">10</text></G>
export const GVolume = ({ size }: P) => <G size={size}><path d="M3.5 8v4h3l4 3.5v-11l-4 3.5h-3Z" /><path d="M13.5 7.2a4 4 0 0 1 0 5.6M15.6 5a7 7 0 0 1 0 10" /></G>
export const GVolumeLow = ({ size }: P) => <G size={size}><path d="M3.5 8v4h3l4 3.5v-11l-4 3.5h-3Z" /><path d="M13.5 7.2a4 4 0 0 1 0 5.6" /></G>
export const GMute = ({ size }: P) => <G size={size}><path d="M3.5 8v4h3l4 3.5v-11l-4 3.5h-3Z" /><path d="m13.5 8 4 4M17.5 8l-4 4" /></G>
export const GFull = ({ size }: P) => <G size={size}><path d="M3.5 7.5v-4h4M12.5 3.5h4v4M16.5 12.5v4h-4M7.5 16.5h-4v-4" /></G>
export const GFullExit = ({ size }: P) => <G size={size}><path d="M7.5 3.5v4h-4M16.5 7.5h-4v-4M12.5 16.5v-4h4M3.5 12.5h4v4" /></G>
export const GPip = ({ size }: P) => <G size={size}><rect x="2.5" y="4" width="15" height="12" rx="2" /><rect x="10" y="9.5" width="5.5" height="4.5" rx="1" fill="currentColor" stroke="none" /></G>
export const GCaptions = ({ size }: P) => <G size={size}><rect x="2.5" y="4.5" width="15" height="11" rx="2" /><path d="M8.6 8.3a2 2 0 1 0 0 3.4M14.1 8.3a2 2 0 1 0 0 3.4" /></G>
export const GGear = ({ size }: P) => <G size={size}><circle cx="10" cy="10" r="2.4" /><path d="M10 2.8v2M10 15.2v2M17.2 10h-2M4.8 10h-2M15.1 4.9l-1.4 1.4M6.3 13.7l-1.4 1.4M15.1 15.1l-1.4-1.4M6.3 6.3 4.9 4.9" /></G>
export const GZoomIn = ({ size }: P) => <G size={size}><circle cx="8.8" cy="8.8" r="5.3" /><path d="m12.8 12.8 3.7 3.7M8.8 6.5v4.6M6.5 8.8h4.6" /></G>
export const GZoomOut = ({ size }: P) => <G size={size}><circle cx="8.8" cy="8.8" r="5.3" /><path d="m12.8 12.8 3.7 3.7M6.5 8.8h4.6" /></G>
export const GFitWidth = ({ size }: P) => <G size={size}><rect x="3" y="4" width="14" height="12" rx="1.6" /><path d="M5.5 10h9M7 8.3 5.4 10 7 11.7M13 8.3l1.6 1.7-1.6 1.7" /></G>
export const GFitPage = ({ size }: P) => <G size={size}><rect x="5" y="2.8" width="10" height="14.4" rx="1.6" /><path d="M10 5.3v9.4M8.3 7 10 5.3 11.7 7M8.3 13 10 14.7l1.7-1.7" /></G>
export const GThumbs = ({ size }: P) => <G size={size}><rect x="2.8" y="3" width="5.2" height="4" rx="1" /><rect x="2.8" y="8.5" width="5.2" height="4" rx="1" /><rect x="2.8" y="14" width="5.2" height="3" rx="1" /><rect x="10" y="3" width="7.2" height="14" rx="1.4" /></G>
export const GPresent = ({ size }: P) => <G size={size}><rect x="2.5" y="3" width="15" height="10" rx="1.6" /><path d="M10 13v3.5M6.5 17h7" /><path d="m8.6 6.2 3 1.8-3 1.8V6.2Z" fill="currentColor" stroke="none" /></G>
export const GMenu = ({ size }: P) => <G size={size}><path d="M3 5.5h14M3 10h14M3 14.5h14" /></G>
export const GSidebar = ({ size }: P) => <G size={size}><rect x="2.5" y="3.5" width="15" height="13" rx="2" /><path d="M12.5 3.5v13" /></G>
export const GLeft = ({ size }: P) => <G size={size}><path d="M12.2 15.5 6.7 10l5.5-5.5" /></G>
export const GRight = ({ size }: P) => <G size={size}><path d="m7.8 4.5 5.5 5.5-5.5 5.5" /></G>
export const GArrowRight = ({ size }: P) => <G size={size}><path d="M3.5 10h13M11.5 5l5 5-5 5" /></G>
export const GArrowLeft = ({ size }: P) => <G size={size}><path d="M16.5 10h-13M8.5 5l-5 5 5 5" /></G>
export const GSparkle = ({ size }: P) => <G size={size}><path d="M10 2.5c.5 3.6 1.9 5 5.5 5.5-3.6.5-5 1.9-5.5 5.5-.5-3.6-1.9-5-5.5-5.5 3.6-.5 5-1.9 5.5-5.5Z" /><path d="M15.5 13.5c.2 1.4.8 2 2.2 2.2-1.4.2-2 .8-2.2 2.2-.2-1.4-.8-2-2.2-2.2 1.4-.2 2-.8 2.2-2.2Z" /></G>
export const GFlame = ({ size }: P) => <G size={size}><path d="M10 17.5c3 0 5.2-2.1 5.2-5 0-3.6-3.2-5.3-3.9-9-1.8 1.4-2.6 3.3-2.6 5.2-1-.6-1.6-1.7-1.8-2.8C5.3 7.6 4.8 9.5 4.8 12.5c0 2.9 2.2 5 5.2 5Z" /></G>
export const GBook = ({ size }: P) => <G size={size}><path d="M3 4.5c2.4-.9 4.8-.7 7 .8 2.2-1.5 4.6-1.7 7-.8v11c-2.4-.9-4.8-.7-7 .8-2.2-1.5-4.6-1.7-7-.8v-11Z" /><path d="M10 5.3v11" /></G>
export const GLayers = ({ size }: P) => <G size={size}><path d="m10 2.8 7.2 3.7L10 10.2 2.8 6.5 10 2.8Z" /><path d="m2.8 10 7.2 3.7 7.2-3.7M2.8 13.5l7.2 3.7 7.2-3.7" /></G>
export const GClock = ({ size }: P) => <G size={size}><circle cx="10" cy="10" r="7" /><path d="M10 6v4.3l2.8 1.7" /></G>
export const GUsers = ({ size }: P) => <G size={size}><circle cx="7.5" cy="7" r="2.8" /><path d="M2.5 16.5c.4-2.8 2.4-4.4 5-4.4s4.6 1.6 5 4.4" /><path d="M13 4.6a2.6 2.6 0 0 1 0 4.9M14.6 12.4c1.6.5 2.6 1.9 2.9 4.1" /></G>
export const GTarget = ({ size }: P) => <G size={size}><circle cx="10" cy="10" r="7" /><circle cx="10" cy="10" r="3.8" /><circle cx="10" cy="10" r=".9" fill="currentColor" /></G>
export const GTrophy = ({ size }: P) => <G size={size}><path d="M6.5 3.5h7v4.2a3.5 3.5 0 0 1-7 0V3.5Z" /><path d="M6.5 5H4a2.4 2.4 0 0 0 2.6 3M13.5 5H16a2.4 2.4 0 0 1-2.6 3M10 11.2V14M7 16.5h6M8 14h4v2.5H8z" /></G>
export const GCert = ({ size }: P) => <G size={size}><rect x="2.5" y="3.5" width="15" height="10.5" rx="1.6" /><path d="M5.5 7h6M5.5 9.8h4" /><circle cx="14" cy="13.6" r="2.2" /><path d="m12.9 15.5-.6 2.5 1.7-.9 1.7.9-.6-2.5" /></G>
export const GDoc = ({ size }: P) => <G size={size}><path d="M5.5 2.8h6l3.5 3.5v10a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1V3.8a1 1 0 0 1 1-1Z" /><path d="M11.5 2.8v3.5H15M7 10h6M7 13h4.5" /></G>
export const GLink = ({ size }: P) => <G size={size}><path d="M8.4 11.6a3.2 3.2 0 0 0 4.6 0l2.6-2.6a3.2 3.2 0 0 0-4.6-4.6l-1 1" /><path d="M11.6 8.4a3.2 3.2 0 0 0-4.6 0l-2.6 2.6a3.2 3.2 0 0 0 4.6 4.6l1-1" /></G>
export const GFilter = ({ size }: P) => <G size={size}><path d="M3 4.5h14l-5.4 6.4v4.6l-3.2 1.5v-6.1L3 4.5Z" /></G>
export const GSort = ({ size }: P) => <G size={size}><path d="M6 4v12M3 7l3-3 3 3M14 16V4M11 13l3 3 3-3" /></G>
export const GCompass = ({ size }: P) => <G size={size}><circle cx="10" cy="10" r="7" /><path d="m12.8 7.2-1.6 4-4 1.6 1.6-4 4-1.6Z" /></G>
export const GHome = ({ size }: P) => <G size={size}><path d="M3 9.2 10 3.5l7 5.7V16a1 1 0 0 1-1 1h-3.6v-4.6H7.6V17H4a1 1 0 0 1-1-1V9.2Z" /></G>
export const GStudio = ({ size }: P) => <G size={size}><path d="M3 15.5V5a1.5 1.5 0 0 1 1.5-1.5h11A1.5 1.5 0 0 1 17 5v10.5" /><path d="M1.8 15.5h16.4M7.5 7.5l-2 2 2 2M12.5 7.5l2 2-2 2" /></G>
export const GExit = ({ size }: P) => <G size={size}><path d="M8 3.5H4.5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1H8" /><path d="M12.5 6.5 16 10l-3.5 3.5M16 10H7.5" /></G>
export const GCheckCircle = ({ size }: P) => <G size={size}><circle cx="10" cy="10" r="7" /><path d="m7 10.2 2 2 4-4.4" /></G>
export const GFlag = ({ size }: P) => <G size={size}><path d="M4.5 17.5v-14M4.5 4h10l-2 3.5 2 3.5h-10" /></G>
export const GRedo = ({ size }: P) => <G size={size}><path d="M15.5 8.5A6 6 0 1 0 16 12" /><path d="M16 4v4.5h-4.5" /></G>
export const GHeadphones = ({ size }: P) => <G size={size}><path d="M3.5 12V10a6.5 6.5 0 0 1 13 0v2" /><rect x="2.5" y="11.5" width="3.8" height="5.5" rx="1.3" /><rect x="13.7" y="11.5" width="3.8" height="5.5" rx="1.3" /></G>
export const GSun = ({ size }: P) => <G size={size}><circle cx="10" cy="10" r="3.3" /><path d="M10 2.5v1.8M10 15.7v1.8M17.5 10h-1.8M4.3 10H2.5M15.3 4.7 14 6M6 14l-1.3 1.3M15.3 15.3 14 14M6 6 4.7 4.7" /></G>
export const GMoon = ({ size }: P) => <G size={size}><path d="M16.5 12.3A7 7 0 0 1 7.7 3.5a7 7 0 1 0 8.8 8.8Z" /></G>
/** A SCORM package: a self-contained interactive module. */
export const GCube = ({ size }: P) => <G size={size}><path d="m10 2.8 6.4 3.6v7.2L10 17.2l-6.4-3.6V6.4L10 2.8Z" /><path d="m3.8 6.5 6.2 3.5 6.2-3.5M10 10v7" /></G>
/** A live session: someone broadcasting. */
export const GLive = ({ size }: P) => <G size={size}><circle cx="10" cy="10" r="1.9" fill="currentColor" stroke="none" /><path d="M6.6 6.6a4.8 4.8 0 0 0 0 6.8M13.4 6.6a4.8 4.8 0 0 1 0 6.8M4.2 4.2a8.2 8.2 0 0 0 0 11.6M15.8 4.2a8.2 8.2 0 0 1 0 11.6" /></G>
export const GCalendar = ({ size }: P) => <G size={size}><rect x="3" y="4.2" width="14" height="12.6" rx="2" /><path d="M3 8.2h14M7 2.8v2.8M13 2.8v2.8" /></G>
