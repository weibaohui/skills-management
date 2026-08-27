// Client-plane contract tests for the React/primitives rewrite.
// The primitives package only resolves inside the dsh module loader, so the
// client source is loaded under plain Node with that require shimmed away —
// which is also the assertion surface: interactions must degrade gracefully
// without primitives present (jsdom shim), and never depend on its internals.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const plugin = require('../client/index.js')
const { NS, ZH, EN, matchSkill, formatSize } = plugin.__internals

test('client module declares slots + locale injects', () => {
  assert.equal(plugin.name, 'dsh-plugin-skills-management') // must equal the boot manifest id
  assert.deepEqual(plugin.inject.sort(), ['locale', 'slots'])
})

test('locale dictionaries are zh/en with identical key sets', () => {
  const zhKeys = Object.keys(ZH).sort()
  const enKeys = Object.keys(EN).sort()
  assert.deepEqual(enKeys, zhKeys)
  for (const key of zhKeys) {
    assert.equal(typeof ZH[key], 'string', `zh.${key}`)
    assert.equal(typeof EN[key], 'string', `en.${key}`)
  }
})

test('no hardcoded colors in the client source — ui-theme tokens only', () => {
  const src = readFileSync(new URL('../client/index.js', import.meta.url), 'utf8')
  // gradient() legitimately uses hsl(); inverted-label fallback may pin #fff
  const hex = (src.match(/#[0-9a-fA-F]{3,8}\b/g) || [])
    .filter(h => !src.includes('label-primary-inverted,#fff') && !src.includes('label-primary-inverted, #fff'))
  assert.deepEqual(hex, [], 'hex colors are banned; use var(--dsw-alias-*)')
  assert.ok(src.includes('var(--dsw-alias-label-primary)'), 'label token consumed')
  assert.ok(src.includes('var(--dsw-alias-bg-layer-1'), 'surface token consumed')
})

test('matchSkill covers name/description/keywords case-insensitively', () => {
  const skill = { name: 'Lark-Base', description: '多维表格', keywords: ['Feishu'] }
  assert.ok(matchSkill(skill, 'lark'))
  assert.ok(matchSkill(skill, '表格'))
  assert.ok(matchSkill(skill, 'feishu'))
  assert.equal(matchSkill(skill, 'codex'), false)
})

test('formatSize humanizes bytes like the list views expect', () => {
  assert.equal(formatSize(NaN), '-')
  assert.equal(formatSize(-1), '-')
  assert.equal(formatSize(512), '512 B')
  assert.equal(formatSize(2048), '2.0 KB')
  assert.equal(formatSize(3 * 1024 * 1024), '3.0 MB')
})

test('apply registers dictionaries and both slot entries', async () => {
  const calls = []
  const registered = []
  const ctx = {
    locale: {
      register: (...args) => calls.push(args),
      bind: (ns) => (key) => `${ns}:${key}`,
      subscribe: () => () => {},
    },
    slots: {
      inject: (name, fn) => fn(),
      register: (spec) => registered.push(spec),
    },
    effect: (fn) => fn(),
  }
  plugin.apply(ctx)
  assert.deepEqual(calls.map(c => [c[0], c[1]]).sort(), [[NS, 'en'], [NS, 'zh']])
  assert.equal(registered.length, 2)
  const names = registered.map(r => r.name).sort()
  assert.deepEqual(names, ['settings.section', 'sidebar.footer.action'])
  for (const spec of registered) {
    assert.equal(spec.id, plugin.name)
    assert.equal(typeof spec.inject, 'function')
  }
})
