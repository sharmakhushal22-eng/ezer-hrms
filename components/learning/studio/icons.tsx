// components/learning/studio/icons.tsx — the few Studio icons glyphs.tsx does not have.
// Same construction: a 20 by 20 box, 1.6 stroke, round ends, currentColor.
type P = { size?: number }

function G({ size = 18, children }: { size?: number; children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0, display: 'block' }}>
      {children}
    </svg>
  )
}

export const GGrip = ({ size }: P) => (
  <G size={size}>{[6, 10, 14].flatMap(y => [7.5, 12.5].map(x => <circle key={`${x}-${y}`} cx={x} cy={y} r=".9" fill="currentColor" stroke="none" />))}</G>
)
export const GEye = ({ size }: P) => <G size={size}><path d="M1.8 10S4.8 4.5 10 4.5 18.2 10 18.2 10 15.2 15.5 10 15.5 1.8 10 1.8 10Z" /><circle cx="10" cy="10" r="2.6" /></G>
export const GRocket = ({ size }: P) => <G size={size}><path d="M11.5 15.5 8.5 12.5M8.5 12.5 4.5 11l2-3.5h4M8.5 12.5 9 16.5l3.5-2v-4" /><path d="M10.5 7.5c2.3-3.2 4.8-4.4 6.8-4.8-.4 2-1.6 4.5-4.8 6.8" /><circle cx="13" cy="7" r="1.1" /></G>
export const GImage = ({ size }: P) => <G size={size}><rect x="2.5" y="3.5" width="15" height="13" rx="2" /><circle cx="7" cy="8" r="1.6" /><path d="m3 15 4.5-4.5 3 3 2.5-2.5 4.5 4.5" /></G>
export const GList = ({ size }: P) => <G size={size}><path d="M7 5.5h10M7 10h10M7 14.5h10" /><circle cx="3.8" cy="5.5" r=".9" fill="currentColor" /><circle cx="3.8" cy="10" r=".9" fill="currentColor" /><circle cx="3.8" cy="14.5" r=".9" fill="currentColor" /></G>
