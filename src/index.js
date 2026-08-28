'use strict'

/**
 * dsh-plugin-skills-management — Host half
 *
 * Two skill universes, one API:
 * - Market: ntd-style bundled collections (git checkouts of GitHub skill
 *   repos). Read-only, install copies into the user library.
 * - Executors: every coding agent's on-machine skills directory
 *   (`~/.claude/skills`, `~/.agents/skills`, …), following the ntd source
 *   table. Scanned for display/detail; deletable per source unless marked
 *   read-only (`agents`); any executor skill can be copied into the dsh
 *   user library so the `skill` tool can call it.
 */

const { createReadStream } = require('node:fs')
const { execFile, spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const fsP = require('node:fs/promises')
const { basename, join, relative, resolve, sep } = require('node:path')
const { homedir } = require('node:os')
const YAML = require('yaml')
let zod = null
try { zod = require('zod') } catch { zod = null }

const DEFAULT_MARKET_DIRS = [join(homedir(), '.ntd', 'bundled', 'skills')]
const MARKET_SCAN_SKIP = new Set(['.git', 'node_modules'])
const RANK_INSTALLED = 100
const RANK_MARKET = 500
const MAX_BODY_BYTES = 64 * 1024
const DESCRIPTION_LIMIT = 140
// 同款正则见 skill/skill/src/index.ts SKILL_NAME —— 不合规的候选会让 registry 抛错
const KEBAB_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Known on-machine skill sources (executor → skills dir), ported from ntd's
 * `ALL_SKILL_SOURCES` table plus this machine's ZCode CLI. `sub` is relative
 * to $HOME; `dsh` is special — its root is the plugin's installedDir.
 */
const EXECUTOR_DEFS = [
  { key: 'dsh', label: 'DSH' },
  { key: 'claudecode', label: 'Claude Code', sub: '.claude/skills' },
  { key: 'zcode', label: 'ZCode', sub: '.zcode/skills' },
  { key: 'codex', label: 'Codex', sub: '.codex/skills' },
  { key: 'opencode', label: 'OpenCode', sub: '.opencode/skills' },
  { key: 'codebuddy', label: 'CodeBuddy', sub: '.codebuddy/skills' },
  { key: 'atomcode', label: 'AtomCode', sub: '.atomcode/skills' },
  { key: 'hermes', label: 'Hermes', sub: '.hermes/skills' },
  { key: 'kimi', label: 'Kimi', sub: '.kimi/skills' },
  { key: 'mobilecoder', label: 'MobileCoder', sub: '.mobile-coder/skills' },
  { key: 'codewhale', label: 'Codewhale', sub: '.codewhale/skills' },
  { key: 'kilo', label: 'Kilo', sub: '.kilo/skills' },
  { key: 'pi', label: 'Pi', sub: '.pi/skills' },
  { key: 'mimo', label: 'Mimo', sub: '.local/share/mimocode/skills' },
  { key: 'zhanlu', label: 'ZhanLu', sub: '.local/share/zhanlu/skills' },
  // agents is a read-only aggregation source in ntd semantics: visible,
  // copyable out, but never deleted or overwritten from here.
  { key: 'agents', label: 'Agents', sub: '.agents/skills', readOnly: true },
]

function isReadOnlySource(key) {
  return key === 'agents'
}

/** Target directory name when installing a (possibly nested) skill name. */
function installDirName(fullName) {
  const parts = String(fullName === undefined || fullName === null ? '' : fullName).split('/')
  return parts[parts.length - 1]
}

/** Absolute path with the $HOME prefix folded to `~` (no username leaks in UI). */
function displayPath(p) {
  const home = homedir()
  if (p === home) return '~'
  if (p.startsWith(home + sep)) return '~' + p.slice(home.length)
  return p
}

function extractFrontmatter(content) {
  const lines = content.split(/\r?\n/)
  if (lines[0] === undefined || lines[0].trim() !== '---') return undefined
  const yamlLines = []
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() === '---') return yamlLines.join('\n')
    yamlLines.push(line)
  }
  return undefined
}

function parseSkillMd(content) {
  const yamlText = extractFrontmatter(content)
  if (yamlText === undefined) return { meta: {}, body: content }
  let meta = {}
  try {
    const parsed = YAML.parse(yamlText)
    if (parsed !== null && typeof parsed === 'object') meta = parsed
  } catch {}
  const lines = content.split(/\r?\n/)
  let closer = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') { closer = index; break }
  }
  const body = closer >= 0 ? lines.slice(closer + 1).join('\n').replace(/^\r?\n/, '') : content
  return { meta, body }
}

function buildEntry(root, dir, stat) {
  return { root, dir, relPath: relative(root, dir).split(sep).join('/'), stat }
}

async function scanSkillDirs(root, current, out, visited) {
  let entries
  try { entries = await fsP.readdir(current, { withFileTypes: true }) }
  catch { return }
  for (const entry of entries) {
    if (MARKET_SCAN_SKIP.has(entry.name)) continue
    const dir = join(current, entry.name)
    // Follow symlinks: executor skills dirs routinely symlink entries from a
    // shared pool (~/.agents/skills); Dirent.isDirectory() would miss them.
    let dirStat
    try { dirStat = await fsP.stat(dir) } catch { continue }
    if (!dirStat.isDirectory()) continue
    let real
    try { real = await fsP.realpath(dir) } catch { continue }
    if (visited.has(real)) continue // symlink cycle guard
    visited.add(real)
    let hasSkillMd = false, skillMdStat
    try { skillMdStat = await fsP.stat(join(dir, 'SKILL.md')); hasSkillMd = skillMdStat.isFile() } catch { hasSkillMd = false }
    if (hasSkillMd) { out.push(buildEntry(root, dir, skillMdStat)) }
    else { await scanSkillDirs(root, dir, out, visited) }
  }
}

async function scanRoot(root) {
  const out = []
  let real
  try { await fsP.access(root) } catch { return out }
  try { real = await fsP.realpath(root) } catch { return out }
  await scanSkillDirs(root, root, out, new Set([real]))
  return out
}

async function readSkillEntry(entry) {
  const content = await fsP.readFile(join(entry.dir, 'SKILL.md'), 'utf8')
  const { meta, body } = parseSkillMd(content)
  const name = typeof meta.name === 'string' && meta.name !== '' ? meta.name : basename(entry.dir)
  return {
    entry,
    name,
    description: typeof meta.description === 'string' ? meta.description : '',
    keywords: Array.isArray(meta.keywords) ? meta.keywords : [],
    version: typeof meta.version === 'string' ? meta.version : undefined,
    author: typeof meta.author === 'string' ? meta.author : undefined,
    license: typeof meta.license === 'string' ? meta.license : undefined,
    meta, body,
    modifiedAt: entry.stat !== undefined ? entry.stat.mtime.toISOString() : undefined,
  }
}

async function countFilesAndSize(dir) {
  let fileCount = 0, totalSize = 0
  const walk = async (current) => {
    const entries = await fsP.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = join(current, entry.name)
      // stat follows symlinks so linked files/dirs count toward the skill
      let stat = await fsP.stat(entryPath).catch(() => undefined)
      if (stat === undefined) continue
      if (stat.isDirectory()) { await walk(entryPath) }
      else if (stat.isFile()) {
        fileCount += 1
        totalSize += stat.size
      }
    }
  }
  await walk(dir)
  return { fileCount, totalSize }
}

async function copyDir(from, to) {
  await fsP.mkdir(to, { recursive: true })
  const entries = await fsP.readdir(from, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.git') continue
    const source = join(from, entry.name), target = join(to, entry.name)
    // Follow symlinks and materialize their targets: installs must be
    // self-contained (a linked references/ dir cannot dangle later).
    let stat
    try { stat = await fsP.stat(source) } catch { continue }
    if (stat.isDirectory()) { await copyDir(source, target) }
    else if (stat.isFile()) { await fsP.copyFile(source, target) }
  }
}

async function resolveSkillDir(root, fullName) {
  if (fullName === '' || fullName.includes('..') || fullName.includes('\\') || fullName.startsWith('/')) {
    throw new Error('invalid skill name')
  }
  const dir = resolve(root, fullName)
  if (!dir.startsWith(resolve(root) + sep)) throw new Error('invalid skill name: escapes root')
  let stat
  try { stat = await fsP.stat(join(dir, 'SKILL.md')) }
  catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') throw new Error(`skill '${fullName}' not found`)
    throw e
  }
  if (!stat.isFile()) throw new Error('not a skill directory')
  return dir
}

// ── Shared route helpers ────────────────────────────────────────────────

function validSkillName(name) {
  return typeof name === 'string' && name !== '' && !name.includes('..') && !name.includes('\\') && !name.startsWith('/')
}

/** Resolve `<root>/<name>` to an existing skill dir under one source root. */
async function findDirUnderRoot(root, fullName, where) {
  try { return await resolveSkillDir(root, fullName) }
  catch (e) {
    if (String(e && e.message).includes('not found')) throw new Error(`skill '${fullName}' not found in ${where}`)
    throw e
  }
}

async function sendSkillFile(res, skillDir, relPath, contentType) {
  const target = resolve(skillDir, relPath)
  const skillRoot = resolve(skillDir)
  if (!target.startsWith(skillRoot + sep)) throw new Error('invalid file path')
  const stat = await fsP.stat(target)
  if (!stat.isFile()) throw new Error('file not found')
  res.writeHead(200, {
    'content-type': contentType !== undefined && contentType !== '' ? contentType : 'application/octet-stream',
    'content-length': stat.size,
  })
  const stream = createReadStream(target)
  stream.pipe(res)
  await new Promise((fulfil, reject) => {
    stream.on('error', reject)
    res.on('close', () => fulfil())
    stream.on('end', () => fulfil())
  })
}

async function walkFiles(base, current, files = []) {
  const entries = await fsP.readdir(current, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = join(current, entry.name)
    let stat = await fsP.stat(entryPath).catch(() => undefined) // follows symlinks
    if (stat === undefined) continue
    if (stat.isDirectory()) { await walkFiles(base, entryPath, files) }
    else if (stat.isFile()) {
      files.push({ path: relative(base, entryPath).split(sep).join('/'), size: stat.size, modifiedAt: stat.mtime.toISOString() })
    }
  }
  return files
}

function readJsonBody(req) {
  return new Promise((fulfil, reject) => {
    let size = 0, chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) { reject(new Error('request body too large')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try { fulfil(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch (error) { reject(new Error(`invalid JSON body: ${error && error.message}`)) }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

function flagValue(meta, key) {
  const value = meta[key]
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase()
    if (['true', 'yes', 'on', '1'].includes(lowered)) return true
    if (['false', 'no', 'off', '0'].includes(lowered)) return false
  }
  return undefined
}

function invocationPolicy(meta) {
  return { modelInvocable: flagValue(meta, 'disable-model-invocation') !== true, userInvocable: flagValue(meta, 'user-invocable') !== false }
}

function truncateDescription(text) {
  if (typeof text !== 'string') return ''
  const single = text.split(/\r?\n/)[0]
  return single.length > DESCRIPTION_LIMIT ? single.slice(0, DESCRIPTION_LIMIT) + '…' : single
}

function expandTilde(p) {
  return p === '~' || p.startsWith('~/') || p.startsWith('~\\') ? join(homedir(), p.slice(2)) : p
}

// ── Market git sync (ntd git_sync semantics: clone --depth 1 first, then
// fetch + reset --hard so the remote always wins and local damage heals) ──

function gitExec(binary, args, cwd) {
  return new Promise((fulfil, reject) => {
    execFile(binary, args, { cwd, timeout: 10 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const tail = String(stderr || error.message || '').split(/\r?\n/).filter(Boolean).slice(-3).join(' ')
        reject(new Error(`git ${args[0]}: ${tail || error.message}`))
        return
      }
      fulfil(String(stdout).trim())
    })
  })
}

async function gitAvailable(binary) {
  try { await gitExec(binary, ['--version']); return true } catch { return false }
}

async function gitCurrentCommit(binary, repo) {
  try { return await gitExec(binary, ['rev-parse', 'HEAD'], repo) } catch { return undefined }
}

async function gitRemoteCommit(binary, repo, remote, branch) {
  try {
    const out = await gitExec(binary, ['ls-remote', '--heads', remote, branch], repo)
    return out.split(/\s+/)[0] || undefined
  } catch { return undefined }
}

/** Embed an access token in an https remote URL (gitcode/oauth2 style).
 *  Credentials stay out of .git/config — every remote-touching command
 *  receives the authed URL directly and nothing is persisted. */
function authedUrl(url, token) {
  if (!token) return url
  return String(url).replace(/^(https?:\/\/)([^@/]+@)?/, `$1oauth2:${encodeURIComponent(token)}@`)
}

/** Clone (first time) or fetch+reset (update); remote branch is truth. */
async function gitSyncRepo(binary, url, branch, repoDir, token) {
  const remote = authedUrl(url, token)
  let repoExists = false
  try { await fsP.access(join(repoDir, '.git')); repoExists = true } catch { repoExists = false }
  if (!repoExists) {
    await fsP.rm(repoDir, { recursive: true, force: true })
    await fsP.mkdir(join(repoDir, '..'), { recursive: true })
    await gitExec(binary, ['clone', '-b', branch, '--depth', '1', remote, repoDir])
    return { isFirstClone: true, hasUpdates: true, before: undefined, after: await gitCurrentCommit(binary, repoDir) }
  }
  const before = await gitCurrentCommit(binary, repoDir)
  await gitExec(binary, ['fetch', remote, branch], repoDir)
  await gitExec(binary, ['reset', '--hard', 'FETCH_HEAD'], repoDir)
  const after = await gitCurrentCommit(binary, repoDir)
  return { isFirstClone: false, hasUpdates: before !== after, before, after }
}

const DEFAULT_MARKET_SYNC = {
  url: 'https://gitcode.com/weibaohui/ntd-resource.git',
  branch: 'main',
  gitBinary: 'git',
  autoSync: true,        // periodic: sync when lastSyncAt is older than a day
  syncOnStartup: true,
}

/** User-settings namespace persisted through the host ctx.settings service
 *  (local provider → $DSH_HOME/settings.yaml). Falls back to an in-memory
 *  override sheet when the service is absent (tests, minimal compositions). */
const MARKET_SETTINGS_NS = 'skills-management.market'

function marketSettingsSchema() {
  if (!zod) return null
  return zod.object({
    url: zod.string().min(1),
    branch: zod.string().min(1),
    gitBinary: zod.string().min(1),
    repoDir: zod.string().optional(),
    autoSync: zod.boolean(),
    syncOnStartup: zod.boolean(),
    token: zod.string().optional(),
  })
}

function mergeMarketSync(config, overrides) {
  const cfg = (config && config.marketSync && typeof config.marketSync === 'object') ? config.marketSync : {}
  return { ...DEFAULT_MARKET_SYNC, ...cfg, ...(overrides || {}) }
}

// ── Share-run jobs: real execution via the official headless channel
// (`dsh --profile headless "<task>"`, cwd = the skill directory — the
// workspace, session and model loop are owned by that one-shot process). ──

const SHARE_RUN_TIMEOUT_MS = 30 * 60 * 1000
const SHARE_RUN_OUTPUT_CAP = 256 * 1024

/** In-process run: drive the same Agent services the web app uses and
 *  stream assistant/chunk tokens + tool calls into the job's output as they
 *  happen (headless prints only the final message — no live channel there).
 *  Mirrors packages/bundle/headless/src/index.ts run(). */
async function runShareInProcess(services, { prompt, dir, job, logger }) {
  const selection = services.agentDefaultModel.currentSelection()
  const sessionId = 'session-' + randomUUID()
  job.sessionId = sessionId
  const { agent } = await services.agents.create({
    sessionId,
    // 标准预设:不带显式选择会继承用户默认(如 Solo Thinking 只有
    // thinking/notify 工具),读文件/调 API 都做不了
    meta: { cwd: dir, agentPreset: 'standard' },
    agentOptions: { provider: selection.provider, model: selection.model },
  })
  await agent.whenIdle()
  const firstSeq = agent.session.seq
  const seen = new Set()
  const liveLine = (text) => {
    job.output = (job.output + text).slice(-SHARE_RUN_OUTPUT_CAP)
  }
  const pump = () => {
    for (const ev of agent.session.events) {
      if (ev.seq < firstSeq || seen.has(ev.seq)) continue
      seen.add(ev.seq)
      const d = ev.data || {}
      if (ev.type === 'assistant/chunk' && d.chunk && d.chunk.type === 'text' && d.chunk.text) {
        liveLine(d.chunk.text)
      } else if (ev.type === 'tool/call') {
        liveLine('\n[tool] ' + d.name + ' ')
      } else if (ev.type === 'assistant/message') {
        liveLine('\n')
      }
    }
  }
  const timer = setInterval(pump, 300)
  if (typeof timer.unref === 'function') timer.unref()
  try {
    agent.followup({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } })
    await agent.whenIdle()
  } finally {
    clearInterval(timer)
    pump()
  }
  try { await services.sessions.flush(agent.session) } catch {}
  job.status = 'done'
  job.code = 0
  return job
}

function createShareRunJob({ binary, prompt, dir, jobs, logger, services }) {
  const id = 'sr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  const job = { id, status: 'running', startedAt: new Date().toISOString(), dir, promptHead: prompt.slice(0, 80), output: '', code: null }
  jobs.set(id, job)
  if (services && services.agents && services.agentDefaultModel) {
    runShareInProcess(services, { prompt, dir, job, logger })
      .catch(e => { job.status = 'error'; job.output = (job.output + '\n' + String(e && e.message)).slice(-SHARE_RUN_OUTPUT_CAP) })
    return job
  }
  let child
  try {
    child = spawn(binary, ['--profile', 'headless', prompt], { cwd: dir })
  } catch (e) {
    job.status = 'error'
    job.output = String(e && e.message)
    return job
  }
  const append = (chunk) => {
    job.output = (job.output + String(chunk)).slice(-SHARE_RUN_OUTPUT_CAP)
  }
  child.stdout && child.stdout.on('data', append)
  child.stderr && child.stderr.on('data', append)
  const timer = setTimeout(() => {
    try { child.kill('SIGKILL') } catch {}
    job.status = 'error'
    job.output += '\n[killed: timeout]'
  }, SHARE_RUN_TIMEOUT_MS)
  if (typeof timer.unref === 'function') timer.unref()
  child.on('error', (e) => { clearTimeout(timer); job.status = 'error'; append('\n' + String(e && e.message)) })
  child.on('close', (code) => {
    clearTimeout(timer)
    if (job.status === 'running') {
      job.status = code === 0 ? 'done' : 'error'
      job.code = code
    }
    logger.info && logger.info(`skills-management: share run ${id} ${job.status} (code ${code})`)
  })
  return job
}

function contentTypeFor(p) {
  const ext = p.slice(p.lastIndexOf('.') + 1).toLowerCase()
  const map = { md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8', json: 'application/json; charset=utf-8', js: 'text/javascript', mjs: 'text/javascript', ts: 'text/typescript', tsx: 'text/typescript', css: 'text/css', html: 'text/html', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', yaml: 'text/yaml', yml: 'text/yaml' }
  return map[ext]
}

module.exports = {
  name: 'skills-management',
  inject: ['skills', 'webServer'],
  __internals: { extractFrontmatter, parseSkillMd, invocationPolicy, installDirName, isReadOnlySource, EXECUTOR_DEFS },

  apply(ctx, config = {}) {
    // Explicit marketDirs config wins; otherwise the scan follows the
    // runtime-configurable repo dir (<repoDir>/skills) so moving the checkout
    // in settings switches the market without touching cordis.yml.
    const configMarketDirs = config.marketDirs !== undefined
      ? config.marketDirs.map((d) => resolve(expandTilde(d)))
      : undefined
    const effectiveRepoDir = () => {
      const eff = marketSettings()
      return resolve(expandTilde(
        typeof eff.repoDir === 'string' && eff.repoDir !== '' ? eff.repoDir
          : config.marketRepoDir !== undefined ? config.marketRepoDir
          : join(homedir(), '.ntd', 'bundled')))
    }
    const marketRoots = () => configMarketDirs !== undefined ? configMarketDirs : [join(effectiveRepoDir(), 'skills')]
    const marketDirs = marketRoots  // scan/install/locate call sites read through this
    const installedDir = resolve(expandTilde(config.installedDir !== undefined ? config.installedDir : process.env.DSH_HOME ? join(process.env.DSH_HOME, 'skills') : join(homedir(), '.dsh', 'skills')))
    const providerName = config.providerName !== undefined ? config.providerName : 'ntd-skills'

    // ── Executor (on-machine source) rows ──
    // dsh first (its root is installedDir); then known defs minus disabled;
    // then user extras. `executorDirs` overrides per-key roots, which also
    // makes scans testable without touching the real $HOME.
    const executorDirsOverride = config.executorDirs !== undefined && config.executorDirs !== null && typeof config.executorDirs === 'object' ? config.executorDirs : {}
    const disabledExecutors = new Set(Array.isArray(config.disabledExecutors) ? config.disabledExecutors : [])
    const seenKeys = new Set()
    const executorRows = []
    for (const def of EXECUTOR_DEFS) {
      if (disabledExecutors.has(def.key)) continue
      let root
      if (def.key === 'dsh') root = installedDir
      else if (executorDirsOverride[def.key] !== undefined) root = resolve(expandTilde(String(executorDirsOverride[def.key])))
      else root = def.sub !== undefined ? join(homedir(), ...def.sub.split('/')) : undefined
      if (seenKeys.has(def.key)) continue
      seenKeys.add(def.key)
      executorRows.push({ key: def.key, label: def.label, root, readOnly: def.readOnly === true })
    }
    for (const extra of Array.isArray(config.extraExecutors) ? config.extraExecutors : []) {
      if (extra === null || typeof extra !== 'object') continue
      if (typeof extra.key !== 'string' || extra.key === '') continue
      if (typeof extra.dir !== 'string' || extra.dir === '') continue
      if (seenKeys.has(extra.key)) continue
      seenKeys.add(extra.key)
      executorRows.push({
        key: extra.key,
        label: typeof extra.label === 'string' && extra.label !== '' ? extra.label : extra.key,
        root: resolve(expandTilde(extra.dir)),
        readOnly: extra.readOnly === true,
      })
    }

    async function discoverAll() {
      const market = [], installed = []
      for (const root of marketDirs()) {
        for (const entry of await scanRoot(root)) {
          try { market.push(await readSkillEntry(entry)) }
          catch (e) { ctx.logger.warn(`skills-management: skipping ${entry.dir}: ${e && e.message}`) }
        }
      }
      for (const entry of await scanRoot(installedDir)) {
        try { installed.push(await readSkillEntry(entry)) }
        catch (e) { ctx.logger.warn(`skills-management: skipping ${entry.dir}: ${e && e.message}`) }
      }
      return { market, installed }
    }

    /**
     * One executor row → summary + flat skill list (ntd `discover_skills_for`).
     * With `countsOnly` the expensive per-skill dir walks are skipped and
     * `skills` stays undefined — callers get `skillCount` only.
     */
    async function scanExecutor(row, countsOnly = false) {
      const summary = { key: row.key, label: row.label, dir: displayPath(row.root), dirExists: false, readOnly: row.readOnly, skillCount: 0 }
      if (!countsOnly) summary.skills = []
      try { await fsP.access(row.root) } catch { return summary }
      summary.dirExists = true
      for (const entry of await scanRoot(row.root)) {
        try {
          const read = await readSkillEntry(entry)
          // ntd naming: nested skill whose frontmatter name equals its dir
          // basename keeps the category path as display name.
          const listed = entry.relPath.includes('/') && read.name === basename(entry.dir) ? entry.relPath : read.name
          summary.skillCount += 1
          if (countsOnly) continue
          const { fileCount, totalSize } = await countFilesAndSize(entry.dir)
          summary.skills.push({ name: listed, relPath: entry.relPath, description: truncateDescription(read.description), keywords: read.keywords, version: read.version, author: read.author, fileCount, totalSize, modifiedAt: read.modifiedAt })
        } catch (e) { ctx.logger.warn(`skills-management: skipping ${entry.dir}: ${e && e.message}`) }
      }
      if (summary.skills !== undefined) {
        summary.skills.sort((a, b) => {
          const la = a.name.toLowerCase(), lb = b.name.toLowerCase()
          return la < lb ? -1 : la > lb ? 1 : 0
        })
      }
      return summary
    }

    function findExecutorRow(key) {
      return executorRows.find((row) => row.key === key)
    }

    /**
     * Locate a named skill dir either scoped to one executor source or via
     * the legacy auto path (installed library first, then markets).
     * Returns `{ dir, executorKey|null, isInstalled }`.
     */
    async function locateNamedSkillDir(name, executorKey) {
      if (executorKey !== undefined && executorKey !== null && executorKey !== '' && executorKey !== 'auto') {
        const row = findExecutorRow(executorKey)
        if (row === undefined) throw new Error(`unknown executor '${executorKey}'`)
        const dir = await findDirUnderRoot(row.root, name, `${row.label} (${row.key})`)
        return { dir, executorKey: row.key, isInstalled: row.key === 'dsh' }
      }
      try { return { dir: await resolveSkillDir(installedDir, name), executorKey: 'dsh', isInstalled: true } }
      catch { /* fall through to market roots */ }
      for (const root of marketDirs()) {
        try { return { dir: await resolveSkillDir(root, name), executorKey: null, isInstalled: false } }
        catch (e) { if (!String(e && e.message).includes('not found')) throw e }
      }
      throw new Error(`skill '${name}' not found`)
    }

    /** Copy any source skill dir into the dsh user library and refresh. */
    async function copyIntoLibrary(sourceDir, shortName, overwrite) {
      const target = join(installedDir, shortName)
      if (!overwrite) {
        try { await fsP.access(target); throw new Error(`skill '${shortName}' already installed`) }
        catch (e) { if (e.code !== 'ENOENT') throw e }
      } else { await fsP.rm(target, { recursive: true, force: true }) }
      await copyDir(sourceDir, target)
      invalidate()
      return { name: shortName, path: target }
    }

    async function installMarketSkill(fullName, overwrite) {
      let sourceDir
      for (const root of marketDirs()) {
        try { sourceDir = await resolveSkillDir(root, fullName); break }
        catch (e) { if (!String(e && e.message).includes('not found')) throw e }
      }
      if (sourceDir === undefined) throw new Error(`skill '${fullName}' not found in market`)
      return copyIntoLibrary(sourceDir, installDirName(fullName), overwrite)
    }

    async function installFromExecutor(executorKey, fullName, overwrite) {
      const row = findExecutorRow(executorKey)
      if (row === undefined) throw new Error(`unknown executor '${executorKey}'`)
      const sourceDir = await findDirUnderRoot(row.root, fullName, `${row.label} (${row.key})`)
      return copyIntoLibrary(sourceDir, installDirName(fullName), overwrite)
    }

    async function deleteSkill(name, executorKey) {
      if (!validSkillName(name)) throw new Error('invalid skill name')
      const key = executorKey === undefined || executorKey === null || executorKey === '' ? 'dsh' : executorKey
      const row = findExecutorRow(key)
      if (row === undefined) throw new Error(`unknown executor '${key}'`)
      if (row.readOnly) throw new Error(`source '${key}' is read-only; cannot delete skills there`)
      const target = join(row.root, name)
      const stat = await fsP.stat(target).catch(() => undefined)
      if (stat === undefined || !stat.isDirectory()) throw new Error(`skill '${name}' not found in ${row.label} (${row.key})`)
      await fsP.rm(target, { recursive: true })
      if (key === 'dsh') invalidate()
      return { removed: name, executor: key }
    }

    // ── Market sync state (persisted next to the repo root) ──
    const marketStateFile = join(resolve(installedDir, '..'), 'skills-market-sync.json')
    let marketState = { lastSyncAt: undefined, lastResult: undefined }
    // User-facing settings live in the host settings service when present;
    // the local json only carries runtime sync bookkeeping.
    let settingsScope = null
    const settingsOverrides = {}  // fallback sheet when the service is absent
    const marketStateLoaded = fsP.readFile(marketStateFile, 'utf8')
      .then(raw => {
        const parsed = JSON.parse(raw)
        marketState = { lastSyncAt: parsed.lastSyncAt, lastResult: parsed.lastResult }
        // one-time migration: pre-settings-service overrides move into the
        // settings namespace, then are blanked in the legacy file
        if (parsed.settings && typeof parsed.settings === 'object' && Object.keys(parsed.settings).length > 0) {
          const legacy = parsed.settings
          Promise.resolve().then(async () => {
            await marketStateLoaded
            if (settingsScope && typeof settingsScope.update === 'function') {
              try {
                await settingsScope.update(legacy)
                await fsP.writeFile(marketStateFile, JSON.stringify(marketState, null, 2), { mode: 0o600 })
              } catch (e) { ctx.logger.warn(`skills-management: legacy settings migration: ${e && e.message}`) }
            } else {
              Object.assign(settingsOverrides, legacy)
            }
          })
        }
      })
      .catch(() => {})
    const baseSettings = () => {
      const cfg = (config.marketSync && typeof config.marketSync === 'object') ? config.marketSync : {}
      const base = { ...DEFAULT_MARKET_SYNC }
      for (const key of ['url', 'branch', 'gitBinary', 'autoSync', 'syncOnStartup']) {
        if (cfg[key] !== undefined) base[key] = cfg[key]
      }
      if (config.marketRepoDir !== undefined) base.repoDir = resolve(expandTilde(config.marketRepoDir))
      return base
    }
    try {
      if (ctx.inject && typeof ctx.inject === 'function') {
        ctx.inject(['settings'], (settingsCtx) => {
          const schema = marketSettingsSchema()
          if (schema && settingsCtx && settingsCtx.settings && typeof settingsCtx.settings.register === 'function') {
            try { settingsScope = settingsCtx.settings.register(MARKET_SETTINGS_NS, schema, { base: baseSettings() }) } catch (e) { ctx.logger.warn(`skills-management: settings register: ${e && e.message}`) }
          }
        })
      }
    } catch (e) { ctx.logger.warn(`skills-management: settings inject: ${e && e.message}`) }
    const saveMarketState = async () => {
      // 0600: the state file may carry the access token
      try { await fsP.writeFile(marketStateFile, JSON.stringify(marketState, null, 2), { mode: 0o600 }) } catch {}
      try { await fsP.chmod(marketStateFile, 0o600) } catch {}
    }
    const marketSettings = () => {
      if (settingsScope && typeof settingsScope.get === 'function') {
        const v = settingsScope.get()
        if (v && typeof v === 'object') return { ...baseSettings(), ...v }
      }
      return mergeMarketSync(config, settingsOverrides)
    }

    let marketSyncRun = null
    const runMarketSync = async () => {
      if (marketSyncRun !== null) return marketSyncRun
      marketSyncRun = (async () => {
        await marketStateLoaded
        const eff = marketSettings()
        const ok = await gitAvailable(eff.gitBinary)
        if (!ok) throw new Error('git is not available on PATH')
        const started = Date.now()
        const repoDir = effectiveRepoDir()
        const result = await gitSyncRepo(eff.gitBinary, eff.url, eff.branch, repoDir, eff.token)
        marketState.lastSyncAt = new Date().toISOString()
        marketState.lastResult = { ...result, at: marketState.lastSyncAt, durationMs: Date.now() - started }
        await saveMarketState()
        invalidate()
        return { ...marketState.lastResult, url: eff.url, branch: eff.branch, dir: repoDir }
      })().finally(() => { marketSyncRun = null })
      return marketSyncRun
    }

    // Startup + periodic auto-sync (fire-and-forget; failures only warn)
    ctx.effect(() => {
      const eff = marketSettings()
      if (eff.syncOnStartup) {
        marketStateLoaded.then(() => runMarketSync()).catch(e => ctx.logger.warn(`skills-management: startup market sync: ${e && e.message}`))
      }
      const timer = setInterval(() => {
        const now = Date.now()
        const eff2 = marketSettings()
        if (!eff2.autoSync) return
        const last = marketState.lastSyncAt ? Date.parse(marketState.lastSyncAt) : 0
        if (now - last > 24 * 3600 * 1000) {
          runMarketSync().catch(e => ctx.logger.warn(`skills-management: auto market sync: ${e && e.message}`))
        }
      }, 6 * 3600 * 1000)
      if (typeof timer.unref === 'function') timer.unref()
      return () => clearInterval(timer)
    }, 'skills-management: market auto-sync')

    const shareRunJobs = new Map()
    // Same-process Agent services (the web app's own): when available the
    // share run streams live; absent compositions fall back to headless spawn.
    let shareServices = null
    try {
      if (ctx.inject && typeof ctx.inject === 'function') {
        ctx.inject(['agents', 'agentDefaultModel', 'sessions'], (svcs) => { shareServices = svcs })
      }
    } catch {}
    let providerControl
    const invalidate = () => { if (providerControl !== undefined) providerControl.invalidate() }

    ctx.skills.registerProvider((control) => {
      providerControl = control
      control.signal.addEventListener('abort', () => { if (providerControl === control) providerControl = undefined }, { once: true })
      return {
        name: providerName,
        async list() {
          const { market, installed } = await discoverAll()
          const candidates = []
          // Fail-soft: the registry throws — and kills the requesting session's
          // turn — on candidates that fail harness validation (empty
          // description, non-kebab-case name). Market checkouts with malformed
          // frontmatter trigger both routinely, so pre-filter here.
          const isValid = (row) => {
            if (!row.name || !KEBAB_NAME_RE.test(row.name)) return `invalid name '${row.name}'`
            if (!row.description || row.description.trim() === '') return 'empty description'
            return undefined
          }
          for (const row of installed) {
            const why = isValid(row)
            if (why !== undefined) {
              ctx.logger.warn(`skills-management: skipping installed skill '${row.name}' (${row.entry.dir}): ${why}`)
              continue
            }
            candidates.push(toCandidate(row, 'user-installed', RANK_INSTALLED))
          }
          for (const row of market) {
            const why = isValid(row)
            if (why !== undefined) {
              ctx.logger.warn(`skills-management: skipping market skill '${row.entry.relPath}': ${why}`)
              continue
            }
            const shortName = row.name.includes('/') ? row.name.split('/').pop() : row.name
            if (installed.some((e) => e.name === shortName)) continue
            candidates.push(toCandidate(row, 'market', RANK_MARKET))
          }
          return candidates
        },
        async get(candidate) {
          const entry = candidate.locator
          try {
            const row = await readSkillEntry({ ...entry, stat: entry.stat ?? (await fsP.stat(join(entry.dir, 'SKILL.md'))) })
            return { name: row.name, description: row.description, whenToUse: typeof row.meta.whenToUse === 'string' ? row.meta.whenToUse : undefined, invocation: invocationPolicy(row.meta), source: candidate.source, provider: providerName, resourceBase: { kind: 'directory', path: entry.dir }, content: row.body, path: join(entry.dir, 'SKILL.md'), metadata: row.meta }
          } catch { return undefined }
        },
      }
    })

    function toCandidate(row, source, rank) {
      return { name: row.name, description: row.description, invocation: invocationPolicy(row.meta), source, provider: providerName, rank, locator: { dir: row.entry.dir, root: row.entry.root, relPath: row.entry.relPath, stat: row.entry.stat }, path: join(row.entry.dir, 'SKILL.md'), metadata: row.meta, whenToUse: typeof row.meta.whenToUse === 'string' ? row.meta.whenToUse : undefined, resourceBase: { kind: 'directory', path: row.entry.dir } }
    }

    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: '/skills-management/api',
      handler: async (req, res) => {
        try {
          const url = new URL(req.url || '/', 'http://dsh.local')
          const apiPath = url.pathname.replace(/\/+$/, '')
          const query = url.searchParams

          // GET /skills-management/api/market/status
          if (req.method === 'GET' && apiPath.endsWith('/skills-management/api/market/status')) {
            await marketStateLoaded
            const eff = marketSettings()
            const repoDir = effectiveRepoDir()
            const repoExists = await fsP.access(join(repoDir, '.git')).then(() => true).catch(() => false)
            const ok = await gitAvailable(eff.gitBinary)
            const [localCommit, remoteCommit] = repoExists && ok
              ? [await gitCurrentCommit(eff.gitBinary, repoDir), await gitRemoteCommit(eff.gitBinary, repoDir, 'origin', eff.branch)]
              : [undefined, undefined]
            sendJson(res, 200, {
              url: eff.url, branch: eff.branch, dir: displayPath(repoDir),
              gitAvailable: ok, repoExists,
              localCommit, remoteCommit,
              needsUpdate: localCommit !== undefined && remoteCommit !== undefined ? localCommit !== remoteCommit : undefined,
              lastSyncAt: marketState.lastSyncAt, lastResult: marketState.lastResult,
              autoSync: eff.autoSync, syncOnStartup: eff.syncOnStartup,
              hasToken: typeof eff.token === 'string' && eff.token !== '',
              syncing: marketSyncRun !== null,
            })
            return
          }

          // POST /skills-management/api/market/sync
          if (req.method === 'POST' && apiPath.endsWith('/skills-management/api/market/sync')) {
            try {
              const result = await runMarketSync()
              sendJson(res, 200, result)
            } catch (e) { sendJson(res, 400, { error: String(e && e.message || e) }) }
            return
          }

          // PUT /skills-management/api/market/settings {url?, branch?, autoSync?, syncOnStartup?}
          if (req.method === 'PUT' && apiPath.endsWith('/skills-management/api/market/settings')) {
            // body first: readJsonBody attaches listeners synchronously, so no
            // event can slip past while the state-file promise resolves
            const body = await readJsonBody(req)
            await marketStateLoaded
            const patch = {}
            for (const key of ['url', 'branch', 'gitBinary']) {
              if (typeof body[key] === 'string' && body[key] !== '') patch[key] = body[key]
            }
            // token: non-empty string sets it; null or '' clears it. Never echoed.
            if (typeof body.token === 'string' && body.token !== '') patch.token = body.token
            if (body.token === null || body.token === '') patch.token = undefined
            if (typeof body.repoDir === 'string' && body.repoDir !== '') {
              patch.repoDir = resolve(expandTilde(body.repoDir))
            }
            for (const key of ['autoSync', 'syncOnStartup']) {
              if (typeof body[key] === 'boolean') patch[key] = body[key]
            }
            if (settingsScope && typeof settingsScope.update === 'function') {
              await settingsScope.update(patch)
            } else {
              Object.assign(settingsOverrides, patch)
            }
            const eff = marketSettings()
            const { token, ...safe } = eff  // token 只写不回读
            sendJson(res, 200, { settings: safe, hasToken: typeof token === 'string' && token !== '' })
            return
          }

          // POST /skills-management/api/share/run {prompt, dir} → real headless run
          if (req.method === 'POST' && apiPath.endsWith('/skills-management/api/share/run')) {
            const body = await readJsonBody(req)
            if (typeof body.prompt !== 'string' || body.prompt.trim() === '') { sendJson(res, 400, { error: 'body must provide prompt' }); return }
            if (typeof body.dir !== 'string' || body.dir === '') { sendJson(res, 400, { error: 'body must provide dir' }); return }
            const dir = resolve(expandTilde(body.dir))
            const stat = await fsP.stat(dir).catch(() => undefined)
            if (stat === undefined || !stat.isDirectory()) { sendJson(res, 400, { error: `dir not found: ${displayPath(dir)}` }); return }
            const binary = process.env.SKILLS_DSH_BIN || 'dsh'
            const job = createShareRunJob({ binary, prompt: body.prompt, dir, jobs: shareRunJobs, logger: ctx.logger, services: shareServices })
            sendJson(res, 202, { jobId: job.id, status: job.status })
            return
          }

          // GET /skills-management/api/share/run?id= → job status/output
          if (req.method === 'GET' && apiPath.endsWith('/skills-management/api/share/run')) {
            const id = query.get('id') || ''
            const job = shareRunJobs.get(id)
            if (job === undefined) { sendJson(res, 404, { error: 'job not found' }); return }
            sendJson(res, 200, { ...job, output: job.output.slice(-32 * 1024) })
            return
          }

          // GET /skills-management/api/executors → on-machine sources.
          // Variants: ?mode=summary (counts only, no skill arrays) and
          // ?executor=<key> (one source, full list — lazy drill-in).
          if (req.method === 'GET' && apiPath.endsWith('/skills-management/api/executors')) {
            const scopeKey = query.get('executor')
            if (scopeKey !== null && scopeKey !== '') {
              const scoped = findExecutorRow(scopeKey)
              if (scoped === undefined) throw new Error(`unknown executor '${scopeKey}'`)
              sendJson(res, 200, { executor: await scanExecutor(scoped) })
              return
            }
            const countsOnly = query.get('mode') === 'summary'
            const executors = []
            for (const row of executorRows) executors.push(await scanExecutor(row, countsOnly))
            sendJson(res, 200, { executors })
            return
          }

          // GET /skills-management/api → list
          if (req.method === 'GET' && apiPath === '/skills-management/api') {
            const { market, installed } = await discoverAll()
            const sources = new Map()
            for (const row of market) {
              const sourceKey = row.entry.relPath.split('/')[0]
              const agg = sources.get(sourceKey) ?? { source: sourceKey, skills: 0, displayName: sourceKey }
              agg.skills += 1
              sources.set(sourceKey, agg)
            }
            const installedNames = new Set(installed.map((r) => r.name))
            sendJson(res, 200, {
              sources: [...sources.values()],
              market: market.map((row) => ({ name: row.entry.relPath, shortName: row.name, source: row.entry.relPath.split('/')[0], description: truncateDescription(row.description), keywords: row.keywords, version: row.version, installed: installedNames.has(row.name), totalSize: 0 })),
              installed: await Promise.all(installed.map(async (row) => { const { fileCount, totalSize } = await countFilesAndSize(row.entry.dir); return { name: row.name, description: truncateDescription(row.description), path: row.entry.dir, fileCount, totalSize, modifiedAt: row.modifiedAt } })),
            })
            return
          }

          // GET /skills-management/api/detail?name=&executor= → detail
          if (req.method === 'GET' && apiPath.endsWith('/skills-management/api/detail')) {
            const name = query.get('name') || ''
            const located = await locateNamedSkillDir(name, query.get('executor'))
            const content = await fsP.readFile(join(located.dir, 'SKILL.md'), 'utf8')
            const files = await walkFiles(located.dir, located.dir)
            const { fileCount, totalSize } = await countFilesAndSize(located.dir)
            const { meta, body } = parseSkillMd(content)
            sendJson(res, 200, { name, shortName: basename(name), dir: displayPath(located.dir), executor: located.executorKey, isInstalled: located.isInstalled, content: body, contentWithMeta: content, meta, files, fileCount, totalSize, modifiedAt: files[0]?.modifiedAt })
            return
          }

          // GET /skills-management/api/file?name=&path=&executor= → file content
          if (req.method === 'GET' && apiPath.endsWith('/skills-management/api/file')) {
            const name = query.get('name') || '', filePath = query.get('path') || ''
            const located = await locateNamedSkillDir(name, query.get('executor'))
            await sendSkillFile(res, located.dir, filePath, contentTypeFor(filePath))
            return
          }

          // POST /skills-management/api/install {name, from?, overwrite?}
          if (req.method === 'POST' && apiPath.endsWith('/skills-management/api/install')) {
            const body = await readJsonBody(req)
            if (typeof body.name !== 'string' || body.name === '') { sendJson(res, 400, { error: 'body must provide name' }); return }
            const result = typeof body.from === 'string' && body.from !== '' && body.from !== 'market'
              ? await installFromExecutor(body.from, body.name, body.overwrite === true)
              : await installMarketSkill(body.name, body.overwrite === true)
            sendJson(res, 201, { installed: { ...result, from: typeof body.from === 'string' && body.from !== '' && body.from !== 'market' ? body.from : 'market' } })
            return
          }

          // DELETE /skills-management/api {name, executor?} → remove
          if (req.method === 'DELETE' && apiPath.endsWith('/skills-management/api')) {
            const body = await readJsonBody(req)
            if (typeof body.name !== 'string' || body.name === '') { sendJson(res, 400, { error: 'body must provide name' }); return }
            sendJson(res, 200, await deleteSkill(body.name, typeof body.executor === 'string' ? body.executor : undefined))
            return
          }

          sendJson(res, 404, { error: 'not found' })
        } catch (error) { sendJson(res, 400, { error: String(error && error.message || error) }) }
      },
    }), 'skills-management: api route')
  },
}
