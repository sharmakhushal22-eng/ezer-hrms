// lib/config/render.ts — turning template text plus values into the words that go out.
//
// Pure: no database, no React, no Next. The Configuration editor, the preview and
// every workflow that sends a letter or email render through these functions, so the
// preview cannot disagree with what is actually sent. Unit-tested in
// lib/config/__tests__/render.test.ts.
//
// THE TEMPLATE LANGUAGE IS DELIBERATELY SMALL. An HR admin writes it, and nothing in
// it can run code:
//
//   {{variable}}                 a value — lowercase letters, digits, underscores
//   {{#if variable}}…{{/if}}     keep the text inside only when the value is not empty
//                                (no nesting, no else, no expressions)
//   **text**                     bold, in emails and the offer letter
//   a blank line                 starts a new paragraph
//
// Values are inserted as plain text. HTML is escaped when the email's HTML part is
// built, never interpreted.

const TOKEN = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g
const IF_BLOCK = /\{\{#if\s+([a-z][a-z0-9_]*)\s*\}\}([\s\S]*?)\{\{\/if\}\}/g

export type Vars = Record<string, string | number | null | undefined>

export interface RenderResult {
  text: string
  /** Variables the text used that were not supplied. They are left in the text as
   *  {{name}} — printing the placeholder is safer than silently dropping words. */
  unknown: string[]
}

const present = (v: unknown) => v != null && String(v).trim() !== ''

/** Fill a template. Never throws. */
export function renderText(template: string | null | undefined, vars: Vars): RenderResult {
  const unknown = new Set<string>()
  let text = String(template ?? '')

  text = text.replace(IF_BLOCK, (_m, name: string, inner: string) => {
    if (!(name in vars)) unknown.add(name)
    return present(vars[name]) ? inner : ''
  })

  text = text.replace(TOKEN, (match, name: string) => {
    if (name in vars) return vars[name] == null ? '' : String(vars[name])
    unknown.add(name)
    return match
  })

  // An optional line that rendered empty leaves a gap; never more than one blank line.
  text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return { text, unknown: [...unknown] }
}

/** Every variable a template refers to, in first-use order. */
export function variablesIn(template: string | null | undefined): string[] {
  const seen = new Set<string>()
  const src = String(template ?? '')
  for (const m of src.matchAll(/\{\{#if\s+([a-z][a-z0-9_]*)\s*\}\}/g)) seen.add(m[1])
  for (const m of src.matchAll(TOKEN)) seen.add(m[1])
  return [...seen]
}

/**
 * Problems that must be fixed before a template can be published. An empty list
 * means it is valid. `blockVars` are variables that expand to a whole block (the
 * offer letter's compensation table) and so must sit on a line of their own.
 */
export function validateTemplate(
  template: string | null | undefined,
  allowed: string[],
  opts: { blockVars?: string[]; required?: boolean; label?: string } = {},
): string[] {
  const src = String(template ?? '')
  const label = opts.label || 'Text'
  const errors: string[] = []

  if (opts.required && !src.trim()) errors.push(`${label} cannot be empty.`)

  const opens = (src.match(/\{\{#if\b/g) || []).length
  const closes = (src.match(/\{\{\/if\}\}/g) || []).length
  if (opens !== closes) errors.push(`${label}: every {{#if …}} needs a matching {{/if}}.`)

  // No nesting: an {{#if}} inside another one's body is ambiguous to a reader.
  for (const m of src.matchAll(IF_BLOCK)) {
    if (/\{\{#if\b/.test(m[2])) { errors.push(`${label}: {{#if}} blocks cannot be placed inside each other.`); break }
  }

  const allowedSet = new Set(allowed)
  const unknown = variablesIn(src).filter(v => !allowedSet.has(v))
  if (unknown.length) {
    errors.push(`${label}: unknown variable${unknown.length > 1 ? 's' : ''} ${unknown.map(v => `{{${v}}}`).join(', ')}. Use the variable list to insert one.`)
  }

  // Anything that looks like a placeholder but is not one — {{ Name }}, {{name}, {name}}.
  const stripped = src.replace(IF_BLOCK, (_m, _n, inner) => inner).replace(/\{\{\/if\}\}/g, '').replace(TOKEN, '')
  if (/\{\{|\}\}/.test(stripped)) {
    errors.push(`${label}: a placeholder is malformed. Variables are written in lowercase between double braces, e.g. {{candidate_name}}.`)
  }

  for (const b of opts.blockVars || []) {
    const re = new RegExp(`\\{\\{\\s*${b}\\s*\\}\\}`)
    if (!re.test(src)) continue
    const ok = src.split(/\n\s*\n/).some(p => p.trim().replace(/\s+/g, '') === `{{${b}}}`)
    if (!ok) errors.push(`${label}: {{${b}}} must be on its own line with a blank line above and below it.`)
  }
  return errors
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** The HTML part of an email: escaped text, **bold** kept, line breaks kept. */
// A web address in the (already escaped) text; trailing punctuation stays outside the link.
const URL_RE = /\bhttps?:\/\/(?:[^\s<&]|&amp;)*(?:[^\s<&.,;:!?)\]]|&amp;)/g

export function toEmailHtml(text: string): string {
  return esc(text)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(URL_RE, u => `<a href="${u}">${u}</a>`)
    .replace(/\n/g, '<br>')
}

/** The plain-text part, or text for a renderer with no bold: markers removed. */
export function stripMarkup(text: string): string {
  return text.replace(/\*\*([^*\n]+)\*\*/g, '$1')
}

export interface Segment { text: string; bold: boolean }
export type Paragraph =
  | { kind: 'block'; name: string }
  | { kind: 'text'; lines: Segment[][] }

/** Split rendered text into paragraphs, lines and bold runs, for a letter renderer.
 *  A paragraph that is exactly one of `blockNames` (e.g. compensation_table) comes
 *  back as a block for the renderer to draw. Call on the template text BEFORE the
 *  block variable is filled — see renderLetterParagraphs. */
export function toParagraphs(text: string, blockNames: string[] = []): Paragraph[] {
  const out: Paragraph[] = []
  for (const raw of text.split(/\n\s*\n/)) {
    const p = raw.trim()
    if (!p) continue
    const block = blockNames.find(b => p.replace(/\s+/g, '') === `{{${b}}}`)
    if (block) { out.push({ kind: 'block', name: block }); continue }
    out.push({
      kind: 'text',
      lines: p.split('\n').map(line => {
        const segs: Segment[] = []
        const parts = line.split(/(\*\*[^*\n]+\*\*)/g)
        for (const part of parts) {
          if (!part) continue
          const bold = /^\*\*[^*\n]+\*\*$/.test(part)
          segs.push({ text: bold ? part.slice(2, -2) : part, bold })
        }
        return segs
      }),
    })
  }
  return out
}

/** Render a letter template into paragraphs, keeping block placeholders as blocks. */
export function renderLetterParagraphs(template: string, vars: Vars, blockNames: string[] = []): { paragraphs: Paragraph[]; unknown: string[] } {
  // Blocks are kept as placeholders through rendering, then recognised by toParagraphs.
  const keep: Vars = { ...vars }
  for (const b of blockNames) keep[b] = `{{${b}}}`
  const { text, unknown } = renderText(template, keep)
  return { paragraphs: toParagraphs(text, blockNames), unknown }
}

/** A rendered letter as HTML paragraphs, for a letter shown in the browser (transfer letter,
 *  loan agreement). Text is escaped; **bold** stays bold; each block is replaced by the HTML
 *  the caller draws for it. `pStyle` styles every text paragraph. */
export function paragraphsToHtml(paragraphs: Paragraph[], blocks: Record<string, string> = {}, pStyle = ''): string {
  const style = pStyle ? ` style="${esc(pStyle)}"` : ''
  return paragraphs.map(p => p.kind === 'block'
    ? (blocks[p.name] ?? '')
    : `<p${style}>${p.lines.map(line => line.map(s => s.bold ? `<b>${esc(s.text)}</b>` : esc(s.text)).join('')).join('<br>')}</p>`,
  ).join('\n')
}
