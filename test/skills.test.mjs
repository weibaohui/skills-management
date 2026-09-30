import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, stat, lstat, readFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const plugin = require('../src/index.js')
const { extractFrontmatter, parseSkillMd, invocationPolicy, installDirName, EXECUTOR_DEFS, discoverSkillHomes, deriveAutoExecutors, keyFromDotDir } = plugin.__internals

// ── HTTP handler harness ────────────────────────────────────────────────

function setupPlugin(config, rejection) {
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
    // 信任栅栏：默认放行（undefined）；用例传入 401/403 即可验证拒绝路径
    connection: { requestRejection: () => rejection },
    effect: (fn) => fn(),
    logger: { warn: () => {} },
  }
  plugin.apply(ctx, {
    marketRepoDir: join(tmpdir(), 'dsh-skills-market-test-' + Math.random().toString(36).slice(2)),
    marketSync: { syncOnStartup: false, autoSync: false },
    // 封闭性：默认关掉 ~/.xxx/skills 自动发现，避免真实家目录影响断言；
    // 自动发现用例显式传 executorHomeDir + autoDiscoverExecutors: true。
    autoDiscoverExecutors: false,
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
  // + connection（HTTP 路由的信任栅栏）
  assert.deepEqual(plugin.inject, ['skills', 'webServer', 'settings', 'agents', 'agentDefaultModel', 'sessions', 'connection'])
})

test('every route sits behind the connection trust fence', async () => {
  const env = setupPlugin({}, 401)
  const listing = await env.call('GET', '/skills-management/api')
  assert.equal(listing.status, 401, 'an unauthenticated listing is refused before any market scan')
  const settings = await env.call('GET', '/skills-management/api/executor-settings')
  assert.equal(settings.status, 401, 'an unauthenticated settings read is refused')
  const run = await env.call('POST', '/skills-management/api/share/run', { prompt: 'x', dir: '/' })
  assert.equal(run.status, 401, 'share/run never reaches the agent executor unauthenticated')
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
    plugin.apply(ctx, { marketDirs: [join(root, 'market')], installedDir: join(root, 'installed'), marketSync: { publishMarket: true } })
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

    // 默认 publishMarket: false —— 市场货架不进宿主 `/` 注册表
    let registeredQuiet
    plugin.apply({
      skills: { registerProvider: (create) => { registeredQuiet = create({ signal: new AbortController().signal, invalidate: () => {} }) } },
      webServer: { register: () => () => {} },
      effect: (fn) => (typeof fn === 'function' ? fn() : undefined),
      logger: { warn: () => {} },
    }, { marketDirs: [join(root, 'market')], installedDir: join(root, 'installed') })
    const quiet = await registeredQuiet.list()
    assert.deepEqual(quiet.map((c) => c.name), ['doc-coauthoring'])
    assert.equal(quiet.every((c) => c.source === 'user-installed'), true)

    // config 逃生舱：marketModelInvocable: true 恢复旧行为
    let registered2
    plugin.apply({
      skills: { registerProvider: (create) => { registered2 = create({ signal: new AbortController().signal, invalidate: () => {} }) } },
      webServer: { register: () => () => {} },
      effect: (fn) => (typeof fn === 'function' ? fn() : undefined),
      logger: { warn: () => {} },
    }, { marketDirs: [join(root, 'market')], installedDir: join(root, 'installed'), marketModelInvocable: true, marketSync: { publishMarket: true } })
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
    plugin.apply(ctx, { marketDirs: [join(root, 'market')], installedDir: join(root, 'installed'), marketSync: { publishMarket: true } })
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
    plugin.apply(ctx, { marketDirs: [join(root, 'market')], installedDir: join(root, 'installed'), marketSync: { publishMarket: true } })
    const candidates = await registered.list()
    assert.equal(candidates.length, 1)
    assert.equal(candidates[0].name, 'demo')
    assert.ok((await stat(candidates[0].path)).isFile())
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// ── Executor sources (on-machine skills dirs, ntd source-table style) ──

test('executor catalog: 内置表只留约定覆盖不到的来源，key 全由目录名派生', () => {
  // 符合 ~/.xxx/skills 规则的条目已从内置清单删除：EXECUTOR_DEFS 只剩 dsh 与约定外路径
  assert.deepEqual(EXECUTOR_DEFS.map((d) => d.key), ['dsh', 'mimo', 'zhanlu'])
  assert.equal(EXECUTOR_DEFS[1].sub, '.local/share/mimocode/skills')
  assert.equal(EXECUTOR_DEFS[2].sub, '.local/share/zhanlu/skills')
  // 无名称表：key/显示名由目录名机械派生
  assert.equal(keyFromDotDir('.claude'), 'claude')
  assert.equal(keyFromDotDir('.mobile-coder'), 'mobile-coder')
  assert.equal(keyFromDotDir('.agents'), 'agents')
  // agents 根自治理键开关覆盖起不再只读（与用户库同权）；只读只来自 extraExecutors 的显式标记
  for (const def of EXECUTOR_DEFS) assert.equal(def.readOnly === true, false, `${def.key} must not be read-only`)
})

test('GET /executors groups skills per on-machine source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skills-ex-'))
  try {
    // 约定家目录 fixture：.claude/.agents/.zcode 由自动发现收录（key 由目录名派生）
    const home = join(root, 'home')
    await writeSkill(join(home, '.claude', 'skills'), 'grouped/foo', { name: 'foo', description: 'Hello from claude', version: '"1.0"' })
    await writeFile(join(home, '.claude', 'skills', 'grouped', 'foo', 'notes.md'), 'extra file')
    await writeSkill(join(home, '.agents', 'skills'), 'bar', { name: 'bar', description: 'From agents' })
    await writeSkill(join(home, '.zcode', 'skills'), 'zed', { name: 'zed', description: 'disabled source' })
    await writeSkill(join(root, 'installed'), 'mine', { name: 'mine', description: 'dsh local' })

    const env = setupPlugin({
      marketDirs: [join(root, 'market')],
      installedDir: join(root, 'installed'),
      executorHomeDir: home,
      autoDiscoverExecutors: true,
      disabledExecutors: ['zcode'],
    })
    const res = await env.call('GET', '/skills-management/api/executors')
    assert.equal(res.status, 200)
    const rows = res.payload.executors
    assert.equal(rows[0].key, 'dsh') // dsh row is first, rooted at installedDir
    assert.ok(!rows.some((r) => r.key === 'zcode')) // disabledExecutors honored（自动行同样适用）

    const cc = rows.find((r) => r.key === 'claude')
    assert.equal(cc.label, 'Claude') // 无名称表：显示名按目录名派生
    assert.equal(cc.source, 'auto')
    assert.equal(cc.dirExists, true)
    assert.equal(cc.readOnly, false)
    assert.deepEqual(cc.skills.map((s) => s.name), ['grouped/foo']) // nested, frontmatter name == basename → relPath
    assert.equal(cc.skills[0].fileCount, 2)
    assert.equal(cc.skills[0].version, '1.0')

    const ag = rows.find((r) => r.key === 'agents')
    assert.equal(ag.readOnly, false) // agents 根自治理开关覆盖起可写
    assert.deepEqual(ag.skills.map((s) => s.name), ['bar'])

    // 目录不存在的工具没有行：纯发现驱动，不再凭空占位
    assert.ok(!rows.some((r) => r.key === 'codex'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('symlinked skill dirs are flagged with link target and owning source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skills-link-'))
  try {
    // 真实场景复刻（~/.claude/skills 过半条目链进 ~/.agents/skills 共享池）：
    // .claude 下一个链接技能 + 一个实体技能，链接目标落在 agents 根内
    const home = join(root, 'home')
    await writeSkill(join(home, '.agents', 'skills'), 'pool-skill', { name: 'pool-skill', description: 'living in the agents pool' })
    await mkdir(join(home, '.claude', 'skills'), { recursive: true })
    await symlink(join(home, '.agents', 'skills', 'pool-skill'), join(home, '.claude', 'skills', 'pool-skill'), 'dir')
    await writeSkill(join(home, '.claude', 'skills'), 'real-one', { name: 'real-one', description: 'a real dir' })

    const env = setupPlugin({
      marketDirs: [join(root, 'market')],
      installedDir: join(root, 'installed'),
      executorHomeDir: home,
      autoDiscoverExecutors: true,
    })
    const res = await env.call('GET', '/skills-management/api/executors?executor=claude')
    assert.equal(res.status, 200)
    const skills = res.payload.executor.skills
    const linked = skills.find((s) => s.name === 'pool-skill')
    assert.equal(linked.isLink, true)
    assert.ok(linked.linkTarget.endsWith(join('.agents', 'skills', 'pool-skill')), `linkTarget should name the pool dir, got ${linked.linkTarget}`)
    assert.equal(linked.linkExecutor, 'Agents') // realpath 前缀命中最长根 → 来源 label（派生）
    const real = skills.find((s) => s.name === 'real-one')
    assert.equal(real.isLink, undefined) // 非链接行不带这些键

    // 链接不影响内容读取（stat 跟随）
    assert.equal(linked.description, 'living in the agents pool')

    // 详情接口带同样的链接字段
    const detail = await env.call('GET', '/skills-management/api/detail?name=pool-skill&executor=claude')
    assert.equal(detail.status, 200)
    assert.equal(detail.payload.isLink, true)
    assert.equal(detail.payload.linkExecutor, 'Agents')
    assert.ok(detail.payload.linkTarget.endsWith(join('.agents', 'skills', 'pool-skill')))

    // agents 根里的实体同名技能不是链接
    const agRes = await env.call('GET', '/skills-management/api/executors?executor=agents')
    assert.equal(agRes.payload.executor.skills[0].isLink, undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('executors endpoint variants: summary mode and single-source drill-in', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skills-var-'))
  try {
    const home = join(root, 'home')
    await writeSkill(join(home, '.claude', 'skills'), 'foo', { name: 'foo', description: 'one' })
    await writeSkill(join(home, '.claude', 'skills'), 'nested/bar', { name: 'bar', description: 'two' })
    await writeSkill(join(root, 'installed'), 'mine', { name: 'mine', description: 'dsh' })

    const env = setupPlugin({
      marketDirs: [join(root, 'market')],
      installedDir: join(root, 'installed'),
      executorHomeDir: home,
      autoDiscoverExecutors: true,
    })

    // summary mode: counts without per-skill arrays (lazy UI loading)
    const summary = await env.call('GET', '/skills-management/api/executors?mode=summary')
    assert.equal(summary.status, 200)
    const ccSummary = summary.payload.executors.find((r) => r.key === 'claude')
    assert.equal(ccSummary.skillCount, 2)
    assert.equal(ccSummary.skills, undefined)

    // scoped mode: one source's full list
    const scoped = await env.call('GET', '/skills-management/api/executors?executor=claude')
    assert.equal(scoped.status, 200)
    assert.equal(scoped.payload.executor.key, 'claude')
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

test('executor-settings sheet: GET lists all sources with flags, PUT applies runtime changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skills-sheet-'))
  try {
    // 约定 fixture：停用/覆盖目标都必须是已发现的自动行（无目录即无行）
    const home = join(root, 'home')
    await writeSkill(join(home, '.zcode', 'skills'), 'z1', { name: 'z1', description: 'zcode fixture' })
    await writeSkill(join(home, '.claude', 'skills'), 'c1', { name: 'c1', description: 'claude fixture' })
    await writeSkill(join(home, '.kilo', 'skills'), 'k1', { name: 'k1', description: 'kilo fixture' })
    await writeSkill(join(home, '.pi', 'skills'), 'p1', { name: 'p1', description: 'pi fixture' })
    await writeSkill(join(home, '.codex', 'skills'), 'c2', { name: 'c2', description: 'codex fixture' })
    await writeSkill(join(root, 'cx'), 'zeds', { name: 'zeds', description: 'From runtime-overridden codex' })
    await writeSkill(join(root, 'mc'), 'local-shot', { name: 'local-shot', description: 'From custom executor' })
    await writeSkill(join(root, 'installed'), 'mine', { name: 'mine', description: 'dsh local' })

    const env = setupPlugin({
      marketDirs: [join(root, 'market')],
      installedDir: join(root, 'installed'),
      executorHomeDir: home,
      autoDiscoverExecutors: true,
      disabledExecutors: ['zcode'], // cordis 停用：管理面板仍要列出（UI 置灰）
    })

    // GET：内置 + 自动发现行，带每行可编辑性标记
    const sheet = await env.call('GET', '/skills-management/api/executor-settings')
    assert.equal(sheet.status, 200)
    const rows = sheet.payload.executors
    assert.equal(rows[0].key, 'dsh')
    assert.equal(rows[0].locked, true)
    const zc = rows.find((r) => r.key === 'zcode')
    assert.equal(zc.source, 'auto')
    assert.equal(zc.disabled, true)
    assert.equal(zc.managedByConfig, false)
    assert.ok(zc.dir.endsWith(join('.zcode', 'skills')), `zcode dir is the convention path, got ${zc.dir}`)
    const cc = rows.find((r) => r.key === 'claude')
    assert.ok(cc.dir.endsWith(join('.claude', 'skills')))
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
      [{ dirs: {}, disabled: [], extra: [{ key: 'mimo', label: 'x', dir: '/tmp/y' }] }, /already exists/],
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
    const home = join(root, 'home')
    await writeSkill(join(home, '.claude', 'skills'), 'convention-one', { name: 'convention-one', description: 'convention dir' })
    await writeSkill(join(root, 'cc'), 'cordis-one', { name: 'cordis-one', description: 'cordis root' })
    await writeSkill(join(root, 'runtime'), 'runtime-one', { name: 'runtime-one', description: 'runtime root' })
    const env = setupPlugin({
      marketDirs: [join(root, 'market')],
      installedDir: join(root, 'installed'),
      executorHomeDir: home,
      autoDiscoverExecutors: true,
      executorDirs: { claude: join(root, 'cc') }, // cordis 静态配置（key = 派生 key）
    })
    // runtime 想覆盖同一 key：被 cordis 压制
    await env.call('PUT', '/skills-management/api/executor-settings', {
      dirs: { claude: join(root, 'runtime') },
      disabled: [],
      extra: [{ key: 'temp', label: 'Temp', dir: join(root, 'runtime') }],
    })
    let scan = await env.call('GET', '/skills-management/api/executors?executor=claude')
    assert.deepEqual(scan.payload.executor.skills.map((s) => s.name), ['cordis-one'])
    let sheet = await env.call('GET', '/skills-management/api/executor-settings')
    assert.equal(sheet.payload.executors.find((r) => r.key === 'claude').managedByConfig, true)
    assert.equal(sheet.payload.executors.some((r) => r.key === 'temp'), true)

    // 恢复默认：整表清空 → runtime 自定义消失，cordis 根不受影响
    const restore = await env.call('PUT', '/skills-management/api/executor-settings', { dirs: {}, disabled: [], extra: [] })
    assert.equal(restore.status, 200)
    assert.ok(!restore.payload.executors.some((r) => r.key === 'temp'))
    sheet = await env.call('GET', '/skills-management/api/executor-settings')
    assert.ok(!sheet.payload.executors.some((r) => r.key === 'temp'))
    scan = await env.call('GET', '/skills-management/api/executors?executor=claude')
    assert.deepEqual(scan.payload.executor.skills.map((s) => s.name), ['cordis-one'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// ── 约定式自动发现（~/.xxx/skills；Windows: %USERPROFILE%\.xxx\skills）──

test('discoverSkillHomes finds only dotted dirs with a skills child', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-skills-home-'))
  try {
    await writeSkill(join(home, '.foo', 'skills'), 'a', { name: 'a', description: 'x' })
    await mkdir(join(home, '.bar')) // 无 skills 子目录 → 不算
    await writeSkill(join(home, 'plain', 'skills'), 'b', { name: 'b', description: 'x' }) // 非点目录 → 不算
    await writeSkill(join(home, '.git', 'skills'), 'c', { name: 'c', description: 'x' }) // dotfiles 仓库排除
    await writeFile(join(home, '.file'), 'not a dir') // 点文件 → 不算
    const found = await discoverSkillHomes(home)
    assert.deepEqual(found.map((f) => f.name), ['.foo'])
    assert.equal(found[0].dir, join(home, '.foo', 'skills'))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('discoverSkillHomes follows symlinked dot dirs and skills dirs', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-skills-homelink-'))
  const elsewhere = await mkdtemp(join(tmpdir(), 'dsh-skills-else-'))
  try {
    // 点目录本身是软链（Windows junction 在 Dirent 上同样报 isSymbolicLink）
    await writeSkill(join(elsewhere, 'real', 'skills'), 'a', { name: 'a', description: 'x' })
    await symlink(join(elsewhere, 'real'), join(home, '.linked'), 'dir')
    // skills 子目录是软链（共享池布局）
    await writeSkill(join(elsewhere, 'pool'), 'b', { name: 'b', description: 'x' })
    await mkdir(join(home, '.linkskills'), { recursive: true })
    await symlink(join(elsewhere, 'pool'), join(home, '.linkskills', 'skills'), 'dir')
    const found = await discoverSkillHomes(home)
    assert.deepEqual(found.map((f) => f.name), ['.linked', '.linkskills'])
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(elsewhere, { recursive: true, force: true })
  }
})

test('deriveAutoExecutors dedups taken paths and suffixes key collisions', () => {
  const discovered = [
    { name: '.claude', dir: '/home/u/.claude/skills' }, // 路径已被占用 → 跳过
    { name: '.my-tool', dir: '/home/u/.my-tool/skills' },
    { name: '.my_tool', dir: '/home/u/.my_tool/skills' }, // 派生 key 撞车 → -2
    { name: '.日本語', dir: '/home/u/.日本語/skills' }, // 派生不出 kebab key → 跳过
  ]
  const rows = deriveAutoExecutors(discovered, ['/home/u/.claude/skills'], ['dsh', 'mimo'])
  assert.deepEqual(rows.map((r) => r.key), ['my-tool', 'my-tool-2'])
  assert.equal(rows[0].label, 'My Tool')
  assert.equal(rows[0].source, 'auto')
  assert.equal(rows[1].label, 'My Tool') // label 按目录原名派生，不带 key 后缀
})

test('auto-discovery adds convention dirs as executor sources (default on)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skills-auto-'))
  try {
    const home = join(root, 'home')
    await writeSkill(join(home, '.foo', 'skills'), 'bar', { name: 'bar', description: 'auto found' })
    await writeSkill(join(home, '.claude', 'skills'), 'ccskill', { name: 'ccskill', description: 'plain auto row now' })
    await mkdir(join(home, '.empty'), { recursive: true })

    // autoDiscoverExecutors 默认即为 true；setupPlugin 基座为封闭性关掉，这里显式打开
    const env = setupPlugin({
      marketDirs: [join(root, 'market')],
      installedDir: join(root, 'installed'),
      executorHomeDir: home,
      autoDiscoverExecutors: true,
    })
    const res = await env.call('GET', '/skills-management/api/executors')
    assert.equal(res.status, 200)
    const rows = res.payload.executors
    const foo = rows.find((r) => r.key === 'foo')
    assert.equal(foo.source, 'auto')
    assert.equal(foo.label, 'Foo')
    assert.equal(foo.dirExists, true)
    assert.deepEqual(foo.skills.map((s) => s.name), ['bar'])
    // .claude/skills 也是普通自动行：key/label 由目录名派生，不再有内置行
    const cc = rows.find((r) => r.key === 'claude')
    assert.equal(cc.source, 'auto')
    assert.equal(cc.label, 'Claude')
    assert.equal(cc.dirExists, true)
    assert.deepEqual(cc.skills.map((s) => s.name), ['ccskill'])
    assert.ok(!rows.some((r) => r.key === 'claudecode'))
    assert.ok(!rows.some((r) => r.key === 'empty'))
    // 目录不存在的工具没有行：纯发现驱动，不再凭空占位
    assert.ok(!rows.some((r) => r.key === 'codex'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('custom executor dir claims a discovered path (no duplicate auto row)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skills-claim-'))
  try {
    const home = join(root, 'home')
    await writeSkill(join(home, '.mine', 'skills'), 'x', { name: 'x', description: 'claimed by custom' })
    const env = setupPlugin({
      marketDirs: [join(root, 'market')],
      installedDir: join(root, 'installed'),
      executorHomeDir: home,
      autoDiscoverExecutors: true,
      extraExecutors: [{ key: 'mine', label: 'Mine', dir: join(home, '.mine', 'skills') }],
    })
    const res = await env.call('GET', '/skills-management/api/executors')
    const matches = res.payload.executors.filter((r) => r.dir.endsWith(join('.mine', 'skills')))
    assert.equal(matches.length, 1)
    assert.equal(matches[0].key, 'mine')
    assert.equal(matches[0].source, 'custom')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('auto executor rows: disable via sheet; dir override accepted; key collision rejected; grandfathered disable survives deletion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skills-autosheet-'))
  try {
    const home = join(root, 'home')
    await writeSkill(join(home, '.foo', 'skills'), 'bar', { name: 'bar', description: 'auto found' })
    const env = setupPlugin({
      marketDirs: [join(root, 'market')],
      installedDir: join(root, 'installed'),
      executorHomeDir: home,
      autoDiscoverExecutors: true,
    })

    // 管理面板投影：auto 行带标记、可停用
    const sheet = await env.call('GET', '/skills-management/api/executor-settings')
    const autoRow = sheet.payload.executors.find((r) => r.key === 'foo')
    assert.equal(autoRow.source, 'auto')
    assert.equal(autoRow.disabled, false)
    assert.equal(autoRow.managedByConfig, false)

    // 停用自动行 → 扫描即刻消失
    const put = await env.call('PUT', '/skills-management/api/executor-settings', { dirs: {}, disabled: ['foo'], extra: [] })
    assert.equal(put.status, 200)
    assert.equal(put.payload.executors.find((r) => r.key === 'foo').disabled, true)
    const scan = await env.call('GET', '/skills-management/api/executors')
    assert.ok(!scan.payload.executors.some((r) => r.key === 'foo'))

    // 自动行同样接受目录覆盖（内置表精简后，这是给约定来源改目录的常规通道）
    await writeSkill(join(root, 'x'), 'moved', { name: 'moved', description: 'override target' })
    const override = await env.call('PUT', '/skills-management/api/executor-settings', { dirs: { foo: join(root, 'x') }, disabled: [], extra: [] })
    assert.equal(override.status, 200)
    assert.equal(override.payload.executors.find((r) => r.key === 'foo').overridden, true)
    const moved = await env.call('GET', '/skills-management/api/executors?executor=foo')
    assert.deepEqual(moved.payload.executor.skills.map((s) => s.name), ['moved'])

    // 自定义执行器 key 撞自动行 → 拒绝
    const dup = await env.call('PUT', '/skills-management/api/executor-settings', { dirs: {}, disabled: [], extra: [{ key: 'foo', label: 'x', dir: join(root, 'y') }] })
    assert.equal(dup.status, 400)
    assert.match(dup.payload.error, /already exists/)

    // 从未出现过的 key 仍然拒停（防笔误）
    const ghost = await env.call('PUT', '/skills-management/api/executor-settings', { dirs: {}, disabled: ['ghost'], extra: [] })
    assert.equal(ghost.status, 400)
    assert.match(ghost.payload.error, /unknown executor/)

    // 重新停用 foo（sheet 落一份停用记录），然后删掉目录：祖父条款保证
    // sheet 里已有的停用条目仍能整表保存（不丢用户选择）
    const reDisable = await env.call('PUT', '/skills-management/api/executor-settings', { dirs: {}, disabled: ['foo'], extra: [] })
    assert.equal(reDisable.status, 200)
    await rm(join(home, '.foo'), { recursive: true, force: true })
    const again = await env.call('PUT', '/skills-management/api/executor-settings', { dirs: {}, disabled: ['foo'], extra: [] })
    assert.equal(again.status, 200)
    assert.ok(!again.payload.executors.some((r) => r.key === 'foo')) // 目录已删，投影不再列出
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('detail and file APIs accept an executor scope', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skills-detail-'))
  try {
    const home = join(root, 'home')
    await writeSkill(join(home, '.claude', 'skills'), 'peer', { name: 'peer', description: 'In claude' })
    await writeFile(join(home, '.claude', 'skills', 'peer', 'notes.md'), 'note text')
    await writeSkill(join(root, 'installed'), 'peer', { name: 'peer', description: 'Same name in dsh lib' })

    const env = setupPlugin({
      marketDirs: [join(root, 'market')],
      installedDir: join(root, 'installed'),
      executorHomeDir: home,
      autoDiscoverExecutors: true,
    })
    // scoped: must see the claude copy even though dsh library shadows the name
    const scoped = await env.call('GET', '/skills-management/api/detail?name=peer&executor=claude')
    assert.equal(scoped.status, 200)
    assert.equal(scoped.payload.meta.description, 'In claude')
    assert.equal(scoped.payload.executor, 'claude')
    assert.equal(scoped.payload.isInstalled, false)

    // file fetch under the same scope
    const file = await env.callRaw('GET', '/skills-management/api/file?name=peer&executor=claude&path=notes.md')
    assert.equal(file.status, 200)
    assert.equal(file.body, 'note text')

    // traversal attempt inside the skill dir is rejected
    const escape = await env.call('GET', '/skills-management/api/file?name=..%2Fpeer&executor=claude&path=notes.md')
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
    const home = join(root, 'home')
    await writeSkill(join(home, '.claude', 'skills'), 'removable', { name: 'removable', description: 'x' })
    await writeSkill(join(root, 'locked'), 'protected', { name: 'protected', description: 'x' })
    await writeSkill(join(root, 'installed'), 'local', { name: 'local', description: 'x' })

    const env = setupPlugin({
      marketDirs: [join(root, 'market')],
      installedDir: join(root, 'installed'),
      executorHomeDir: home,
      autoDiscoverExecutors: true,
      // 只读语义仍保留给显式标记的 extra 来源（agents 根自治理开关覆盖起不再只读）
      extraExecutors: [{ key: 'locked', label: 'Locked', dir: join(root, 'locked'), readOnly: true }],
    })

    const refused = await env.call('DELETE', '/skills-management/api', { name: 'protected', executor: 'locked' })
    assert.equal(refused.status, 400)
    assert.match(refused.payload.error, /read-only/)
    await assert.doesNotReject(stat(join(root, 'locked', 'protected')))

    const removed = await env.call('DELETE', '/skills-management/api', { name: 'removable', executor: 'claude' })
    assert.equal(removed.status, 200)
    await assert.rejects(stat(join(home, '.claude', 'skills', 'removable')))
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
    const wb = join(root, 'home', '.workbuddy', 'skills') // 约定目录，key 派生即 workbuddy
    await mkdir(join(wb, 'dev-expert__skillhub'), { recursive: true })
    await writeFile(join(wb, 'dev-expert__skillhub', 'SKILL.md'),
      '---\nname: dev-expert\ndescription: expert skill\nversion: "1.0"\n---\nbody')
    await writeFile(join(wb, 'dev-expert__skillhub', 'notes.md'), 'note text')
    // a matched skill alongside (dir == name) must still resolve via the direct path
    await writeSkill(wb, 'plain-tool', { name: 'plain-tool', description: 'matched' })

    const env = setupPlugin({
      marketDirs: [join(root, 'market')],
      installedDir: join(root, 'installed'),
      executorHomeDir: join(root, 'home'),
      autoDiscoverExecutors: true,
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
    await assert.rejects(stat(join(wb, 'dev-expert__skillhub')))

    // matched skill still deletes by direct path
    const delPlain = await call('DELETE', '/skills-management/api', { name: 'plain-tool', executor: 'workbuddy' })
    assert.equal(delPlain.status, 200)
    await assert.rejects(stat(join(wb, 'plain-tool')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('POST /install with `from` copies an executor skill into the dsh library', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skills-copy-'))
  try {
    const home = join(root, 'home')
    await writeSkill(join(home, '.claude', 'skills'), 'handy', { name: 'handy', description: 'Useful elsewhere', version: '"2.1"' })
    await writeFile(join(home, '.claude', 'skills', 'handy', 'helper.py'), '#!/usr/bin/env python3')
    await mkdir(join(home, '.kilo', 'skills'), { recursive: true }) // 空来源：存在但无目标技能

    const env = setupPlugin({
      marketDirs: [join(root, 'market')],
      installedDir: join(root, 'installed'),
      executorHomeDir: home,
      autoDiscoverExecutors: true,
    })

    const res = await env.call('POST', '/skills-management/api/install', { name: 'handy', from: 'claude' })
    assert.equal(res.status, 201)
    assert.equal(res.payload.installed.from, 'claude')

    const copied = join(root, 'installed', 'handy')
    await stat(join(copied, 'SKILL.md'))
    await stat(join(copied, 'helper.py'))
    const names = (await env.registered.list()).map((c) => c.name)
    assert.ok(names.includes('handy'))

    const dup = await env.call('POST', '/skills-management/api/install', { name: 'handy', from: 'claude' })
    assert.equal(dup.status, 400)
    assert.match(dup.payload.error, /already installed/)

    const over = await env.call('POST', '/skills-management/api/install', { name: 'handy', from: 'claude', overwrite: true })
    assert.equal(over.status, 201)

    const badSource = await env.call('POST', '/skills-management/api/install', { name: 'gone', from: 'kilo' })
    assert.equal(badSource.status, 400)
    assert.match(badSource.payload.error, /not found in Kilo/)

    const invalidName = await env.call('POST', '/skills-management/api/install', { name: '../escape', from: 'claude' })
    assert.equal(invalidName.status, 400)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// ── 回收站（删除暂存）──

test('DELETE moves the skill into the trash; restore puts it back at the original dir', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skills-trash-'))
  try {
    const home = join(root, 'home')
    await writeSkill(join(home, '.claude', 'skills'), 'gone-soon', { name: 'gone-soon', description: 'will be trashed' })
    const env = setupPlugin({
      marketDirs: [join(root, 'market')],
      installedDir: join(root, 'installed'),
      executorHomeDir: home,
      autoDiscoverExecutors: true,
      trashDir: join(root, 'trash'),
    })

    const del = await env.call('DELETE', '/skills-management/api', { name: 'gone-soon', executor: 'claude' })
    assert.equal(del.status, 200)
    assert.equal(del.payload.removed, 'gone-soon')
    assert.equal(typeof del.payload.trashId, 'string')
    await assert.rejects(stat(join(home, '.claude', 'skills', 'gone-soon')))

    // 回收站列表：元数据完整、可恢复
    const list = await env.call('GET', '/skills-management/api/trash')
    assert.equal(list.status, 200)
    assert.equal(list.payload.enabled, true)
    assert.equal(list.payload.entries.length, 1)
    const entry = list.payload.entries[0]
    assert.equal(entry.id, del.payload.trashId)
    assert.equal(entry.name, 'gone-soon')
    assert.equal(entry.executorKey, 'claude')
    assert.ok(entry.originalDir.endsWith(join('.claude', 'skills', 'gone-soon')))
    assert.equal(entry.restorable, true)
    assert.equal(entry.description, 'will be trashed')
    assert.ok(entry.deletedAt)
    assert.ok(entry.fileCount >= 1)
    // 回收站目录本身不会被当成来源/技能扫回来
    const scan = await env.call('GET', '/skills-management/api/executors?executor=claude')
    assert.deepEqual(scan.payload.executor.skills, [])
    assert.equal(list.payload.retentionDays, 30)

    // 恢复到原始目录，回收站清空
    const restore = await env.call('POST', '/skills-management/api/trash/restore', { id: entry.id })
    assert.equal(restore.status, 200)
    assert.equal(restore.payload.restored.executorKey, 'claude')
    await stat(join(home, '.claude', 'skills', 'gone-soon', 'SKILL.md'))
    const after = await env.call('GET', '/skills-management/api/trash')
    assert.equal(after.payload.entries.length, 0)
    const scan2 = await env.call('GET', '/skills-management/api/executors?executor=claude')
    assert.deepEqual(scan2.payload.executor.skills.map((s) => s.name), ['gone-soon'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('restore refuses when the original location is reoccupied; permanent delete then works', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skills-trashconf-'))
  try {
    const home = join(root, 'home')
    await writeSkill(join(home, '.claude', 'skills'), 'clash', { name: 'clash', description: 'v1' })
    const env = setupPlugin({
      marketDirs: [join(root, 'market')],
      installedDir: join(root, 'installed'),
      executorHomeDir: home,
      autoDiscoverExecutors: true,
      trashDir: join(root, 'trash'),
    })
    const del = await env.call('DELETE', '/skills-management/api', { name: 'clash', executor: 'claude' })
    const trashId = del.payload.trashId

    // 原位置被新技能占用 → 恢复拒绝，回收项保留
    await writeSkill(join(home, '.claude', 'skills'), 'clash', { name: 'clash', description: 'v2' })
    const restore = await env.call('POST', '/skills-management/api/trash/restore', { id: trashId })
    assert.equal(restore.status, 400)
    assert.match(restore.payload.error, /already exists/)
    assert.equal((await env.call('GET', '/skills-management/api/trash')).payload.entries.length, 1)

    // 彻底删除回收项；新技能不受影响
    const gone = await env.call('DELETE', '/skills-management/api/trash', { id: trashId })
    assert.equal(gone.status, 200)
    assert.equal((await env.call('GET', '/skills-management/api/trash')).payload.entries.length, 0)
    assert.equal((await readFile(join(home, '.claude', 'skills', 'clash', 'SKILL.md'), 'utf8')).includes('v2'), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('trash: empty-all, invalid ids, and metadata-missing entries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skills-trashempty-'))
  try {
    const home = join(root, 'home')
    await writeSkill(join(home, '.claude', 'skills'), 'one', { name: 'one', description: 'x' })
    await writeSkill(join(home, '.claude', 'skills'), 'two', { name: 'two', description: 'x' })
    const env = setupPlugin({
      marketDirs: [join(root, 'market')],
      installedDir: join(root, 'installed'),
      executorHomeDir: home,
      autoDiscoverExecutors: true,
      trashDir: join(root, 'trash'),
    })
    await env.call('DELETE', '/skills-management/api', { name: 'one', executor: 'claude' })
    await env.call('DELETE', '/skills-management/api', { name: 'two', executor: 'claude' })
    assert.equal((await env.call('GET', '/skills-management/api/trash')).payload.entries.length, 2)

    // 遍历防护：id 含路径分隔符/.. 一律 400
    for (const bad of ['../x', 'a/b', '..']) {
      const res = await env.call('POST', '/skills-management/api/trash/restore', { id: bad })
      assert.equal(res.status, 400, `id ${bad} rejected`)
      assert.match(res.payload.error, /invalid trash id/)
    }

    // 清空
    const emptied = await env.call('DELETE', '/skills-management/api/trash', { all: true })
    assert.equal(emptied.status, 200)
    assert.equal((await env.call('GET', '/skills-management/api/trash')).payload.entries.length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('trash retention purges expired entries lazily on list; 0 keeps forever', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skills-trashpurge-'))
  try {
    const home = join(root, 'home')
    await writeSkill(join(home, '.claude', 'skills'), 'old', { name: 'old', description: 'x' })
    const trashDir = join(root, 'trash')
    const env = setupPlugin({
      marketDirs: [join(root, 'market')],
      installedDir: join(root, 'installed'),
      executorHomeDir: home,
      autoDiscoverExecutors: true,
      trashDir,
      trashRetentionDays: 30,
    })
    const del = await env.call('DELETE', '/skills-management/api', { name: 'old', executor: 'claude' })
    const trashId = del.payload.trashId
    assert.equal((await env.call('GET', '/skills-management/api/trash')).payload.entries.length, 1)

    // 把删除时间改到 40 天前 → 下次列表被惰性清理
    const metaFile = join(trashDir, trashId + '.json')
    const meta = JSON.parse(await readFile(metaFile, 'utf8'))
    meta.deletedAt = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString()
    await writeFile(metaFile, JSON.stringify(meta))
    const list = await env.call('GET', '/skills-management/api/trash')
    assert.equal(list.payload.entries.length, 0)
    await assert.rejects(stat(join(trashDir, trashId)))

    // retention 0 = 永久保留
    const env2 = setupPlugin({
      marketDirs: [join(root, 'market2')],
      installedDir: join(root, 'installed2'),
      executorHomeDir: home,
      autoDiscoverExecutors: true,
      trashDir: join(root, 'trash2'),
      trashRetentionDays: 0,
    })
    await writeSkill(join(home, '.claude', 'skills'), 'keep', { name: 'keep', description: 'x' })
    const del2 = await env2.call('DELETE', '/skills-management/api', { name: 'keep', executor: 'claude' })
    const meta2 = JSON.parse(await readFile(join(root, 'trash2', del2.payload.trashId + '.json'), 'utf8'))
    meta2.deletedAt = new Date(Date.now() - 400 * 24 * 3600 * 1000).toISOString()
    await writeFile(join(root, 'trash2', del2.payload.trashId + '.json'), JSON.stringify(meta2))
    const list2 = await env2.call('GET', '/skills-management/api/trash')
    assert.equal(list2.payload.entries.length, 1)
    assert.equal(list2.payload.retentionDays, null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('deleting a symlinked skill moves only the link into trash', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skills-trashlink-'))
  try {
    const home = join(root, 'home')
    await writeSkill(join(home, '.agents', 'skills'), 'pool-skill', { name: 'pool-skill', description: 'pooled' })
    await mkdir(join(home, '.claude', 'skills'), { recursive: true })
    await symlink(join(home, '.agents', 'skills', 'pool-skill'), join(home, '.claude', 'skills', 'pool-skill'), 'dir')
    const env = setupPlugin({
      marketDirs: [join(root, 'market')],
      installedDir: join(root, 'installed'),
      executorHomeDir: home,
      autoDiscoverExecutors: true,
      trashDir: join(root, 'trash'),
    })
    const del = await env.call('DELETE', '/skills-management/api', { name: 'pool-skill', executor: 'claude' })
    assert.equal(del.status, 200)
    // 链接进回收站（仍是链接），目标池原样保留
    const lst = await lstat(join(root, 'trash', del.payload.trashId))
    assert.equal(lst.isSymbolicLink(), true)
    await stat(join(home, '.agents', 'skills', 'pool-skill', 'SKILL.md'))
    // 恢复后 .claude 下重新是链接
    const restore = await env.call('POST', '/skills-management/api/trash/restore', { id: del.payload.trashId })
    assert.equal(restore.status, 200)
    const lst2 = await lstat(join(home, '.claude', 'skills', 'pool-skill'))
    assert.equal(lst2.isSymbolicLink(), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('config.trash === false restores permanent delete', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skills-notrash-'))
  try {
    const home = join(root, 'home')
    await writeSkill(join(home, '.claude', 'skills'), 'hard', { name: 'hard', description: 'x' })
    const env = setupPlugin({
      marketDirs: [join(root, 'market')],
      installedDir: join(root, 'installed'),
      executorHomeDir: home,
      autoDiscoverExecutors: true,
      trashDir: join(root, 'trash'),
      trash: false,
    })
    const del = await env.call('DELETE', '/skills-management/api', { name: 'hard', executor: 'claude' })
    assert.equal(del.status, 200)
    assert.equal(del.payload.trashId, undefined) // 永久删除不进回收站
    assert.equal((await env.call('GET', '/skills-management/api/trash')).payload.enabled, false)
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
    const updates = []
    const mutations = []
    const doc = {}  // settings 文档投影（describe 返回值，update/mutate 直接落在这里）
    const ctx = {
      skills: { registerProvider: (create) => { create({ signal: new AbortController().signal, invalidate: () => {} }) } },
      webServer: { register: (route) => { globalThis.__settingsRoute = route.handler } },
      connection: { requestRejection: () => undefined },
      effect: (fn) => fn(),
      on: (event, fn) => { if (event === 'settings/document-updated') doc.__emit = () => fn('skills-management'); return () => {} },
      logger: { warn: () => {} },
      settings: {
        describe: () => [{ ns: 'skills-management', value: { ...doc }, user: { ...doc } }],
        update: async (ns, patch) => {
          assert.equal(ns, 'skills-management')
          updates.push(patch)
          for (const [k, v] of Object.entries(patch)) doc[k] = (v !== null && typeof v === 'object') ? { ...(doc[k] || {}), ...v } : v
          doc.__emit && doc.__emit()
        },
        mutate: async (ns, ops) => {
          assert.equal(ns, 'skills-management')
          mutations.push(ops)
          for (const op of ops) {
            if (op.op === 'unset') { const [k] = op.path; delete doc[k] }
            else if (op.op === 'set') { const [k] = op.path; doc[k] = op.value }
          }
          doc.__emit && doc.__emit()
        },
      },
    }
    plugin.apply(ctx, {
      marketRepoDir: join(root, 'checkout'),
      marketSync: { url: 'https://example.com/x.git', syncOnStartup: false, autoSync: false },
    })
    await new Promise((r) => setTimeout(r, 10)) // refreshLive 重试直到 describe 就绪

    const call = (method, url, body) => new Promise((fulfil) => {
      const chunks = []
      const res = { writeHead() {}, end: (c) => fulfil(c ? JSON.parse(String(c)) : undefined) }
      const req = new (require('node:events').EventEmitter)()
      req.method = method; req.url = url; req.headers = {}
      if (body !== undefined) setTimeout(() => { req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end') }, 30)
      globalThis.__settingsRoute(req, res)
    })

    // 覆盖写入进入 settings 文档的 marketSync: 子对象,回读来自 describe 投影
    const put = await call('PUT', '/skills-management/api/market/settings', { branch: 'dev', token: 't-1' })
    assert.equal(put.settings.branch, 'dev')
    assert.equal(put.settings.token, undefined, 'token never echoed')
    assert.equal(put.hasToken, true)
    assert.deepEqual(updates, [{ marketSync: { branch: 'dev', token: 't-1' } }], 'routed through ctx.settings.update with the marketSync subtree')
    const st = await call('GET', '/skills-management/api/market/status')
    assert.equal(st.branch, 'dev')
    assert.equal(st.url, 'https://example.com/x.git', 'composition base preserved')

    // executor sheet：全量提交 = unset 后 set（避免深层 merge 残留已删除的键）
    updates.length = 0; mutations.length = 0
    const ex = await call('PUT', '/skills-management/api/executor-settings', {
      dirs: { mimo: '/tmp/cc' }, disabled: [], extra: [{ key: 'mine', label: 'Mine', dir: '/tmp/mine' }],
    })
    assert.equal(mutations.length, 1)
    assert.deepEqual(mutations[0][0], { op: 'unset', path: ['executorSheet'] })
    assert.deepEqual(mutations[0][1].op, 'set')
    assert.deepEqual(mutations[0][1].path, ['executorSheet'])
    assert.deepEqual(mutations[0][1].value, { dirs: { mimo: '/tmp/cc' }, disabled: [], extra: [{ key: 'mine', label: 'Mine', dir: '/tmp/mine' }] })
    assert.ok(ex)
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
    const home = join(root, 'home')
    await writeSkill(join(home, '.claude', 'skills'), 'foo', { name: 'foo', description: 'Executor skill desc' })
    const env = setupPlugin({
      marketDirs: [join(root, 'market')],
      installedDir: join(root, 'installed'),
      executorHomeDir: home,
      autoDiscoverExecutors: true,
    })
    const scoped = await env.call('GET', '/skills-management/api/executors?executor=claude')
    assert.equal(scoped.status, 200)
    const foo = scoped.payload.executor.skills.find((s) => s.name === 'foo')
    assert.equal(typeof foo.tokens, 'number')
    assert.equal(foo.chars, 'foo\nExecutor skill desc'.length)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
