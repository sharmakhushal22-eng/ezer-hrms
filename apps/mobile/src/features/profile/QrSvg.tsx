// src/features/profile/QrSvg.tsx — draws a QR matrix from ./qr.ts.
//
// Colours and quiet zone as the website's IdCard.tsx passes to QRCode.toDataURL:
// margin 1, dark #0F172A on #FFFFFF. These are literal on purpose — a QR code
// must stay dark-on-light in dark mode too, or scanners fail.
import * as React from 'react'
import Svg, { Path, Rect } from 'react-native-svg'
import { encodeQr } from './qr'

const QR_DARK = '#0F172A' // IdCard.tsx color.dark
const QR_LIGHT = '#FFFFFF' // IdCard.tsx color.light
const MARGIN = 1

export function QrSvg({ value, size }: { value: string; size: number }) {
  const m = React.useMemo(() => encodeQr(value), [value])
  const d = React.useMemo(() => {
    let s = ''
    for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++)
      if (m.modules[y][x]) s += `M${x + MARGIN} ${y + MARGIN}h1v1h-1z`
    return s
  }, [m])
  const n = m.size + MARGIN * 2
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${n} ${n}`} accessibilityLabel="Scan at the gate">
      <Rect x={0} y={0} width={n} height={n} fill={QR_LIGHT} />
      <Path d={d} fill={QR_DARK} />
    </Svg>
  )
}
