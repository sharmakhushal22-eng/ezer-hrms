'use client'
// components/analytics/printing.ts — "this is being drawn for the PDF".
//
// The PDF is a picture of the page itself (components/analytics/export.tsx), drawn
// off-screen. Inside that copy, lists show more rows and the controls that only make
// sense on a screen (Show all, Read again, the AI / Rule checks switch) step aside.
import * as React from 'react'

export const Printing = React.createContext(false)
export const usePrinting = () => React.useContext(Printing)

/** Rows a list shows in the PDF; the rest are in the Excel download. */
export const PRINT_ROWS = 15

/** The plain text inside a table cell, for the list search. */
export function nodeText(n: React.ReactNode): string {
  if (n == null || typeof n === 'boolean') return ''
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (Array.isArray(n)) return n.map(nodeText).join(' ')
  if (React.isValidElement(n)) return nodeText((n.props as { children?: React.ReactNode }).children)
  return ''
}
