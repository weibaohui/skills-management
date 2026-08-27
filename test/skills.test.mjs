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
  plugin.apply(ctx, config)
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
      process.nextTick(() => { req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end') })
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
