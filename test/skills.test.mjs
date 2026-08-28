import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const plugin = require('../src/index.js')
const { extractFrontmatter, parseSkillMd, invocationPolicy, installDirName, isReadOnlySource, EXECUTOR_DEFS } = plugin.__internals

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
  assert.deepEqual(plugin.inject, ['skills', 'webServer'])
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
    assert.equal(marketOne.invocation.modelInvocable, true)
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

test('executor catalog covers known agents and marks read-only sources', () => {
  const keys = EXECUTOR_DEFS.map((d) => d.key)
  for (const expected of ['dsh', 'claudecode', 'zcode', 'codex', 'agents']) assert.ok(keys.includes(expected), `missing ${expected}`)
  assert.ok(isReadOnlySource('agents'))
  for (const def of EXECUTOR_DEFS.filter((d) => d.key !== 'agents')) assert.equal(def.readOnly === true, false, `${def.key} must not be read-only`)
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
    assert.equal(ag.readOnly, true)
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
    await writeSkill(join(root, 'ag'), 'protected', { name: 'protected', description: 'x' })
    await writeSkill(join(root, 'installed'), 'local', { name: 'local', description: 'x' })

    const env = setupPlugin({
      marketDirs: [join(root, 'market')],
      installedDir: join(root, 'installed'),
      executorDirs: { claudecode: join(root, 'cc'), agents: join(root, 'ag') },
    })

    const refused = await env.call('DELETE', '/skills-management/api', { name: 'protected', executor: 'agents' })
    assert.equal(refused.status, 400)
    assert.match(refused.payload.error, /read-only/)
    await assert.doesNotReject(stat(join(root, 'ag', 'protected')))

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
      inject: (deps, fn) => { registrations.push(deps); fn({ settings: {
        register: (ns, schema, opts) => {
          store[ns] = { ...opts.base }
          return {
            get: () => store[ns],
            update: async (patch) => { updates.push(patch); Object.assign(store[ns], patch) },
          }
        },
      } }) },
    }
    plugin.apply(ctx, {
      marketRepoDir: join(root, 'checkout'),
      marketSync: { url: 'https://example.com/x.git', syncOnStartup: false, autoSync: false },
    })
    assert.deepEqual(registrations, [['settings'], ['agents', 'agentDefaultModel', 'sessions']], 'dynamically injects settings + agent services')

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
