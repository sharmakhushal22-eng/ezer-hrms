'use client'
// Global auto-capitalisation: on blur, any plain text input whose value looks like
// a NAME (letters + spaces + . ' - only — no digits, no @, no other symbols) is
// normalised to Title Case. So "nayan" / "nAyaN" → "Nayan", "mary-jane" → "Mary-Jane".
//
// Deliberately skipped (so nothing breaks):
//   • email / tel / number / password / search / date inputs (by input type)
//   • anything with digits or "@" (PAN ABCDE1234F, IFSC, Aadhaar, amounts, codes, emails)
//   • <textarea> (addresses / notes keep their exact text)
//   • opt-out: add  data-no-titlecase  to any input that must keep its raw case
import { useEffect } from 'react'

function toTitleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s.'-])([a-z])/g, (_m, sep, ch) => sep + ch.toUpperCase())
}

export default function AutoTitleCase() {
  useEffect(() => {
    const onBlur = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null
      if (!(el instanceof HTMLInputElement)) return
      if ((el.type || 'text').toLowerCase() !== 'text') return
      if (el.readOnly || el.disabled) return
      if (el.dataset.noTitlecase !== undefined) return
      const v = el.value
      if (!v) return
      // Name heuristic: starts with a letter; only letters, spaces, and . ' -
      if (!/^[A-Za-z][A-Za-z .'-]*$/.test(v)) return
      const titled = toTitleCase(v)
      if (titled === v) return
      // Set the value the React-friendly way so controlled inputs update their state.
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      setter?.call(el, titled)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    // blur doesn't bubble — listen in the capture phase to catch it for every input.
    document.addEventListener('blur', onBlur, true)
    return () => document.removeEventListener('blur', onBlur, true)
  }, [])
  return null
}
