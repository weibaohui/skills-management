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
const { NS, ZH, EN, matchSkill, formatSize, insertComposerText, fetchSkillCandidates } = plugin.__internals

test('client module declares slots + locale injects', () => {
  assert.equal(plugin.name, '@weibaohui/skills-management') // must equal the boot manifest id
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

test('no component with hooks is invoked as a plain function', () => {
  // Regression: AllSkillsView called `SourceFilterEl({...})`, a wrapper that invoked
  // SourceFilter() directly. SourceFilter owns a useState, so that hook landed on
  // AllSkillsView — which returns <Spinner/> early (zero hooks) while catalogs load and
  // gains one hook afterwards, throwing "Rendered more hooks than during the previous
  // render" and blanking the whole panel. See client/index.js AllSkillsView.
  const src = readFileSync(new URL('../client/index.js', import.meta.url), 'utf8')
  const lines = src.split('\n')

  const decls = []
  lines.forEach((l, i) => {
    const m = /^function ([A-Za-z0-9_]+)\s*\(/.exec(l)
    if (m) decls.push({ name: m[1], line: i + 1 })
  })

  const hasHooks = new Map()
  decls.forEach((d, k) => {
    const end = k + 1 < decls.length ? decls[k + 1].line - 1 : lines.length
    const body = lines.slice(d.line - 1, end).join('\n')
    hasHooks.set(d.name, /\b(useState|useEffect|useRef|useMemo|useCallback)\s*\(/.test(body))
  })

  const offenders = []
  for (const { name, line } of decls) {
    if (!hasHooks.get(name)) continue
    const re = new RegExp(`(^|[^\\w.$])${name}\\s*\\(`, 'g')
    lines.forEach((l, i) => {
      if (i + 1 === line) return
      const code = l.replace(/\/\/.*$/, '').trim()
      if (!code) return
      re.lastIndex = 0
      let m
      while ((m = re.exec(code)) !== null) {
        // `h(Name, ...)` is the correct mount; anything else is a direct call.
        if (/\bh\s*\(\s*$/.test(code.slice(0, m.index + m[1].length))) continue
        offenders.push(`${name} called at line ${i + 1}`)
      }
    })
  }
  assert.deepEqual(offenders, [], 'mount hook-owning components with h(), never call them directly')
})

test('gradient/shortName never throw on missing or non-string names', () => {
  // Both run during render; a throw here is swallowed by SkillsPage's try/catch and
  // surfaces as a blank panel. They must degrade instead of raising.
  const { gradient, shortName } = plugin.__internals
  for (const bad of [undefined, null, '', 42]) {
    assert.doesNotThrow(() => gradient(bad), `gradient(${String(bad)})`)
    assert.doesNotThrow(() => shortName(bad), `shortName(${String(bad)})`)
  }
  assert.equal(shortName('affaan-m-ECC/agent-harness-construction'), 'agent-harness-construction')
  assert.equal(shortName(undefined), '')
  assert.equal(shortName(42), '42')
})

test('market rows already in the library are badged, not offered for install', () => {
  // Regression: the market list has always shipped `installed` (src/index.js builds it
  // from the installed-name set) and the detail endpoint ships `isInstalled`, but
  // SkillCard never read either — so an installed skill still showed an active Install
  // button, inviting a duplicate install that the server rejects with
  // "skill '<x>' already installed".
  const { isInstalledRow, patchMarketInstalled } = plugin.__internals

  assert.equal(isInstalledRow({ installed: true }), true, 'market list plane')
  assert.equal(isInstalledRow({ isInstalled: true }), true, 'detail plane')
  assert.equal(isInstalledRow({ installed: false }), false)
  assert.equal(isInstalledRow({}), false)
  assert.equal(isInstalledRow(undefined), false)

  // optimistic in-place flip must match relPath and leaf, and keep identity when it misses
  const market = [
    { name: 'affaan-m-ECC/agent-harness-construction', shortName: 'agent-harness-construction', installed: false },
    { name: 'other/skill', shortName: 'skill', installed: false },
  ]
  const flipped = patchMarketInstalled(market, 'affaan-m-ECC/agent-harness-construction', true)
  assert.equal(flipped[0].installed, true, 'matched by relPath')
  assert.equal(flipped[1].installed, false, 'other rows untouched')
  assert.equal(market[0].installed, false, 'input not mutated')

  const byLeaf = patchMarketInstalled(market, 'skill', true)
  assert.equal(byLeaf[1].installed, true, 'matched by shortName')

  assert.equal(patchMarketInstalled(market, 'nope', true), market, 'miss keeps array identity')
  assert.equal(patchMarketInstalled(market, undefined, true), market)
  assert.equal(patchMarketInstalled(undefined, 'x', true), undefined)

  // the card must actually consume the flag
  const src = readFileSync(new URL('../client/index.js', import.meta.url), 'utf8')
  assert.ok(/const installed = isInstalledRow\(s\)/.test(src), 'SkillCard derives installed')
  assert.ok(/installed && h\(Tag, \{ tone: 'ok' \}, t\('installedTag'\)\)/.test(src), 'badge rendered')
  assert.ok(/row\.key !== 'dsh' && \(installed/.test(src), 'install button gated on installed')
  assert.ok(/markMarketInstalled\(name, true\)/.test(src), 'install refreshes the badge')
})

test('search input is debounced and does not reset the grid on every keystroke', () => {
  // Regression: InputBox bubbled every keystroke straight into SkillsPage's state, and
  // each PagedGrid was keyed on the search term — so typing rebuilt the whole card grid
  // (up to pageSize cards, each with an Avatar gradient and a token/char stat line)
  // once per character. Defer the bubbled value and drop the search term from the key.
  const src = readFileSync(new URL('../client/index.js', import.meta.url), 'utf8')
  assert.ok(/timerRef\.current = setTimeout\(\(\) => \{ sentRef\.current = next; onSearch\(next\) \}, 300\)/.test(src),
    'InputBox debounces the bubbled value')
  assert.ok(/const \[local, setLocal\] = useState\(value\)/.test(src), 'InputBox keeps local echo state')

  for (const bad of [/key: 'ed' \+ row\.key \+ searchText/, /key: 'md' \+ marketDrill \+ searchMarketDrill/, /key: 'ma' \+ searchMarketAll/]) {
    assert.equal(bad.test(src), false, `search term must not be part of the PagedGrid key: ${bad}`)
  }
  assert.ok(/pageSize = 60, grow = 120/.test(src), 'first paint mounts fewer cards')
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
  assert.deepEqual(names, ['conversation.input.left', 'settings.section'])
  for (const spec of registered) {
    assert.equal(spec.id, plugin.name)
    assert.equal(typeof spec.inject, 'function')
  }
  // ＋技能按钮槽位：打开自带搜索的 picker 浮层
  const composer = registered.find(r => r.name === 'conversation.input.left')
  assert.equal(typeof composer, 'object')
})

test('insertComposerText bails slash/input-insert-text with an end-of-draft span', () => {
  const calls = []
  const scope = { sessions: { scope: (id) => ({ id, bail(...args) { calls.push(args); return true } }) } }
  const ok = insertComposerText(scope, 's1', { draft: 'ab', draftRev: 5 }, '/lint ')
  assert.equal(ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][1], 'slash/input-insert-text')
  assert.deepEqual(calls[0][2], { text: '/lint ', span: { start: 2, end: 2, draftRev: 5 } })
  // bail 未被认领 / 服务缺席 / scope 抛错 → false，无副作用
  assert.equal(insertComposerText({ sessions: { scope: () => ({ bail: () => undefined }) } }, 's', {}, '/x '), false)
  assert.equal(insertComposerText(null, 's', {}, '/x '), false)
  assert.equal(insertComposerText({ sessions: { scope: () => { throw new Error('x') } } }, 's', {}, '/x '), false)
  assert.equal(insertComposerText({ sessions: { scope: () => null } }, 's', {}, '/x '), false)
})

test('fetchSkillCandidates maps the host registry and guards absent services', async () => {
  // 子代理会话：ui-skill 同款守卫，直接空目录
  const subagentSessions = { subagentAddress: () => 'subagent://x' }
  assert.deepEqual(await fetchSkillCandidates(null, subagentSessions, 's-sub'), [])
  // 目录来源缺席 / api 缺失 → reject（picker 落入空态）
  await assert.rejects(() => fetchSkillCandidates(null, {}, 's-1'))
  await assert.rejects(() => fetchSkillCandidates({ api: {} }, {}, 's-1'))
  await assert.rejects(() => fetchSkillCandidates({ remoteSkills: null, connection: null }, {}, 's-1'))
  // result.ok=false → reject（legacy connection.api）
  const badConn = { api: { skills: { list: async () => ({ result: { ok: false } }) } } }
  await assert.rejects(() => fetchSkillCandidates(badConn, {}, 's-bad'))
  // 0.1.5+ remote.skills：解包信封 { ok, value }，且优先于 connection
  let remoteCalls = 0
  let legacyCalls = 0
  const remoteSkills = { list: async () => { remoteCalls += 1; return { ok: true, value: { skills: [
    { name: 'lint', description: '检查', modelInvocable: true },
  ] } } } }
  const legacyConn = { api: { skills: { list: async () => { legacyCalls += 1; return { result: { ok: true, value: { skills: [] } } } } } } }
  const remoteRows = await fetchSkillCandidates({ remoteSkills, connection: legacyConn }, {}, `r-${Date.now()}`)
  assert.deepEqual(remoteRows, [{ name: 'lint', description: '检查', modelInvocable: true }])
  assert.equal(remoteCalls, 1)
  assert.equal(legacyCalls, 0)
  // remote 失败信封 → reject，不静默落回 legacy
  await assert.rejects(() => fetchSkillCandidates({ remoteSkills: { list: async () => ({ ok: false, error: { code: 'x' } }) }, connection: legacyConn }, {}, `rf-${Date.now()}`))
  // 正常映射 + 60s 内同会话走缓存（list 只调一次）
  let calls = 0
  const conn = { api: { skills: { list: async ({ sessionId }) => { calls += 1; return { result: { ok: true, value: { skills: [
    { name: 'lint', description: '检查', modelInvocable: true },
    { name: 'deploy', description: '', modelInvocable: false },
  ] } } } } } } }
  const sid = `s-${Date.now()}`
  const rows = await fetchSkillCandidates(conn, {}, sid)
  assert.deepEqual(rows, [
    { name: 'lint', description: '检查', modelInvocable: true },
    { name: 'deploy', description: '', modelInvocable: false },
  ])
  const again = await fetchSkillCandidates(conn, {}, sid)
  assert.equal(again, rows)
  assert.equal(calls, 1)
})

test('openTriggerSource toggles via sessionOf with a synthetic end-of-draft span', () => {
  const { openTriggerSource } = plugin.__internals
  const calls = []
  const scope = {
    sessions: { scope: (id) => ({ id }) },
    inputTriggers: {
      sessionOf: (actx) => ({
        toggleSource: (name, hit) => calls.push({ name, hit, actx }),
      }),
    },
  }
  const ok = openTriggerSource(scope, 'session-9', { draft: '', draftRev: 3 }, 'skill')
  assert.equal(ok, true)
  assert.equal(calls[0].name, 'skill')
  assert.equal(calls[0].hit.position, 'leading')
  assert.deepEqual(calls[0].hit.span, { start: 0, end: 0, draftRev: 3 })
  // 服务缺席 / scope 不可解析 → false（按钮点击无副作用）
  assert.equal(openTriggerSource(null, 's', {}, 'skill'), false)
  assert.equal(openTriggerSource({ sessions: { scope: () => undefined }, inputTriggers: { sessionOf: () => ({}) } }, 's', {}, 'skill'), false)
})

// ── 注入开销文案与排序（纯 helper）────────────────────────────────────────

test('usageText renders tokens first, degrades to chars, hides on legacy rows', () => {
  const { usageText, EN } = plugin.__internals
  const t = (key, vars) => {
    let out = EN[key] ?? key
    if (vars) for (const [k, v] of Object.entries(vars)) out = out.split('{' + k + '}').join(String(v))
    return out
  }
  const full = usageText({ tokens: 4, chars: 17 }, t)
  assert.equal(full, '≈4 tokens · 17 chars')
  const charsOnly = usageText({ chars: 9 }, t)
  assert.equal(charsOnly, '9 chars')
  assert.equal(usageText({}, t), null)
})

test('sortSkills orders by the picked metric with missing values sinking', () => {
  const { sortSkills } = plugin.__internals
  const rows = [
    { name: 'no-usage' },
    { name: 'a', tokens: 3, chars: 30 },
    { name: 'b', tokens: 9, chars: 10 },
    { name: 'c', tokens: 3, chars: 20 },
  ]
  assert.deepEqual(sortSkills(rows, 'tokens').map(r => r.name), ['b', 'a', 'c', 'no-usage'])
  assert.deepEqual(sortSkills(rows, 'tokensAsc').map(r => r.name), ['a', 'c', 'b', 'no-usage'])
  assert.deepEqual(sortSkills(rows, 'chars').map(r => r.name), ['a', 'c', 'b', 'no-usage'])
  assert.deepEqual(sortSkills(rows, 'default').map(r => r.name), ['no-usage', 'a', 'b', 'c']) // 原序
  // keyFn：{row, s} 包装数组按内层卡片行排序
  const wrapped = rows.map(s => ({ row: {}, s }))
  assert.deepEqual(sortSkills(wrapped, 'tokens', it => it.s).map(it => it.s.name), ['b', 'a', 'c', 'no-usage'])
  // 不改变原数组
  assert.deepEqual(rows.map(r => r.name), ['no-usage', 'a', 'b', 'c'])
})
