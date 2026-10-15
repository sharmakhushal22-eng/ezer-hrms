import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  renderText, variablesIn, validateTemplate, toEmailHtml, stripMarkup, toParagraphs, renderLetterParagraphs,
} from '../render.ts'

describe('renderText', () => {
  test('fills variables and leaves unknown ones visible, reported', () => {
    const r = renderText('Dear {{name}}, see {{oops}}.', { name: 'Priya' })
    assert.equal(r.text, 'Dear Priya, see {{oops}}.')
    assert.deepEqual(r.unknown, ['oops'])
  })

  test('null and undefined values render as empty, not "null"', () => {
    assert.equal(renderText('[{{a}}][{{b}}]', { a: null, b: undefined }).text, '[][]')
  })

  test('{{#if}} keeps its text only when the value is filled', () => {
    const t = 'Hello{{#if link}}\nJoin: {{link}}{{/if}}.'
    assert.equal(renderText(t, { link: 'https://x' }).text, 'Hello\nJoin: https://x.')
    assert.equal(renderText(t, { link: '' }).text, 'Hello.')
    assert.equal(renderText(t, { link: '   ' }).text, 'Hello.')
  })

  test('an empty optional line never leaves more than one blank line', () => {
    const r = renderText('A\n\n{{x}}\n\nB', { x: '' })
    assert.equal(r.text, 'A\n\nB')
  })

  test('values are inserted as text — template syntax inside a value is not evaluated', () => {
    assert.equal(renderText('{{a}}', { a: '{{b}}' }).text, '{{b}}')
  })
})

describe('variablesIn', () => {
  test('lists tokens and {{#if}} names once, in order', () => {
    assert.deepEqual(variablesIn('{{a}} {{#if b}}{{c}}{{/if}} {{a}}'), ['b', 'a', 'c'])
  })
})

describe('validateTemplate', () => {
  const allowed = ['name', 'link', 'compensation_table']

  test('a clean template has no problems', () => {
    assert.deepEqual(validateTemplate('Dear {{name}}{{#if link}} {{link}}{{/if}}', allowed), [])
  })

  test('flags unknown variables', () => {
    const e = validateTemplate('Dear {{nmae}}', allowed)
    assert.equal(e.length, 1)
    assert.match(e[0], /unknown variable \{\{nmae\}\}/)
  })

  test('flags malformed placeholders', () => {
    assert.ok(validateTemplate('Dear {{ Name }}', allowed).some(e => /malformed/.test(e)))
    assert.ok(validateTemplate('Dear {{name}', allowed).some(e => /malformed/.test(e)))
  })

  test('flags unbalanced and nested {{#if}}', () => {
    assert.ok(validateTemplate('{{#if link}}x', allowed).some(e => /matching/.test(e)))
    assert.ok(validateTemplate('{{#if link}}{{#if name}}x{{/if}}{{/if}}', allowed).some(e => /inside each other/.test(e)))
  })

  test('required text cannot be empty', () => {
    assert.ok(validateTemplate('  ', allowed, { required: true }).some(e => /cannot be empty/.test(e)))
  })

  test('a block variable must be its own paragraph', () => {
    const opts = { blockVars: ['compensation_table'] }
    assert.deepEqual(validateTemplate('A\n\n{{compensation_table}}\n\nB', allowed, opts), [])
    assert.ok(validateTemplate('A {{compensation_table}} B', allowed, opts).some(e => /own line/.test(e)))
  })
})

describe('email output', () => {
  test('HTML part escapes values, keeps bold and line breaks', () => {
    assert.equal(toEmailHtml('Hi <script>x</script> & **you**\nok'), 'Hi &lt;script&gt;x&lt;/script&gt; &amp; <strong>you</strong><br>ok')
  })
  test('web addresses become links, trailing punctuation stays outside', () => {
    assert.equal(toEmailHtml('Open https://a.example/x?y=1&z=2.'), 'Open <a href="https://a.example/x?y=1&amp;z=2">https://a.example/x?y=1&amp;z=2</a>.')
    assert.equal(toEmailHtml('(see https://a.example)\nok'), '(see <a href="https://a.example">https://a.example</a>)<br>ok')
  })
  test('text part drops bold markers', () => {
    assert.equal(stripMarkup('Your **Offer** letter'), 'Your Offer letter')
  })
})

describe('letter paragraphs', () => {
  test('splits on blank lines, keeps line breaks and bold runs', () => {
    const p = toParagraphs('Joining: **1 Nov**\n\n**Anita**\nHR')
    assert.equal(p.length, 2)
    assert.deepEqual(p[0], { kind: 'text', lines: [[{ text: 'Joining: ', bold: false }, { text: '1 Nov', bold: true }]] })
    assert.deepEqual(p[1], { kind: 'text', lines: [[{ text: 'Anita', bold: true }], [{ text: 'HR', bold: false }]] })
  })

  test('a block variable survives rendering as a block, wherever it sits', () => {
    const { paragraphs, unknown } = renderLetterParagraphs('Dear {{n}},\n\n{{compensation_table}}\n\nThanks', { n: 'Priya' }, ['compensation_table'])
    assert.deepEqual(unknown, [])
    assert.equal(paragraphs.length, 3)
    assert.deepEqual(paragraphs[1], { kind: 'block', name: 'compensation_table' })
  })
})

describe('letter HTML', () => {
  test('paragraphs, bold and blocks', async () => {
    const { paragraphsToHtml } = await import('../render.ts')
    const { paragraphs } = renderLetterParagraphs('Dear **{{n}}** <x>,\nline 2\n\n{{tbl}}\n\nBye', { n: 'A&B' }, ['tbl'])
    assert.equal(paragraphsToHtml(paragraphs, { tbl: '<ul></ul>' }), '<p>Dear <b>A&amp;B</b> &lt;x&gt;,<br>line 2</p>\n<ul></ul>\n<p>Bye</p>')
  })
})
