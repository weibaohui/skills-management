import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, stat, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const plugin = require('../src/index.js')
const { extractFrontmatter, parseSkillMd, invocationPolicy, installDirName, EXECUTOR_DEFS } = plugin.__internals

// ── HTTP handler harness ────────────────────────────────────────────────

function setupPlugin(config) {
  let handler
  let registered
  let invalidations = 0
  const ctx = {
    skills: {
      registerProvider: (create) => {
        registered = create({ signal: new AbortController().signal, invalidate: () => { invalidations += 1 } })
      },
    },
    webServer: { register: (route) => { handler = route.handler } },
    effect: (fn) => fn(),
    logger: { warn: () => {} },
  }
  plugin.apply(ctx, {
    marketRepoDir: join(tmpdir(), 'dsh-skills-market-test-' + Math.random().toString(36).slice(2)),
    marketSync: { syncOnStartup: false, autoSync: false },
    ...config,
  })
  const call = async (method, url, body) => {
    const req = new EventEmitter()
    req.method = method
    req.url = url
    req.headers = {}
    const chunks = []
    const res = {
      writeHead(status) { chunks.status = status },
      end(chunk) { chunks.body = chunk === undefined ? '' : String(chunk) },
    }
    if (body !== undefined) {
      // 30ms:让路由里先于 readJsonBody 的 await(状态文件读取)先行完成,事件再发射
      setTimeout(() => { req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end') }, 30)
    }
    await handler(req, res)
    return { status: chunks.status, payload: chunks.body ? JSON.parse(chunks.body) : undefined }
  }
  // Streaming variant for routes that pipe bytes (file preview)
  const callRaw = (method, url) => new Promise((fulfil, reject) => {
    const req = new EventEmitter()
    req.method = method
    req.url = url
    req.headers = {}
    const parts = []
    const out = { status: undefined }
    const res = new EventEmitter()
    res.writeHead = (status) => { out.status = status }
    res.write = (chunk) => { parts.push(Buffer.from(chunk)) }
    res.end = (chunk) => { if (chunk !== undefined) parts.push(Buffer.from(chunk)); fulfil({ status: out.status, body: Buffer.concat(parts).toString('utf8') }) }
    Promise.resolve(handler(req, res)).catch(reject)
  })
  return { call, callRaw, registered, getInvalidations: () => invalidations }
}

async function writeSkill(base, rel, meta) {
  await mkdir(join(base, rel), { recursive: true })
  const front = Object.entries(meta).map(([k, v]) => `${k}: ${v}`).join('\n')
  await writeFile(join(base, rel, 'SKILL.md'), `---\n${front}\n---\nbody of ${rel}`)
}

test('plugin exports the host-plane contract', () => {
  assert.equal(plugin.name, 'skills-management')
  // 静态注入：settings（token/市场设置持久化）+ agents/agentDefaultModel/sessions（分享任务进程内执行与打开对话）
  assert.deepEqual(plugin.inject, ['skills', 'webServer', 'settings', 'agents', 'agentDefaultModel', 'sessions'])
})

test('extractFrontmatter requires standalone delimiters', () => {
  assert.equal(extractFrontmatter('no frontmatter here'), undefined)
  assert.equal(extractFrontmatter('---\nname: x\nno closer'), undefined)
  assert.equal(extractFrontmatter('---\nname: x\n---\nbody'), 'name: x')
  // foo---bar inside YAML values must not close the block (ntd parser semantics)
  assert.equal(extractFrontmatter('---\nname: foo---bar\n---\nbody'), 'name: foo---bar')
})

test('parseSkillMd splits frontmatter meta from body', () => {
  const { meta, body } = parseSkillMd('---\nname: code-review\ndescription: 审查代码\nversion: "1.2"\n---\n\n# 步骤\n1. 检查')
  assert.equal(meta.name, 'code-review')
  assert.equal(meta.description, '审查代码')
  assert.equal(body, '# 步骤\n1. 检查')
})

test('parseSkillMd tolerates malformed frontmatter and missing frontmatter', () => {
  const broken = parseSkillMd('---\nname: [unclosed\n---\nbody text')
  assert.equal(broken.body, 'body text')
  const plain = parseSkillMd('# just a body')
  assert.deepEqual(plain.meta, {})
  assert.equal(plain.body, '# just a body')
})

test('invocationPolicy accepts booleans and string forms, defaults permit both', () => {
  assert.deepEqual(invocationPolicy({}), { modelInvocable: true, userInvocable: true })
  assert.deepEqual(invocationPolicy({ 'disable-model-invocation': false }), { modelInvocable: true, userInvocable: true })
  assert.deepEqual(invocationPolicy({ 'disable-model-invocation': true }), { modelInvocable: false, userInvocable: true })
  assert.deepEqual(invocationPolicy({ 'disable-model-invocation': 'yes' }), { modelInvocable: false, userInvocable: true })
  assert.deepEqual(invocationPolicy({ 'user-invocable': 'false' }), { modelInvocable: true, userInvocable: false })
  assert.deepEqual(invocationPolicy({ 'user-invocable': 'off' }), { modelInvocable: true, userInvocable: false })
  assert.deepEqual(invocationPolicy({ 'user-invocable': 'garbage' }), { modelInvocable: true, userInvocable: true })
})

test('installDirName takes the last path segment', () => {
  assert.equal(installDirName('anthropics-skills/doc-coauthoring'), 'doc-coauthoring')
  assert.equal(installDirName('plain'), 'plain')
})

test('apply registers a provider listing installed over market', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skills-'))
  try {
    // market: one source repo with two skills
    await mkdir(join(root, 'market', 'anthropics-skills', 'doc-coauthoring'), { recursive: true })
    await mkdir(join(root, 'market', 'anthropics-skills', 'canvas-design'), { recursive: true })
    await mkdir(join(root, 'market', 'other-repo', 'legacy'), { recursive: true })
    await writeFile(join(root, 'market', 'anthropics-skills', 'doc-coauthoring', 'SKILL.md'),
      '---\nname: doc-coauthoring\ndescription: Co-author docs\n---\nBody A')
    await writeFile(join(root, 'market', 'anthropics-skills', 'canvas-design', 'SKILL.md'),
      '---\nname: canvas-design\ndescription: Design canvas\n---\nBody B')
    await writeFile(join(root, 'market', 'other-repo', 'legacy', 'SKILL.md'),
      '---\nname: legacy\ndescription: legacy entry\n---\nBody C')
    // installed: doc-coauthoring already present → shadows the market row
    await mkdir(join(root, 'installed', 'doc-coauthoring'), { recursive: true })
    await writeFile(join(root, 'installed', 'doc-coauthoring', 'SKILL.md'),
      '---\nname: doc-coauthoring\ndescription: Local override\n---\nLocal body')

    let registered
    const calls = []
    const ctx = {
      skills: {
        registerProvider: (create) => {
          registered = create({ signal: new AbortController().signal, invalidate: () => {} })
          calls.push('register')
        },
      },
      webServer: { register: () => () => {} },
      effect: (fn) => (typeof fn === 'function' ? fn() : undefined),
      logger: { warn: () => {} },
    }
    plugin.apply(ctx, { marketDirs: [join(root, 'market')], installedDir: join(root, 'installed') })
    assert.equal(calls.length, 1)
    assert.equal(registered.name, 'ntd-skills')

    const candidates = await registered.list()
    assert.equal(candidates.length, 3) // installed doc-coauthoring + canvas-design + legacy (market row shadowed)
    const byName = Object.fromEntries(candidates.map((candidate) => [candidate.name, candidate]))
    assert.equal(byName['doc-coauthoring'].source, 'user-installed')
    assert.equal(byName['doc-coauthoring'].rank, 100)
    assert.equal(byName['canvas-design'].source, 'market')
    assert.equal(byName.legacy.source, 'market')

    const loaded = await registered.get(byName['doc-coauthoring'])
    assert.equal(loaded.content, 'Local body')
    assert.equal(loaded.resourceBase.kind, 'directory')

    const marketOne = await registered.get(byName['canvas-design'])
    assert.equal(marketOne.content, 'Body B')
    // 市场库存默认不进模型目录（货架定位）：浏览/安装/用户命令不受影响
    assert.equal(marketOne.invocation.modelInvocable, false)
    assert.equal(marketOne.invocation.userInvocable, true)
    assert.equal(byName['canvas-design'].invocation.modelInvocable, false)
    assert.equal(byName['doc-coauthoring'].invocation.modelInvocable, true) // 已安装的照旧

    // config 逃生舱：marketModelInvocable: true 恢复旧行为
    let registered2
    plugin.apply({
      skills: { registerProvider: (create) => { registered2 = create({ signal: new AbortController().signal, invalidate: () => {} }) } },
      webServer: { register: () => () => {} },
      effect: (fn) => (typeof fn === 'function' ? fn() : undefined),
      logger: { warn: () => {} },
    }, { marketDirs: [join(root, 'market')], installedDir: join(root, 'installed'), marketModelInvocable: true })
    const candidates2 = await registered2.list()
    const byName2 = Object.fromEntries(candidates2.map((candidate) => [candidate.name, candidate]))
    assert.equal(byName2['canvas-design'].invocation.modelInvocable, true)
    const marketBack = await registered2.get(byName2['canvas-design'])
    assert.equal(marketBack.invocation.modelInvocable, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('disable-model-invocation frontmatter drops model invocability only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skills-'))
  try {
    await mkdir(join(root, 'market', 'src', 'secret'), { recursive: true })
    await writeFile(join(root, 'market', 'src', 'secret', 'SKILL.md'),
      '---\nname: secret\ndescription: hidden\ndisable-model-invocation: true\nuser-invocable: "false"\n---\nBody')
    let registered
    const ctx = {
      skills: { registerProvider: (create) => { registered = create({ signal: new AbortController().signal, invalidate: () => {} }) } },
      webServer: { register: () => () => {} },
      effect: (fn) => (typeof fn === 'function' ? fn() : undefined),
      logger: { warn: () => {} },
    }
    plugin.apply(ctx, { marketDirs: [join(root, 'market')], installedDir: join(root, 'installed') })
    const [candidate] = await registered.list()
    assert.equal(candidate.invocation.modelInvocable, false)
    assert.equal(candidate.invocation.userInvocable, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('scan skips .git and node_modules, resolves through nesting', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skills-'))
  try {
    // deeply nested skill (references/examples style, seen in the real market tree)
    await mkdir(join(root, 'market', 'a-repo', 'maker', 'references', 'examples', 'demo'), { recursive: true })
    await writeFile(join(root, 'market', 'a-repo', 'maker', 'references', 'examples', 'demo', 'SKILL.md'),
      '---\nname: demo\ndescription: nested\n---\nNested body')
    await mkdir(join(root, 'market', 'a-repo', '.git', 'objects'), { recursive: true })
    await writeFile(join(root, 'market', 'a-repo', '.git', 'objects', 'SKILL.md'), 'must not be discovered')
    await mkdir(join(root, 'market', 'a-repo', 'node_modules', 'pkg'), { recursive: true })
    await writeFile(join(root, 'market', 'a-repo', 'node_modules', 'pkg', 'SKILL.md'), 'must not be discovered')

    let registered
    const ctx = {
      skills: { registerProvider: (create) => { registered = create({ signal: new AbortController().signal, invalidate: () => {} }) } },
      webServer: { register: () => () => {} },
      effect: (fn) => (typeof fn === 'function' ? fn() : undefined),
      logger: { warn: () => {} },
    }
    plugin.apply(ctx, { marketDirs: [join(root, 'market')], installedDir: join(root, 'installed') })
    const candidates = await registered.list()
    assert.equal(candidates.length, 1)
    assert.equal(candidates[0].name, 'demo')
    assert.ok((await stat(candidates[0].path)).isFile())
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// ── Executor sources (on-machine skills dirs, ntd source-table style) ──

test('executor catalog covers known agents and no default source is read-only', () => {
  const keys = EXECUTOR_DEFS.map((d) => d.key)
  for (const expected of ['dsh', 'claudecode', 'zcode', 'codex', 'workbuddy', 'agents']) assert.ok(keys.includes(expected), `missing ${expected}`)
  // agents 根自治理键开关覆盖起不再只读（与用户库同权）；只读只来自 extraExecutors 的显式标记
  for (const def of EXECUTOR_DEFS) assert.equal(def.readOnly === true, false, `${def.key} must not be read-only`)
})

test('GET /executors groups skills per on-machine source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skills-ex-'))
  try {
    await writeSkill(join(root, 'cc'), 'grouped/foo', { name: 'foo', description: 'Hello from claude', version: '"1.0"' })
    await writeFile(join(root, 'cc', 'grouped', 'foo', 'notes.md'), 'extra file')
    await writeSkill(join(root, 'ag'), 'bar', { name: 'bar', description: 'From agents' })
    await writeSkill(join(root, 'installed'), 'mine', { name: 'mine', description: 'dsh local' })

    const env = setupPlugin({
      marketDirs: [join(root, 'market')],
      installedDir: join(root, 'installed'),
      executorDirs: { claudecode: join(root, 'cc'), agents: join(root, 'ag') },
      disabledExecutors: ['zcode'],
    })
    const res = await env.call('GET', '/skills-management/api/executors')
    assert.equal(res.status, 200)
    const rows = res.payload.executors
    assert.equal(rows[0].key, 'dsh') // dsh row is first, rooted at installedDir
    assert.ok(!rows.some((r) => r.key === 'zcode')) // disabledExecutors honored

    const cc = rows.find((r) => r.key === 'claudecode')
    assert.equal(cc.label, 'Claude Code')
    assert.equal(cc.dirExists, true)
    assert.equal(cc.readOnly, false)
    assert.deepEqual(cc.skills.map((s) => s.name), ['grouped/foo']) // nested, frontmatter name == basename → relPath
    assert.equal(cc.skills[0].fileCount, 2)
    assert.equal(cc.skills[0].version, '1.0')

    const ag = rows.find((r) => r.key === 'agents')
    assert.equal(ag.readOnly, false) // agents 根自治理开关覆盖起可写
    assert.deepEqual(ag.skills.map((s) => s.name), ['bar'])

    const missing = rows.find((r) => r.key === 'codex') // no override, real ~/.codex may exist; only shape-check
    assert.equal(typeof missing.dirExists, 'boolean')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('executors endpoint variants: summary mode and single-source drill-in', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skills-var-'))
  try {
    await writeSkill(join(root, 'cc'), 'foo', { name: 'foo', description: 'one' })
    await writeSkill(join(root, 'cc'), 'nested/bar', { name: 'bar', description: 'two' })
    await writeSkill(join(root, 'installed'), 'mine', { name: 'mine', description: 'dsh' })

    const env = setupPlugin({
      marketDirs: [join(root, 'market')],
      installedDir: join(root, 'installed'),
      executorDirs: { claudecode: join(root, 'cc') },
    })

    // summary mode: counts without per-skill arrays (lazy UI loading)
    const summary = await env.call('GET', '/skills-management/api/executors?mode=summary')
    assert.equal(summary.status, 200)
    const ccSummary = summary.payload.executors.find((r) => r.key === 'claudecode')
    assert.equal(ccSummary.skillCount, 2)
    assert.equal(ccSummary.skills, undefined)

    // scoped mode: one source's full list
    const scoped = await env.call('GET', '/skills-management/api/executors?executor=claudecode')
    assert.equal(scoped.status, 200)
    assert.equal(scoped.payload.executor.key, 'claudecode')
    // flat skill keeps frontmatter name; nested keeps its category path
    assert.deepEqual(scoped.payload.executor.skills.map((s) => s.name), ['foo', 'nested/bar'])
    assert.equal(scoped.payload.executor.skillCount, 2)

    const unknown = await env.call('GET', '/skills-management/api/executors?executor=nope')
    assert.equal(unknown.status, 400)
    assert.match(unknown.payload.error, /unknown executor/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('executor-settings sheet: GET lists all built-ins with flags, PUT applies runtime changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skills-sheet-'))
  try {
    await writeSkill(join(root, 'cx'), 'zeds', { name: 'zeds', description: 'From runtime-overridden codex' })
    await writeSkill(join(root, 'mc'), 'local-shot', { name: 'local-shot', description: 'From custom executor' })
    await writeSkill(join(root, 'installed'), 'mine', { name: 'mine', description: 'dsh local' })

    const env = setupPlugin({
      marketDirs: [join(root, 'market')],
      installedDir: join(root, 'installed'),
      disabledExecutors: ['zcode'], // cordis 停用：管理面板仍要列出（UI 置灰）
    })

    // GET：全量内置 + 每行可编辑性标记；目录是 raw 默认值（~ 形式）
    const sheet = await env.call('GET', '/skills-management/api/executor-settings')
    assert.equal(sheet.status, 200)
    const rows = sheet.payload.executors
    assert.equal(rows[0].key, 'dsh')
    assert.equal(rows[0].locked, true)
    const zc = rows.find((r) => r.key === 'zcode')
    assert.equal(zc.disabled, true)
    assert.equal(zc.managedByConfig, false)
    assert.equal(zc.dir, '~/.zcode/skills')
    const cc = rows.find((r) => r.key === 'claudecode')
    assert.equal(cc.dir, '~/.claude/skills')
    assert.equal(cc.overridden, false)
    assert.ok(!rows.some((r) => r.source === 'custom'))
    assert.ok(sheet.payload.settingsFile.endsWith('settings.yaml'))

    // PUT：目录覆盖 + 停用 + 新增，扫描/定位立即走动态 rows
    const put = await env.call('PUT', '/skills-management/api/executor-settings', {
      dirs: { codex: join(root, 'cx') },
      disabled: ['kilo', 'pi'],
      extra: [{ key: 'my-cli', label: 'My CLI', dir: join(root, 'mc') }],
    })
    assert.equal(put.status, 200)
    assert.equal(put.payload.executors.find((r) => r.key === 'codex').overridden, true)
    // 管理面板投影连停用行也列出（UI 置灰），只断言标记
    assert.equal(put.payload.executors.find((r) => r.key === 'kilo').disabled, true)

    const scan = await env.call('GET', '/skills-management/api/executors?executor=codex')
    assert.equal(scan.status, 200)
    assert.deepEqual(scan.payload.executor.skills.map((s) => s.name), ['zeds'])
    const custom = await env.call('GET', '/skills-management/api/executors?executor=my-cli')
    assert.equal(custom.status, 200)
    assert.equal(custom.payload.executor.source, 'custom')
    assert.equal(custom.payload.executor.label, 'My CLI')
    const gone = await env.call('GET', '/skills-management/api/executors?executor=kilo')
    assert.equal(gone.status, 400)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('executor-settings PUT rejects locked/unknown/duplicate/invalid rows', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skills-putval-'))
  try {
    const env = setupPlugin({ marketDirs: [join(root, 'market')], installedDir: join(root, 'installed') })
    const cases = [
      [{ dirs: { dsh: '/tmp/x' }, disabled: [], extra: [] }, /dsh.*locked/],
      [{ dirs: {}, disabled: ['dsh'], extra: [] }, /dsh.*cannot be disabled/],
      [{ dirs: { nope: '/tmp/x' }, disabled: [], extra: [] }, /unknown executor/],
      [{ dirs: {}, disabled: [], extra: [{ key: 'Bad_Key', label: 'x', dir: '/tmp/y' }] }, /kebab/],
      [{ dirs: {}, disabled: [], extra: [{ key: 'codex', label: 'x', dir: '/tmp/y' }] }, /already exists/],
      [{ dirs: {}, disabled: [], extra: [{ key: 'my-cli', label: 'x', dir: '' }] }, /non-empty string/],
    ]
    for (const [body, re] of cases) {
      const res = await env.call('PUT', '/skills-management/api/executor-settings', body)
      assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}`)
      assert.match(res.payload.error, re)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('executor-settings cordis config wins over runtime sheet; empty PUT restores defaults', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skills-prio-'))
  try {
    await writeSkill(join(root, 'cc'), 'cordis-one', { name: 'cordis-one', description: 'cordis root' })
    await writeSkill(join(root, 'runtime'), 'runtime-one', { name: 'runtime-one', description: 'runtime root' })
    const env = setupPlugin({
      marketDirs: [join(root, 'market')],
      installedDir: join(root, 'installed'),
      executorDirs: { claudecode: join(root, 'cc') }, // cordis 静态配置
    })
    // runtime 想覆盖同一 key：被 cordis 压制
    await env.call('PUT', '/skills-management/api/executor-settings', {
      dirs: { claudecode: join(root, 'runtime') },
      disabled: [],
      extra: [{ key: 'temp', label: 'Temp', dir: join(root, 'runtime') }],
    })
    let scan = await env.call('GET', '/skills-management/api/executors?executor=claudecode')
    assert.deepEqual(scan.payload.executor.skills.map((s) => s.name), ['cordis-one'])
    let sheet = await env.call('GET', '/skills-management/api/executor-settings')
    assert.equal(sheet.payload.executors.find((r) => r.key === 'claudecode').managedByConfig, true)
    assert.equal(sheet.payload.executors.some((r) => r.key === 'temp'), true)

    // 恢复默认：整表清空 → runtime 自定义消失，cordis 根不受影响
    const restore = await env.call('PUT', '/skills-management/api/executor-settings', { dirs: {}, disabled: [], extra: [] })
    assert.equal(restore.status, 200)
    assert.ok(!restore.payload.executors.some((r) => r.key === 'temp'))
    sheet = await env.call('GET', '/skills-management/api/executor-settings')
    assert.ok(!sheet.payload.executors.some((r) => r.key === 'temp'))
    scan = await env.call('GET', '/skills-management/api/executors?executor=claudecode')
    assert.deepEqual(scan.payload.executor.skills.map((s) => s.name), ['cordis-one'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('detail and file APIs accept an executor scope', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skills-detail-'))
  try {
    await writeSkill(join(root, 'cc'), 'peer', { name: 'peer', description: 'In claude' })
    await writeFile(join(root, 'cc', 'peer', 'notes.md'), 'note text')
    await writeSkill(join(root, 'installed'), 'peer', { name: 'peer', description: 'Same name in dsh lib' })

    const env = setupPlugin({
      marketDirs: [join(root, 'market')],
      installedDir: join(root, 'installed'),
      executorDirs: { claudecode: join(root, 'cc') },
    })
    // scoped: must see the claude copy even though dsh library shadows the name
    const scoped = await env.call('GET', '/skills-management/api/detail?name=peer&executor=claudecode')
    assert.equal(scoped.status, 200)
    assert.equal(scoped.payload.meta.description, 'In claude')
    assert.equal(scoped.payload.executor, 'claudecode')
    assert.equal(scoped.payload.isInstalled, false)

    // file fetch under the same scope
    const file = await env.callRaw('GET', '/skills-management/api/file?name=peer&executor=claudecode&path=notes.md')
    assert.equal(file.status, 200)
    assert.equal(file.body, 'note text')

    // traversal attempt inside the skill dir is rejected
    const escape = await env.call('GET', '/skills-management/api/file?name=..%2Fpeer&executor=claudecode&path=notes.md')
    assert.equal(escape.status, 400)

    const unscoped = await env.call('GET', '/skills-management/api/detail?name=peer')
    assert.equal(unscoped.status, 200)
    assert.equal(unscoped.payload.isInstalled, true) // legacy auto path still resolves to the dsh library first

    const unknown = await env.call('GET', '/skills-management/api/detail?name=x&executor=nope')
    assert.equal(unknown.status, 400)
    assert.match(unknown.payload.error, /unknown executor/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('DELETE is scoped to a source and refuses read-only ones', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skills-del-'))
  try {
    await writeSkill(join(root, 'cc'), 'removable', { name: 'removable', description: 'x' })
    await writeSkill(join(root, 'locked'), 'protected', { name: 'protected', description: 'x' })
    await writeSkill(join(root, 'installed'), 'local', { name: 'local', description: 'x' })

    const env = setupPlugin({
      marketDirs: [join(root, 'market')],
      installedDir: join(root, 'installed'),
      executorDirs: { claudecode: join(root, 'cc') },
      // 只读语义仍保留给显式标记的 extra 来源（agents 根自治理开关覆盖起不再只读）
      extraExecutors: [{ key: 'locked', label: 'Locked', dir: join(root, 'locked'), readOnly: true }],
    })

    const refused = await env.call('DELETE', '/skills-management/api', { name: 'protected', executor: 'locked' })
    assert.equal(refused.status, 400)
    assert.match(refused.payload.error, /read-only/)
    await assert.doesNotReject(stat(join(root, 'locked', 'protected')))

    const removed = await env.call('DELETE', '/skills-management/api', { name: 'removable', executor: 'claudecode' })
    assert.equal(removed.status, 200)
    await assert.rejects(stat(join(root, 'cc', 'removable')))
    assert.equal(removed.payload.removed, 'removable')

    const legacy = await env.call('DELETE', '/skills-management/api', { name: 'local' }) // no executor → dsh library
    assert.equal(legacy.status, 200)
    assert.equal(legacy.payload.executor, 'dsh')
    assert.ok(env.getInvalidations() >= 1) // dsh deletes refresh the provider
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// dir name ≠ frontmatter name (WorkBuddy-style: `dev-expert__skillhub/` whose
// SKILL.md says `name: dev-expert`). The client lists & addresses such skills
// by their frontmatter name, so detail/file/install/delete must resolve by it.
test('executor skills whose dir name ≠ frontmatter name resolve by frontmatter name', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skills-mismatch-'))
  try {
    await mkdir(join(root, 'wb', 'dev-expert__skillhub'), { recursive: true })
    await writeFile(join(root, 'wb', 'dev-expert__skillhub', 'SKILL.md'),
      '---\nname: dev-expert\ndescription: expert skill\nversion: "1.0"\n---\nbody')
    await writeFile(join(root, 'wb', 'dev-expert__skillhub', 'notes.md'), 'note text')
    // a matched skill alongside (dir == name) must still resolve via the direct path
    await writeSkill(join(root, 'wb'), 'plain-tool', { name: 'plain-tool', description: 'matched' })

    const env = setupPlugin({
      marketDirs: [join(root, 'market')],
      installedDir: join(root, 'installed'),
      executorDirs: { workbuddy: join(root, 'wb') },
    })
    const call = env.call

    // list returns the frontmatter name for both shapes
    const list = await call('GET', '/skills-management/api/executors?executor=workbuddy')
    assert.equal(list.status, 200)
    const names = list.payload.executor.skills.map((s) => s.name)
    assert.ok(names.includes('dev-expert'))
    assert.ok(names.includes('plain-tool'))

    // detail by frontmatter name resolves to the mismatched dir
    const detail = await call('GET', '/skills-management/api/detail?name=dev-expert&executor=workbuddy')
    assert.equal(detail.status, 200)
    assert.equal(detail.payload.meta.name, 'dev-expert')
    assert.equal(detail.payload.meta.version, '1.0')
    assert.ok(detail.payload.dir.includes('dev-expert__skillhub'))

    // file preview under the same scope
    const file = await env.callRaw('GET', '/skills-management/api/file?name=dev-expert&executor=workbuddy&path=notes.md')
    assert.equal(file.status, 200)
    assert.equal(file.body, 'note text')

    // install by frontmatter name copies into the library as the dir's short name
    const inst = await call('POST', '/skills-management/api/install', { name: 'dev-expert', from: 'workbuddy' })
    assert.equal(inst.status, 201)
    await stat(join(root, 'installed', 'dev-expert', 'SKILL.md'))

    // delete by frontmatter name removes the mismatched dir
    const del = await call('DELETE', '/skills-management/api', { name: 'dev-expert', executor: 'workbuddy' })
    assert.equal(del.status, 200)
    await assert.rejects(stat(join(root, 'wb', 'dev-expert__skillhub')))

    // matched skill still deletes by direct path
    const delPlain = await call('DELETE', '/skills-management/api', { name: 'plain-tool', executor: 'workbuddy' })
    assert.equal(delPlain.status, 200)
    await assert.rejects(stat(join(root, 'wb', 'plain-tool')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('POST /install with `from` copies an executor skill into the dsh library', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skills-copy-'))
  try {
    await writeSkill(join(root, 'cc'), 'handy', { name: 'handy', description: 'Useful elsewhere', version: '"2.1"' })
    await writeFile(join(root, 'cc', 'handy', 'helper.py'), '#!/usr/bin/env python3')

    const env = setupPlugin({
      marketDirs: [join(root, 'market')],
      installedDir: join(root, 'installed'),
      executorDirs: { claudecode: join(root, 'cc') },
    })

    const res = await env.call('POST', '/skills-management/api/install', { name: 'handy', from: 'claudecode' })
    assert.equal(res.status, 201)
    assert.equal(res.payload.installed.from, 'claudecode')

    const copied = join(root, 'installed', 'handy')
    await stat(join(copied, 'SKILL.md'))
    await stat(join(copied, 'helper.py'))
    const names = (await env.registered.list()).map((c) => c.name)
    assert.ok(names.includes('handy'))

    const dup = await env.call('POST', '/skills-management/api/install', { name: 'handy', from: 'claudecode' })
    assert.equal(dup.status, 400)
    assert.match(dup.payload.error, /already installed/)

    const over = await env.call('POST', '/skills-management/api/install', { name: 'handy', from: 'claudecode', overwrite: true })
    assert.equal(over.status, 201)

    const badSource = await env.call('POST', '/skills-management/api/install', { name: 'gone', from: 'kilo' })
    assert.equal(badSource.status, 400)
    assert.match(badSource.payload.error, /not found in Kilo/)

    const invalidName = await env.call('POST', '/skills-management/api/install', { name: '../escape', from: 'claudecode' })
    assert.equal(invalidName.status, 400)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// ── Market git sync (clone + update, ntd semantics) ──

import { execFile as execFileCb } from 'node:child_process'
const git = (args, cwd) => new Promise((fulfil, reject) => {
  execFileCb('git', args, { cwd }, (error, stdout, stderr) => {
    if (error) reject(new Error(`git ${args.join(' ')}: ${stderr || error.message}`)); else fulfil(stdout)
  })
})

async function makeRemoteRepo(dir, skills) {
  for (const [rel, content] of Object.entries(skills)) {
    await mkdir(join(dir, 'skills', rel, '..'), { recursive: true })
    await writeFile(join(dir, 'skills', rel), content)
  }
  await git(['init', '-q', '-b', 'main', '.'], dir)
  await git(['config', 'user.email', 't@t'], dir)
  await git(['config', 'user.name', 't'], dir)
  await git(['add', '-A'], dir)
  await git(['commit', '-qm', 'init'], dir)
}

test('market sync clones, then fetches updates from a git remote', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-market-sync-'))
  try {
    const remote = join(root, 'remote')
    await makeRemoteRepo(remote, { 'demo-repo/alpha/SKILL.md': '---\nname: alpha\ndescription: first\n---\nA' })
    const local = join(root, 'local')

    const env = setupPlugin({
      marketDirs: [join(local, 'skills')],
      installedDir: join(root, 'installed'),
      marketRepoDir: local,
      marketSync: { url: remote, branch: 'main', syncOnStartup: false, autoSync: false },
    })

    // 首次同步 = 克隆
    const first = await env.call('POST', '/skills-management/api/market/sync')
    assert.equal(first.status, 200)
    assert.equal(first.payload.isFirstClone, true)
    assert.equal(first.payload.hasUpdates, true)

    // 状态:仓库在、无 token、无待更新
    const st1 = await env.call('GET', '/skills-management/api/market/status')
    assert.equal(st1.status, 200)
    assert.equal(st1.payload.repoExists, true)
    assert.equal(st1.payload.hasToken, false)
    assert.equal(st1.payload.needsUpdate, false)
    assert.ok(st1.payload.localCommit)

    // 市场列表可见克隆下来的技能
    const list1 = await env.call('GET', '/skills-management/api')
    assert.ok(list1.payload.market.some(s => s.name === 'demo-repo/alpha'))

    // 远端新增一个技能 → 同步 = fetch + reset
    await mkdir(join(remote, 'skills', 'demo-repo', 'beta'), { recursive: true })
    await writeFile(join(remote, 'skills', 'demo-repo', 'beta', 'SKILL.md'), '---\nname: beta\ndescription: second\n---\nB')
    await git(['add', '-A'], remote)
    await git(['commit', '-qm', 'add beta'], remote)
    const second = await env.call('POST', '/skills-management/api/market/sync')
    assert.equal(second.status, 200)
    assert.equal(second.payload.isFirstClone, false)
    assert.equal(second.payload.hasUpdates, true)

    const list2 = await env.call('GET', '/skills-management/api')
    assert.ok(list2.payload.market.some(s => s.name === 'demo-repo/beta'))

    // 设置:token 只写不回读;状态只给 hasToken
    const put = await env.call('PUT', '/skills-management/api/market/settings', { token: 'secret-token', branch: 'main' })
    assert.equal(put.status, 200)
    assert.equal(put.payload.settings.token, undefined)
    assert.equal(put.payload.settings.branch, 'main')
    const st2 = await env.call('GET', '/skills-management/api/market/status')
    assert.equal(st2.payload.hasToken, true)
    // 清除
    await env.call('PUT', '/skills-management/api/market/settings', { token: null })
    const st3 = await env.call('GET', '/skills-management/api/market/status')
    assert.equal(st3.payload.hasToken, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('market sync clones sparse: only the skills subtree lands in the worktree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-market-sparse-'))
  try {
    const remote = join(root, 'remote')
    await makeRemoteRepo(remote, { 'demo-repo/alpha/SKILL.md': '---\nname: alpha\ndescription: first\n---\nA' })
    // 仓库同时携带 skills 之外子树（ntd-resource 现实形状：experts/ + templates/）
    await mkdir(join(remote, 'experts', 'some-expert'), { recursive: true })
    await writeFile(join(remote, 'experts', 'some-expert', 'plugin.json'), '{}')
    await git(['add', '-A'], remote)
    await git(['commit', '-qm', 'add experts'], remote)
    const local = join(root, 'local')

    const env = setupPlugin({
      installedDir: join(root, 'installed'),
      marketRepoDir: local,
      marketSync: { url: remote, branch: 'main', syncOnStartup: false, autoSync: false },
    })

    const first = await env.call('POST', '/skills-management/api/market/sync')
    assert.equal(first.status, 200)
    assert.equal(first.payload.isFirstClone, true)
    // skills 子树在工作区，skills 之外的 experts/ 被稀疏排除
    await stat(join(local, 'skills', 'demo-repo', 'alpha', 'SKILL.md'))
    await assert.rejects(stat(join(local, 'experts')))
    // 状态透出稀疏配置
    const st = await env.call('GET', '/skills-management/api/market/status')
    assert.deepEqual(st.payload.sparsePaths, ['skills'])

    // fetch+reset 更新路径在稀疏检出上照常工作，且不越界检出其他子树
    await mkdir(join(remote, 'skills', 'demo-repo', 'beta'), { recursive: true })
    await writeFile(join(remote, 'skills', 'demo-repo', 'beta', 'SKILL.md'), '---\nname: beta\ndescription: second\n---\nB')
    await git(['add', '-A'], remote)
    await git(['commit', '-qm', 'add beta'], remote)
    const second = await env.call('POST', '/skills-management/api/market/sync')
    assert.equal(second.status, 200)
    assert.equal(second.payload.hasUpdates, true)
    await stat(join(local, 'skills', 'demo-repo', 'beta', 'SKILL.md'))
    await assert.rejects(stat(join(local, 'experts')))

    // marketSparsePaths: null 逃生舱 → 全量检出
    const fullLocal = join(root, 'local-full')
    const env2 = setupPlugin({
      installedDir: join(root, 'installed'),
      marketRepoDir: fullLocal,
      marketSparsePaths: null,
      marketSync: { url: remote, branch: 'main', syncOnStartup: false, autoSync: false },
    })
    await env2.call('POST', '/skills-management/api/market/sync')
    await stat(join(fullLocal, 'experts', 'some-expert', 'plugin.json'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('market repo dir is runtime-configurable and the scan follows it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-market-dir-'))
  try {
    const remote = join(root, 'remote')
    await makeRemoteRepo(remote, { 'demo-repo/gamma/SKILL.md': '---\nname: gamma\ndescription: g\n---\nG' })
    const dirA = join(root, 'checkout-a')
    const dirB = join(root, 'checkout-b')

    // 不传 marketDirs → 扫描根自动跟随 repoDir/skills
    const env = setupPlugin({
      installedDir: join(root, 'installed'),
      marketRepoDir: dirA,
      marketSync: { url: remote, branch: 'main', syncOnStartup: false, autoSync: false },
    })

    await env.call('POST', '/skills-management/api/market/sync')
    let list = await env.call('GET', '/skills-management/api')
    assert.ok(list.payload.market.some(s => s.name === 'demo-repo/gamma'), 'scans from dirA/skills')

    // 运行期换目录:PUT settings.repoDir → 状态/扫描立即切换,再同步克隆到新目录
    const put = await env.call('PUT', '/skills-management/api/market/settings', { repoDir: dirB })
    assert.equal(put.status, 200)
    const st = await env.call('GET', '/skills-management/api/market/status')
    assert.equal(st.payload.dir, dirB, 'status follows the new dir')
    assert.equal(st.payload.repoExists, false, 'new dir not cloned yet')

    await env.call('POST', '/skills-management/api/market/sync')
    list = await env.call('GET', '/skills-management/api')
    assert.ok(list.payload.market.some(s => s.name === 'demo-repo/gamma'), 'scans from dirB/skills after switch')
    const st2 = await env.call('GET', '/skills-management/api/market/status')
    assert.equal(st2.payload.repoExists, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('market settings persist through the host settings service when present', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-market-settings-'))
  try {
    const registrations = []
    const updates = []
    const store = {}  // ns → resolved section
    const ctx = {
      skills: { registerProvider: (create) => { create({ signal: new AbortController().signal, invalidate: () => {} }) } },
      webServer: { register: (route) => { globalThis.__settingsRoute = route.handler } },
      effect: (fn) => fn(),
      logger: { warn: () => {} },
      settings: { register: (ns, schema, opts) => {
        registrations.push(ns)
        store[ns] = { ...opts.base }
        return {
          get: () => store[ns],
          update: async (patch) => { updates.push(patch); Object.assign(store[ns], patch) },
        }
      } },
    }
    plugin.apply(ctx, {
      marketRepoDir: join(root, 'checkout'),
      marketSync: { url: 'https://example.com/x.git', syncOnStartup: false, autoSync: false },
    })
    assert.deepEqual(registrations, ['skills-management-market', 'skills-management-executors'], 'registers the market + executor settings namespaces on the static settings service')

    const call = (method, url, body) => new Promise((fulfil) => {
      const chunks = []
      const res = { writeHead() {}, end: (c) => fulfil(c ? JSON.parse(String(c)) : undefined) }
      const req = new (require('node:events').EventEmitter)()
      req.method = method; req.url = url; req.headers = {}
      if (body !== undefined) setTimeout(() => { req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end') }, 30)
      globalThis.__settingsRoute(req, res)
    })

    // 覆盖写入进入 settings 命名空间,回读来自 scope.get
    const put = await call('PUT', '/skills-management/api/market/settings', { branch: 'dev', token: 't-1' })
    assert.equal(put.settings.branch, 'dev')
    assert.equal(put.settings.token, undefined, 'token never echoed')
    assert.equal(put.hasToken, true)
    assert.deepEqual(updates, [{ branch: 'dev', token: 't-1' }], 'routed through scope.update')
    const st = await call('GET', '/skills-management/api/market/status')
    assert.equal(st.branch, 'dev')
    assert.equal(st.url, 'https://example.com/x.git', 'composition base preserved')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('share/run executes a real process in the skill directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-share-run-'))
  try {
    // 假 dsh:echo 二进制,输出任务文本以便断言(SKILLS_DSH_BIN 覆盖)
    await mkdir(join(root, 'skill'), { recursive: true })
    await writeFile(join(root, 'skill', 'SKILL.md'), '---\nname: x\n---\nbody')
    const env = setupPlugin({
      marketRepoDir: join(root, 'repo'),
      installedDir: join(root, 'installed'),
      marketSync: { syncOnStartup: false, autoSync: false },
    })
    process.env.SKILLS_DSH_BIN = '/bin/echo'

    const bad1 = await env.call('POST', '/skills-management/api/share/run', { dir: join(root, 'skill') })
    assert.equal(bad1.status, 400, 'missing prompt rejected')
    const bad2 = await env.call('POST', '/skills-management/api/share/run', { prompt: 'hi' })
    assert.equal(bad2.status, 400, 'missing dir rejected')
    const bad3 = await env.call('POST', '/skills-management/api/share/run', { prompt: 'hi', dir: join(root, 'nope') })
    assert.equal(bad3.status, 400, 'unknown dir rejected')

    const start = await env.call('POST', '/skills-management/api/share/run', { prompt: 'OK-RUN', dir: join(root, 'skill') })
    assert.equal(start.status, 202)
    assert.equal(start.payload.status, 'running')
    // 等待 echo 进程完成
    let job = null
    for (let i = 0; i < 20; i += 1) {
      await new Promise(r => setTimeout(r, 100))
      job = await env.call('GET', '/skills-management/api/share/run?id=' + start.payload.jobId)
      if (job.payload.status !== 'running') break
    }
    assert.equal(job.payload.status, 'done')
    assert.ok(String(job.payload.output).includes('OK-RUN'), 'process output captured')
  } finally {
    delete process.env.SKILLS_DSH_BIN
    await rm(root, { recursive: true, force: true })
  }
})

test('invocation toggle writes the native frontmatter key and preserves the rest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skills-inv-'))
  try {
    await mkdir(join(root, 'installed', 'my-skill'), { recursive: true })
    await writeFile(join(root, 'installed', 'my-skill', 'SKILL.md'),
      '---\nname: my-skill\ndescription: d\nversion: "2.0"\n---\n\nbody')
    const env = setupPlugin({ installedDir: join(root, 'installed'), marketDirs: [join(root, 'market')] })
    const call = env.call
    const put = await call('PUT', '/skills-management/api/invocation', { name: 'my-skill', modelInvocable: false })
    assert.equal(put.status, 200)
    let raw = await readFile(join(root, 'installed', 'my-skill', 'SKILL.md'), 'utf8')
    assert.match(raw, /disable-model-invocation: true/)
    assert.match(raw, /version: "2\.0"/) // 其余键保留
    // detail 回读 meta 带 disable-model-invocation
    const detail = await call('GET', '/skills-management/api/detail?name=my-skill')
    assert.equal(detail.payload.meta['disable-model-invocation'], true)
    // 切回
    await call('PUT', '/skills-management/api/invocation', { name: 'my-skill', modelInvocable: true })
    raw = await readFile(join(root, 'installed', 'my-skill', 'SKILL.md'), 'utf8')
    assert.doesNotMatch(raw, /disable-model-invocation/)
    assert.match(raw, /version: "2\.0"/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('PUT /invocation also covers the user-agents root (~/.agents/skills)', async () => {
  const home = await mkdtemp(join(tmpdir(), 'sk-inv-agents-'))
  const prevAgents = process.env.DSH_AGENTS_HOME
  process.env.DSH_AGENTS_HOME = home // 解析为 <home>/skills
  try {
    await writeSkill(join(home, 'skills'), 'agents-only-skill', { name: 'agents-only-skill', description: 'lives in the shared agents root' })
    const { call } = setupPlugin({ installedDir: join(home, 'dsh-user-skills') }) // dsh 库里没有它
    const off = await call('PUT', '/skills-management/api/invocation', { name: 'agents-only-skill', modelInvocable: false })
    assert.equal(off.status, 200)
    assert.equal(off.payload.root, 'agents')
    const content = await readFile(join(home, 'skills', 'agents-only-skill', 'SKILL.md'), 'utf8')
    assert.match(content, /disable-model-invocation: true/)
    const on = await call('PUT', '/skills-management/api/invocation', { name: 'agents-only-skill', modelInvocable: true })
    assert.equal(on.status, 200)
    assert.doesNotMatch(await readFile(join(home, 'skills', 'agents-only-skill', 'SKILL.md'), 'utf8'), /disable-model-invocation/)
    // dsh 用户库存在同名时优先改用户库（与 registry rank 一致）
    await writeSkill(join(home, 'dsh-user-skills'), 'dual-skill', { name: 'dual-skill', description: 'in user lib' })
    await writeSkill(join(home, 'skills'), 'dual-skill', { name: 'dual-skill', description: 'in agents root' })
    const dual = await call('PUT', '/skills-management/api/invocation', { name: 'dual-skill', modelInvocable: false })
    assert.equal(dual.payload.root, 'dsh')
    assert.match(await readFile(join(home, 'dsh-user-skills', 'dual-skill', 'SKILL.md'), 'utf8'), /disable-model-invocation/)
    assert.doesNotMatch(await readFile(join(home, 'skills', 'dual-skill', 'SKILL.md'), 'utf8'), /disable-model-invocation/)
  } finally {
    if (prevAgents === undefined) delete process.env.DSH_AGENTS_HOME
    else process.env.DSH_AGENTS_HOME = prevAgents
    await rm(home, { recursive: true, force: true })
  }
})

// ── 注入开销估算（≈token / 字符）─────────────────────────────────────────

test('usageStat golden values on the cl100k_base ranks (tiktokenizer 同词表同值)', () => {
  const { usageStat } = plugin.__internals
  // golden 值已与 tiktokenizer（cl100k_base）人工核对
  assert.deepEqual(usageStat('hello', 'hello world'), { tokens: 4, chars: 17 })
  assert.deepEqual(usageStat('自动续跑', '会话结束后自动继续执行，直到任务完成或达到上限'), { tokens: 28, chars: 28 })
  assert.deepEqual(usageStat('x', ''), { tokens: 2, chars: 2 })
  // 非字符串 description 容错
  assert.deepEqual(usageStat('x', undefined), { tokens: 2, chars: 2 })
})

test('usageStat memoizes per text so rescans skip re-encoding', () => {
  const { usageStat, usageMemo } = plugin.__internals
  const text = 'memo-probe\na repeated description for the memo probe'
  usageMemo.delete(text)
  const before = usageMemo.size
  const first = usageStat('memo-probe', 'a repeated description for the memo probe')
  assert.equal(usageMemo.size, before + 1)
  const again = usageStat('memo-probe', 'a repeated description for the memo probe')
  assert.equal(usageMemo.size, before + 1)
  assert.equal(again.tokens, first.tokens)
})

test('usageStat degrades to chars-only when the ranks are unavailable', () => {
  const { usageStat, setUsageEncoderOverride } = plugin.__internals
  setUsageEncoderOverride(null)
  try {
    const stat = usageStat('fallback', 'no encoder here')
    assert.equal(stat.tokens, undefined)
    assert.equal(stat.chars, 'fallback\nno encoder here'.length)
  } finally {
    setUsageEncoderOverride(undefined)
  }
})

test('list and detail endpoints carry tokens/chars on rows', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skills-usage-'))
  try {
    await writeSkill(join(root, 'market'), 'src/alpha', { name: 'alpha', description: 'Hello from market skill' })
    await writeSkill(join(root, 'installed'), 'beta', { name: 'beta', description: 'Installed skill here' })

    const env = setupPlugin({
      marketDirs: [join(root, 'market')],
      installedDir: join(root, 'installed'),
    })

    const list = await env.call('GET', '/skills-management/api')
    assert.equal(list.status, 200)
    const mk = list.payload.market.find((s) => s.shortName === 'alpha')
    assert.equal(typeof mk.tokens, 'number')
    assert.ok(mk.tokens > 0)
    assert.equal(mk.chars, 'alpha\nHello from market skill'.length) // 按截断前全文统计
    const inst = list.payload.installed.find((s) => s.name === 'beta')
    assert.equal(typeof inst.tokens, 'number')
    assert.equal(inst.chars, 'beta\nInstalled skill here'.length)

    const detail = await env.call('GET', '/skills-management/api/detail?name=beta')
    assert.equal(typeof detail.payload.tokens, 'number')
    assert.equal(detail.payload.chars, 'beta\nInstalled skill here'.length)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('executor drill-in rows carry tokens/chars too', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skills-usage-ex-'))
  try {
    await writeSkill(join(root, 'cc'), 'foo', { name: 'foo', description: 'Executor skill desc' })
    const env = setupPlugin({
      marketDirs: [join(root, 'market')],
      installedDir: join(root, 'installed'),
      executorDirs: { claudecode: join(root, 'cc') },
    })
    const scoped = await env.call('GET', '/skills-management/api/executors?executor=claudecode')
    assert.equal(scoped.status, 200)
    const foo = scoped.payload.executor.skills.find((s) => s.name === 'foo')
    assert.equal(typeof foo.tokens, 'number')
    assert.equal(foo.chars, 'foo\nExecutor skill desc'.length)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
