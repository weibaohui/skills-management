import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const plugin = require('../src/index.js')
const { extractFrontmatter, parseSkillMd, invocationPolicy, installDirName } = plugin.__internals

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
