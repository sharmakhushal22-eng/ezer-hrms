// HRIS glyphs — ported path-for-path from components/ess/hris/icons.tsx (20×20
// grid, stroked in the state's colour). Only the elements change for react-native-svg.
import * as React from 'react'
import Svg, { Circle, Path, Rect } from 'react-native-svg'

const PATHS: Record<string, (c: string) => React.ReactNode> = {
  user: () => <><Circle cx="10" cy="6.5" r="3.2" /><Path d="M4 16c0-3.3 2.7-5 6-5s6 1.7 6 5" /></>,
  users: () => <><Circle cx="7.5" cy="7" r="2.6" /><Path d="M2.5 15.5c0-2.6 2.2-4 5-4s5 1.4 5 4" /><Path d="M13 5.2a2.5 2.5 0 0 1 0 4.9M14 12c1.9.3 3.5 1.5 3.5 3.5" /></>,
  mail: () => <><Rect x="2.5" y="4.5" width="15" height="11" rx="2" /><Path d="m3 5.5 7 5 7-5" /></>,
  phone: () => <Path d="M4 3.5h3l1.5 4-2 1.3a10 10 0 0 0 4.7 4.7l1.3-2 4 1.5v3a1.5 1.5 0 0 1-1.6 1.5A14 14 0 0 1 2.5 5.1 1.5 1.5 0 0 1 4 3.5Z" />,
  chat: () => <Path d="M3 4.5h14v9H8l-3.5 3v-3H3Z" />,
  check: () => <Path d="m4 10 4 4 8-9" />,
  x: () => <Path d="m5 5 10 10M15 5 5 15" />,
  clock: () => <><Circle cx="10" cy="10" r="7.5" /><Path d="M10 6v4.3l3 1.7" /></>,
  doc: () => <><Path d="M5.5 2.8h6L15 6.4v10.8H5.5Z" /><Path d="M11 2.8v4h4" /></>,
  cash: () => <><Rect x="2.5" y="5" width="15" height="10" rx="2" /><Circle cx="10" cy="10" r="2.2" /></>,
  door: c => <><Path d="M11 3H5v14h6M11 3l4 1v12l-4 1M11 3v15" /><Circle cx="9.3" cy="10" r=".6" fill={c} stroke="none" /></>,
  shield: () => <Path d="M10 2.5 4 4.6v4.2c0 3.7 2.5 6.6 6 8.2 3.5-1.6 6-4.5 6-8.2V4.6Z" />,
  heart: () => <Path d="M10 16S3.5 12 3.5 7.6A3.1 3.1 0 0 1 10 6a3.1 3.1 0 0 1 6.5 1.6C16.5 12 10 16 10 16Z" />,
  ring: () => <><Circle cx="10" cy="12" r="4.2" /><Path d="m7.8 8 1.2-3h2l1.2 3" /></>,
  sos: () => <><Circle cx="10" cy="10" r="7.5" /><Path d="M10 6v4.5M10 13.4h.01" /></>,
  plane: () => <Path d="M10 2.5c.7 0 1 1 1 2.4v2.7l5 3v1.6l-5-1.4v3l1.6 1.2v1.2L10 15.8l-2.6.6v-1.2L9 14v-3l-5 1.4V10.6l5-3V4.9c0-1.4.3-2.4 1-2.4Z" />,
  info: () => <><Circle cx="10" cy="10" r="7.5" /><Path d="M10 9v4.5M10 6.5h.01" /></>,
  search: () => <><Circle cx="9" cy="9" r="6" /><Path d="m14 14 3.5 3.5" /></>,
  lock: () => <><Rect x="4.5" y="9" width="11" height="7.5" rx="1.5" /><Path d="M7 9V6.5a3 3 0 0 1 6 0V9" /></>,
  pin: () => <><Path d="M10 17.5s5-4.6 5-8.2a5 5 0 0 0-10 0c0 3.6 5 8.2 5 8.2Z" /><Circle cx="10" cy="9" r="1.8" /></>,
}
export type IconKey = keyof typeof PATHS

export function Ic({ k, size = 16, color, sw = 1.7 }: { k: IconKey; size?: number; color: string; sw?: number }) {
  const draw = PATHS[k] || PATHS.info
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      {draw(color)}
    </Svg>
  )
}
