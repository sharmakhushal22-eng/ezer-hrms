// ================================================================
// EZER HRMS — Letter Template Rendering
// Path: lib/letters/renderTemplate.ts
//
// Turns template content (with {{token}} placeholders) plus a
// resolved-fields map into final text. Flags any token left in the
// template that ISN'T in the fields map — usually a typo like
// {{emp_name}} instead of {{employee_name}} — so a mistake in the
// designer surfaces immediately instead of silently printing the
// literal "{{emp_name}}" on someone's actual letter.
// ================================================================
import type { ResolvedFields } from './mergeFields'

const TOKEN_PATTERN = /\{\{([a-z_]+)\}\}/g

export interface RenderResult {
  text: string
  unknownTokens: string[]   // tokens found in the template with no matching field — always check this
}

export function renderTemplate(content: string, fields: ResolvedFields): RenderResult {
  const unknownTokens = new Set<string>()

  const text = content.replace(TOKEN_PATTERN, (match, token) => {
    if (token in fields) return fields[token]
    unknownTokens.add(token)
    return match // leave the literal {{token}} visible — safer than silently dropping it
  })

  return { text, unknownTokens: Array.from(unknownTokens) }
}

/** Every token actually used in a template — for the designer to show "fields used" at a glance. */
export function extractTokens(content: string): string[] {
  const found = new Set<string>()
  let m: RegExpExecArray | null
  const re = new RegExp(TOKEN_PATTERN)
  while ((m = re.exec(content)) !== null) found.add(m[1])
  return Array.from(found)
}
