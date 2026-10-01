'use strict'

/**
 * dsh-plugin-skills-management — Host half
 *
 * Two skill universes, one API:
 * - Market: ntd-style bundled collections (git checkouts of GitHub skill
 *   repos). Read-only, install copies into the user library.
 * - Executors: every coding agent's on-machine skills directory. Discovery
 *   follows the `~/.xxx/skills` convention (Windows: `%USERPROFILE%\.xxx\
 *   skills`) — any dotted home subdir with a `skills/` child is a source,
 *   key/label derived from the dir name (`.claude` → `claude`/`Claude`);
 *   EXECUTOR_DEFS remains only for what the rule can't reach (the dsh
 *   library root; mimo/zhanlu's `~/.local/share/…` paths). Scanned for
 *   display/detail; deletable per source; any executor skill can be copied
 *   into the dsh user library so the `skill` tool can call it.
 */

const { createReadStream } = require('node:fs')
const { execFile } = require('node:child_process')
const { createShareRunJob } = require('@weibaohui/dsh-plugin-kit')
const { randomUUID } = require('node:crypto')
const fsP = require('node:fs/promises')
const { basename, join, relative, resolve, sep } = require('node:path')
const { homedir } = require('node:os')
const YAML = require('yaml')
// settings 服务要求 schemastery schema（可调用 + toJSON；zod 不兼容，register 会抛错被吞）。
// 宿主沙箱内解析打包依赖可能抛 ERR_INTERNAL_ASSERTION（.pnpm 软链），因此优先沿
// dsh 全局安装取 settings 服务自用的那份副本，本地开发/测试再退回标准 require。
function loadSchemastery() {
  const errors = []
  const { createRequire } = require('node:module')
  for (const prefix of [process.env.DSH_GLOBAL_PREFIX, join(homedir(), '.local')].filter(Boolean)) {
    const hostCopy = join(prefix, 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'schemastery', 'lib', 'index.cjs')
    try { return createRequire(hostCopy)(hostCopy) } catch (e) { errors.push(String(e && e.code || e)) }
  }
  try { return require('@deepseek-ai/schemastery') } catch (e) { errors.push(String(e && e.code || e)) }
  if (process.env.SKILLS_SETTINGS_DEBUG) console.warn(`[skills-management] schemastery unavailable: ${errors.join(' | ')}`)
  return null
}
const Schema = loadSchemastery()

const MARKET_SCAN_SKIP = new Set(['.git', 'node_modules'])
const RANK_INSTALLED = 100
const RANK_MARKET = 500
const MAX_BODY_BYTES = 64 * 1024
const DESCRIPTION_LIMIT = 140
// 同款正则见 skill/skill/src/index.ts SKILL_NAME —— 不合规的候选会让 registry 抛错
const KEBAB_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * 内置来源只留约定（~/.xxx/skills）覆盖不到的部分：
 * - `dsh` 特殊——根即本插件安装库；
 * - `sub` 为相对 $HOME 的显式路径（mimo/zhanlu 的 ~/.local/share/… 不合约定，
 *   只能留表）。
 * 其余一切来源由自动发现按目录名派生 key/label 收录（.claude → claude/Claude）。
 */
const EXECUTOR_DEFS = [
  { key: 'dsh', label: 'DSH' },
  { key: 'mimo', label: 'Mimo', sub: '.local/share/mimocode/skills' },
  { key: 'zhanlu', label: 'ZhanLu', sub: '.local/share/zhanlu/skills' },
]

/** 内置 key 集合，供 sheet 校验/去重。 */
const BUILTIN_KEYS = new Set(EXECUTOR_DEFS.map((d) => d.key))

// ── 约定式自动发现：~/.xxx/skills ─────────────────────────────────────
// 约定 = 家目录直下任何 `.` 开头的目录，只要内含 skills/ 子目录，就是一个
// 执行器技能来源，无需在内置表登记。内置表继续负责两件事：已知工具的显示名
// （Claude Code、ZCode…），以及不合约定的路径（mimo 的 ~/.local/share/…）。
// Windows 上 ~ = %USERPROFILE%，同一规则即 C:\Users\<user>\.xxx\skills——
// 点前缀目录名在 Windows 下同样是字面约定，代码路径全平台一致。
const AUTO_DISCOVER_SKIP = new Set(['.git']) // 家目录本身做 dotfiles 仓库时排除

/** 路径去重键：Windows 文件系统大小写不敏感，比较前折叠。 */
function normPathKey(p) {
  const r = resolve(p)
  return process.platform === 'win32' ? r.toLowerCase() : r
}

/** '.mobile-coder' → 'mobile-coder'；无法派生出合规 kebab key 时 undefined。 */
function keyFromDotDir(name) {
  const key = String(name).replace(/^\.+/, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return KEBAB_NAME_RE.test(key) ? key : undefined
}

/** 派生展示名：'mobile-coder' → 'Mobile Coder'（内置表命中的不走这里）。 */
function labelFromKey(key) {
  return key.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/**
 * 扫描 home 直下符合 `~/.xxx/skills` 约定的目录，按目录名排序返回
 * [{ name: '.foo', dir: '<home>/.foo/skills' }]。点目录与 skills 子目录都允许
 * 是软链（Windows junction 在 Dirent 上同样报 isSymbolicLink，stat 跟随）。
 */
async function discoverSkillHomes(home) {
  const out = []
  let entries
  try { entries = await fsP.readdir(home, { withFileTypes: true }) } catch { return out }
  for (const entry of entries) {
    if (entry.name.length < 2 || !entry.name.startsWith('.') || AUTO_DISCOVER_SKIP.has(entry.name)) continue
    let isDir = entry.isDirectory()
    if (!isDir && entry.isSymbolicLink()) {
      try { isDir = (await fsP.stat(join(home, entry.name))).isDirectory() } catch { isDir = false }
    }
    if (!isDir) continue
    const dir = join(home, entry.name, 'skills')
    let stat
    try { stat = await fsP.stat(dir) } catch { continue }
    if (!stat.isDirectory()) continue
    out.push({ name: entry.name, dir })
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return out
}

/**
 * 发现的目录 → 自动来源行。去重与命名规则：
 * - 路径命中任一内置行的默认根（含 dsh 安装库）或自定义行目录 → 该路径已有
 *   归属，不再自动添加。内置行被停用时其约定目录随之整隐（符合「停用」直觉），
 *   因此这里比的是内置默认根而非当前生效根。
 * - 派生 key 与既有 key 冲突且路径不同 → 追加 -2/-3… 后缀；label 始终按目录
 *   原名派生（key 加后缀不影响显示名）。
 */
function deriveAutoExecutors(discovered, takenPaths, takenKeys) {
  const paths = new Set(takenPaths.map(normPathKey))
  const keys = new Set(takenKeys)
  const rows = []
  for (const { name, dir } of discovered) {
    if (paths.has(normPathKey(dir))) continue
    const base = keyFromDotDir(name)
    if (base === undefined) continue
    let key = base
    for (let n = 2; keys.has(key); n += 1) key = `${base}-${n}`
    keys.add(key)
    paths.add(normPathKey(dir))
    rows.push({ key, label: labelFromKey(base), root: dir, readOnly: false, source: 'auto', locked: false })
  }
  return rows
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

function buildEntry(root, dir, stat, linkTarget) {
  return { root, dir, relPath: relative(root, dir).split(sep).join('/'), stat, isLink: linkTarget !== undefined, linkTarget }
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
    // lstat first so the entry can carry its linked-ness (UI marks such skills
    // as virtual); non-links reuse the lstat result and skip the second stat.
    let lst
    try { lst = await fsP.lstat(dir) } catch { continue }
    const linked = lst.isSymbolicLink()
    let dirStat = lst
    if (linked) {
      try { dirStat = await fsP.stat(dir) } catch { continue }
    }
    if (!dirStat.isDirectory()) continue
    let real
    try { real = await fsP.realpath(dir) } catch { continue }
    if (visited.has(real)) continue // symlink cycle guard
    visited.add(real)
    let hasSkillMd = false, skillMdStat
    try { skillMdStat = await fsP.stat(join(dir, 'SKILL.md')); hasSkillMd = skillMdStat.isFile() } catch { hasSkillMd = false }
    if (hasSkillMd) { out.push(buildEntry(root, dir, skillMdStat, linked ? real : undefined)) }
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

/**
 * Resolve a skill dir under one source root by the identifier the client sends.
 * Tries the direct path `<root>/<name>` first (covers dir name == frontmatter
 * name, and nested relPaths like `grouped/foo`). On ENOENT, falls back to a
 * frontmatter-name scan: some sources ship a skill in a dir whose name ≠ its
 * frontmatter `name` (e.g. WorkBuddy's `dev-expert__skillhub/` whose frontmatter
 * `name` is `dev-expert`). The client lists & addresses such skills by their
 * frontmatter `name`, so the resolver must honor it. frontmatter `name` is always
 * single-segment kebab, so a slash-bearing request is a relPath that already
 * missed direct lookup and cannot be a frontmatter name — skip the scan.
 * Returns the skill dir or undefined.
 */
async function resolveSkillDirByName(root, name) {
  try { return await resolveSkillDir(root, name) }
  catch (e) {
    if (!String(e && e.message).includes('not found')) throw e
  }
  if (name.includes('/')) return undefined
  for (const entry of await scanRoot(root)) {
    try { if ((await readSkillEntry(entry)).name === name) return entry.dir }
    catch {}
  }
  return undefined
}

/** Resolve `<root>/<name>` to an existing skill dir under one source root. */
async function findDirUnderRoot(root, fullName, where) {
  const dir = await resolveSkillDirByName(root, fullName)
  if (dir === undefined) throw new Error(`skill '${fullName}' not found in ${where}`)
  return dir
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

// ── 注入开销估算（≈token / 字符）─────────────────────────────────────────
// 技能注入模型 = 名称+描述，两个指标都按该文本统计（字符数即其长度，token 数
// 用 js-tiktoken 的 cl100k_base 词表估算——与 tiktokenizer 同词表同值）。列表
// 接口的 description 是截断展示，统计必须喂截断前的全文。DeepSeek 自有分词与
// tiktoken 有差异，数值用于横向比较而非精确计费；词表加载失败时降级为只出字符数。
let usageEncoder = null
let usageEncoderFailed = false
let usageEncoderOverride  // 测试注入点：undefined 走正常加载，null 强制降级
function usageEncoderLazy() {
  if (usageEncoderOverride !== undefined) return usageEncoderOverride
  if (usageEncoderFailed) return null
  if (usageEncoder === null) {
    try {
      const { Tiktoken } = require('js-tiktoken/lite')
      usageEncoder = new Tiktoken(require('js-tiktoken/ranks/cl100k_base'))
    } catch { usageEncoderFailed = true }
  }
  return usageEncoder
}
const USAGE_MEMO_CAP = 25000
const usageMemo = new Map()
function usageStat(name, description) {
  const desc = typeof description === 'string' ? description : ''
  const text = `${name || ''}\n${desc}`
  const stat = { chars: text.length }
  const enc = usageEncoderLazy()
  if (enc !== null) {
    let tokens = usageMemo.get(text)
    if (tokens === undefined) {
      tokens = enc.encode(text).length
      if (usageMemo.size >= USAGE_MEMO_CAP) usageMemo.clear()
      usageMemo.set(text, tokens)
    }
    stat.tokens = tokens
  }
  return stat
}

function expandTilde(p) {
  return p === '~' || p.startsWith('~/') || p.startsWith('~\\') ? join(homedir(), p.slice(2)) : p
}

/** dsh 数据根（与宿主一致：$DSH_HOME，缺省 ~/.dsh）。 */
function dshHome() {
  return process.env.DSH_HOME ? resolve(process.env.DSH_HOME) : join(homedir(), '.dsh')
}

/**
 * 切换 dsh 原生治理键 `disable-model-invocation`（docs/subsystems/skills.md）。
 * modelInvocable=true 时移除该键；false 时写入 true。其余 frontmatter 键与正文原样保留。
 */
function setModelInvocable(content, modelInvocable) {
  const lines = String(content || '').split(/\r?\n/)
  if (lines[0] === undefined || lines[0].trim() !== '---') {
    return modelInvocable ? content : `---\ndisable-model-invocation: true\n---\n\n${content}`
  }
  let closer = -1
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') { closer = i; break }
  }
  if (closer === -1) return content
  let kept = lines.slice(1, closer).filter((l) => !/^disable-model-invocation\s*:/.test(l.trim()))
  if (!modelInvocable) kept = [...kept, 'disable-model-invocation: true']
  return [...lines.slice(0, 1), ...kept, ...lines.slice(closer)].join('\n')
}

async function atomicWriteJs(file, content) {
  await fsP.mkdir(join(file, '..'), { recursive: true })
  const temp = join(join(file, '..'), `.${randomUUID()}.tmp`)
  await fsP.writeFile(temp, content, 'utf8')
  await fsP.rename(temp, file)
}

// ── 回收站（删除暂存）───────────────────────────────────────────────
// 删除 = 移入 <dshHome>/skills-management/trash/（与所有被扫描的技能根平级，
// 不会被扫回）。每个回收项是一对：trash/<id>/（技能目录本体）+ trash/<id>.json
// （元数据：原名/来源 key/原始绝对路径/删除时间——恢复按原始路径放回，
// 兼容目录名≠frontmatter 名的布局）。同盘 rename 秒移；跨盘（EXDEV，
// Windows 上技能在 D:\ 而回收站在 C:\Users\…）降级复制+删除；软链技能
// 移的是链接本身，目标池不受影响。
const DEFAULT_TRASH_RETENTION_DAYS = 30 // 惰性清理：启动时 + 读回收站列表时

function trashSlug(name) {
  return String(name).replace(/\//g, '--').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 60) || 'skill'
}

function validTrashId(id) {
  return typeof id === 'string' && id !== '' && id.length <= 200 && !id.includes('/') && !id.includes('\\') && !id.includes('..')
}

async function pathExists(p) {
  try { await fsP.access(p); return true } catch { return false }
}

/** rename 优先；EXDEV 跨设备降级为复制+删除（软链重建链接，不物化目标）。 */
async function movePath(src, dst) {
  try { await fsP.rename(src, dst); return }
  catch (e) { if (!e || e.code !== 'EXDEV') throw e }
  const lst = await fsP.lstat(src)
  if (lst.isSymbolicLink()) {
    const target = await fsP.readlink(src)
    await fsP.symlink(target, dst, process.platform === 'win32' ? 'junction' : 'dir')
    await fsP.rm(src)
  } else if (lst.isDirectory()) {
    await copyDir(src, dst)
    await fsP.rm(src, { recursive: true })
  } else {
    await fsP.copyFile(src, dst)
    await fsP.rm(src)
  }
}

async function uniqueTrashId(trashDir, base) {
  for (let id = base, n = 2; ; id = `${base}-${n}`, n += 1) {
    if (!(await pathExists(join(trashDir, id))) && !(await pathExists(join(trashDir, id + '.json')))) return id
  }
}

/** 技能目录移入回收站。先写元数据再移动：移动失败不留孤儿目录（元数据回滚）。 */
async function moveToTrash(trashDir, sourceDir, name, executorKey) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
  const id = await uniqueTrashId(trashDir, `${stamp}-${executorKey}-${trashSlug(name)}`)
  const meta = { id, name, executorKey, originalDir: sourceDir, deletedAt: new Date().toISOString() }
  await fsP.mkdir(trashDir, { recursive: true })
  await fsP.writeFile(join(trashDir, id + '.json'), JSON.stringify(meta, null, 2), 'utf8')
  try {
    await movePath(sourceDir, join(trashDir, id))
  } catch (e) {
    await fsP.rm(join(trashDir, id + '.json'), { force: true }).catch(() => {})
    throw e
  }
  return meta
}

async function readTrashMeta(trashDir, id) {
  try {
    const parsed = JSON.parse(await fsP.readFile(join(trashDir, id + '.json'), 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : null
  } catch { return null }
}

async function listTrash(trashDir) {
  let entries
  try { entries = await fsP.readdir(trashDir, { withFileTypes: true }) } catch { return [] }
  const out = []
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const id = entry.name
    const meta = await readTrashMeta(trashDir, id)
    let description = ''
    try { description = parseSkillMd(await fsP.readFile(join(trashDir, id, 'SKILL.md'), 'utf8')).meta.description || '' } catch {}
    const { fileCount, totalSize } = await countFilesAndSize(join(trashDir, id)).catch(() => ({ fileCount: 0, totalSize: 0 }))
    out.push({
      id,
      name: meta !== null && typeof meta.name === 'string' ? meta.name : id,
      executorKey: meta !== null && typeof meta.executorKey === 'string' ? meta.executorKey : '',
      originalDir: meta !== null && typeof meta.originalDir === 'string' ? meta.originalDir : '',
      deletedAt: meta !== null && typeof meta.deletedAt === 'string' ? meta.deletedAt : undefined,
      description: truncateDescription(description),
      fileCount, totalSize,
      // 元数据缺失（移动中途崩溃的残骸）只能彻底删除，无法恢复
      restorable: meta !== null && typeof meta.originalDir === 'string' && meta.originalDir !== '',
    })
  }
  out.sort((a, b) => String(b.deletedAt || '').localeCompare(String(a.deletedAt || ''))) // 新删的在前
  return out
}

/** 恢复回收项到原始目录。原位置已被占用时拒绝（用户可选择彻底删除回收项）。 */
async function restoreTrashEntry(trashDir, id) {
  if (!validTrashId(id)) throw new Error('invalid trash id')
  const meta = await readTrashMeta(trashDir, id)
  if (meta === null) throw new Error(`trash entry '${id}' has no metadata; it cannot be restored`)
  if (typeof meta.originalDir !== 'string' || meta.originalDir === '') throw new Error('trash metadata missing originalDir')
  if (!(await pathExists(join(trashDir, id)))) throw new Error(`trash entry '${id}' not found`)
  if (await pathExists(meta.originalDir)) throw new Error(`restore target already exists: ${displayPath(meta.originalDir)}`)
  await fsP.mkdir(join(meta.originalDir, '..'), { recursive: true })
  await movePath(join(trashDir, id), meta.originalDir)
  await fsP.rm(join(trashDir, id + '.json'), { force: true })
  return { id, name: meta.name, executorKey: meta.executorKey, dir: meta.originalDir }
}

async function deleteTrashEntry(trashDir, id) {
  if (!validTrashId(id)) throw new Error('invalid trash id')
  if (!(await pathExists(join(trashDir, id))) && !(await pathExists(join(trashDir, id + '.json')))) throw new Error(`trash entry '${id}' not found`)
  await fsP.rm(join(trashDir, id), { recursive: true, force: true })
  await fsP.rm(join(trashDir, id + '.json'), { force: true })
  return { deleted: id }
}

async function emptyTrash(trashDir) {
  let entries
  try { entries = await fsP.readdir(trashDir) } catch { return { emptied: 0 } }
  let emptied = 0
  for (const name of entries) {
    await fsP.rm(join(trashDir, name), { recursive: true, force: true }).catch(() => {})
    emptied += 1
  }
  return { emptied }
}

/** 保留期清理：目录与配对 json 都以元数据 deletedAt 为准（缺失退回 mtime）。 */
async function purgeTrash(trashDir, retentionDays) {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return { purged: 0 }
  const cutoff = Date.now() - retentionDays * 24 * 3600 * 1000
  let entries
  try { entries = await fsP.readdir(trashDir) } catch { return { purged: 0 } }
  let purged = 0
  for (const name of entries) {
    const id = name.endsWith('.json') ? name.slice(0, -5) : name
    let when = 0
    const meta = await readTrashMeta(trashDir, id)
    if (meta !== null && typeof meta.deletedAt === 'string') when = Date.parse(meta.deletedAt) || 0
    if (!when) { try { when = (await fsP.lstat(join(trashDir, name))).mtimeMs } catch { continue } }
    if (when > cutoff) continue
    await fsP.rm(join(trashDir, name), { recursive: true, force: true }).catch(() => {})
    purged += 1
  }
  return { purged }
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

/** Clone (first time) or fetch+reset (update); remote branch is truth.
 *  `sparsePaths` (e.g. ['skills']) switches the checkout to sparse mode: fresh
 *  clones pass --filter=blob:none --sparse so only those subtrees download
 *  (the ntd-resource monorepo also carries experts/ + templates/, ~2x the
 *  skills payload); servers without filter support just warn and fall back to
 *  a full clone, which sparse-checkout still prunes. An existing full checkout
 *  is converted in place — the worktree prunes immediately, already-packed
 *  blobs stay (reachable from HEAD), so the big win is on fresh clones. */
async function gitSyncRepo(binary, url, branch, repoDir, token, sparsePaths) {
  const remote = authedUrl(url, token)
  const sparse = Array.isArray(sparsePaths) && sparsePaths.length > 0 ? sparsePaths : undefined
  let repoExists = false
  try { await fsP.access(join(repoDir, '.git')); repoExists = true } catch { repoExists = false }
  if (!repoExists) {
    await fsP.rm(repoDir, { recursive: true, force: true })
    await fsP.mkdir(join(repoDir, '..'), { recursive: true })
    if (sparse) {
      await gitExec(binary, ['clone', '-b', branch, '--depth', '1', '--filter=blob:none', '--sparse', remote, repoDir])
      await gitExec(binary, ['sparse-checkout', 'set', '--cone', ...sparse], repoDir)
    } else {
      await gitExec(binary, ['clone', '-b', branch, '--depth', '1', remote, repoDir])
    }
    return { isFirstClone: true, hasUpdates: true, before: undefined, after: await gitCurrentCommit(binary, repoDir) }
  }
  // Migrate a pre-sparse full checkout in place (idempotent no-op once sparse).
  if (sparse) {
    try { await gitExec(binary, ['sparse-checkout', 'set', '--cone', ...sparse], repoDir) }
    catch (e) { console.warn(`skills-management: sparse-checkout conversion failed, continuing full: ${e && e.message}`) }
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
  // 市场货架默认只进设置页浏览/安装，不进宿主 `/` 技能注册表——数千条
  // 「仅用户」候选会把 slash 菜单刷爆。false = 只保留已安装技能。
  publishMarket: false,
}

/** User-settings namespace persisted through the host ctx.settings service
 *  (local provider → $DSH_HOME/settings.yaml). Falls back to an in-memory
 *  override sheet when the service is absent (tests, minimal compositions). */
function marketSettingsSchema() {
  if (!Schema) return null
  return Schema.object({
    url: Schema.string(),
    branch: Schema.string(),
    gitBinary: Schema.string(),
    repoDir: Schema.string(),
    autoSync: Schema.boolean(),
    syncOnStartup: Schema.boolean(),
    publishMarket: Schema.boolean(),
    token: Schema.string(),
  })
}

// ── Executor（本机技能来源）运行时 sheet ─────────────────────────────────
// 内置表 EXECUTOR_DEFS + 约定自动发现永远是默认值，这份 sheet 只存用户增量
// （目录覆盖 / 停用 / 新增），所以「恢复默认」= 清空整个 sheet。与 cordis
// 静态配置（executorDirs/disabledExecutors/extraExecutors）的优先级：cordis 最高。
function executorSettingsSchema() {
  if (!Schema) return null
  return Schema.object({
    dirs: Schema.dict(Schema.string()),      // 内置 key → 目录覆盖（dsh 锁定不接受）
    disabled: Schema.array(Schema.string()), // 停用的内置 key
    extra: Schema.array(Schema.object({      // 用户新增执行器
      key: Schema.string(),
      label: Schema.string(),
      dir: Schema.string(),
    })),
  })
}
const EXECUTOR_SHEET_DEFAULTS = Object.freeze({ dirs: {}, disabled: [], extra: [] })

// ── 0.1.7 settings 接线 ──
// settings 服务不再支持 ctx.settings.register（且一条插件 entry 只有一个 id）：
// 两个旧 scope（market / executors）合并为模块顶层导出的一个 volatile Config，
// marketSync / executorSheet 各为一个 volatile 子对象——volatile 节点的整棵子树
// 都可被设置 UI 投影与 ctx.settings.update 写回。读走 describe() 投影，写走
// ctx.settings.update('skills-management', { marketSync | executorSheet: … })，
// 持久化进 profile patch（重启不丢）。marketRepoDir 为旧版平铺配置兼容位。
let Config = null
try {
  // 兼容位（config.marketRepoDir）不进 Config——纯字符串字段经宿主投影会物化成
  // {}，反而毒化配置；patch 里的未知键本来就能透传，baseSettings 直接读即可。
  Config = Schema
    ? Schema.object({
      marketSync: marketSettingsSchema().volatile(),
      executorSheet: executorSettingsSchema().volatile(),
    })
    : null
} catch { /* schemastery <3.18.4 无 .volatile()：降级为无 Config（设置写回不可用），插件运行不受影响 */ }

// ── Share-run jobs: real execution via the official headless channel
// (`dsh --profile headless "<task>"`, cwd = the skill directory — the
// workspace, session and model loop are owned by that one-shot process). ──

function contentTypeFor(p) {
  const ext = p.slice(p.lastIndexOf('.') + 1).toLowerCase()
  const map = { md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8', json: 'application/json; charset=utf-8', js: 'text/javascript', mjs: 'text/javascript', ts: 'text/typescript', tsx: 'text/typescript', css: 'text/css', html: 'text/html', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', yaml: 'text/yaml', yml: 'text/yaml' }
  return map[ext]
}

module.exports = {
  name: 'skills-management',
  Config: Config ?? undefined,
  inject: ['skills', 'webServer', 'settings', 'agents', 'agentDefaultModel', 'sessions', 'connection'],
  __internals: { extractFrontmatter, parseSkillMd, invocationPolicy, installDirName, EXECUTOR_DEFS, usageStat, usageMemo, setUsageEncoderOverride: (v) => { usageEncoderOverride = v }, discoverSkillHomes, deriveAutoExecutors, keyFromDotDir, moveToTrash, listTrash, restoreTrashEntry, purgeTrash, validTrashId },

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
          : join(dshHome(), 'skills-management', 'market')))
    }
    const marketRoots = () => configMarketDirs !== undefined ? configMarketDirs : [join(effectiveRepoDir(), 'skills')]
    const marketDirs = marketRoots  // scan/install/locate call sites read through this
    // 稀疏检出子树：ntd-resource 仓库同时携带 experts/templates，只检 skills 一份省一半以上
    // 流量与磁盘。config.marketSparsePaths: null 关闭；自定义数组换目标子树。
    const marketSparsePaths = () => config.marketSparsePaths === null
      ? undefined
      : (Array.isArray(config.marketSparsePaths) && config.marketSparsePaths.length > 0 ? config.marketSparsePaths.map(String) : ['skills'])
    const installedDir = resolve(expandTilde(config.installedDir !== undefined ? config.installedDir : process.env.DSH_HOME ? join(process.env.DSH_HOME, 'skills') : join(homedir(), '.dsh', 'skills')))
    const providerName = config.providerName !== undefined ? config.providerName : 'ntd-skills'
    // 市场库存（数几千条）默认不进模型目录 available_skills —— 只作为可浏览/可安装的货架。
    // 装到用户库（installedDir）后才对模型可见。config.marketModelInvocable: true 可恢复旧行为。
    const marketModelInvocable = config.marketModelInvocable === true

    // ── Executor (on-machine source) rows ──
    // dsh first (its root is the installed library, locked); then known defs
    // minus disabled; then user extras. Rows are recomputed per request so
    // runtime edits (executor-settings API → settings.yaml) apply without a
    // restart. Per-key priority: cordis 静态配置 > runtime sheet > 默认表，
    // `executorDirs` overrides keep making scans testable without $HOME.
    const executorDirsOverride = config.executorDirs !== undefined && config.executorDirs !== null && typeof config.executorDirs === 'object' ? config.executorDirs : {}
    const disabledExecutors = new Set(Array.isArray(config.disabledExecutors) ? config.disabledExecutors : [])
    const cordisExtras = (Array.isArray(config.extraExecutors) ? config.extraExecutors : []).filter((e) => e !== null && typeof e === 'object')
    // 执行器根的归属家目录：默认 os.homedir()（Windows 下即 %USERPROFILE%）。
    // executorHomeDir 主要服务测试——把内置默认根与自动发现一起指到临时家目录。
    const executorHome = () => (config.executorHomeDir !== undefined ? resolve(expandTilde(String(config.executorHomeDir))) : homedir())
    // agents 共享池根：与 invocation 路由同款 DSH_AGENTS_HOME 解析，但家目录走
    // executorHome（测试可指到临时目录；生产二者同为 os.homedir()）。
    const agentsPoolRoot = () => process.env.DSH_AGENTS_HOME !== undefined && process.env.DSH_AGENTS_HOME !== ''
      ? join(resolve(expandTilde(process.env.DSH_AGENTS_HOME)), 'skills')
      : join(executorHome(), '.agents', 'skills')
    const autoDiscover = config.autoDiscoverExecutors !== false // 默认开：扫 ~/.xxx/skills
    const executorSettingsOverrides = {} // 进程内兜底：写回缺席/失败时保本次运行一致
    const runtimeSheet = () => {
      const doc = (liveSettings && typeof liveSettings === 'object') ? liveSettings : {}
      const raw = (doc.executorSheet && typeof doc.executorSheet === 'object') ? doc.executorSheet : executorSettingsOverrides
      const v = raw && typeof raw === 'object' ? raw : {}
      return {
        dirs: v.dirs !== null && typeof v.dirs === 'object' && !Array.isArray(v.dirs) ? v.dirs : {},
        disabled: Array.isArray(v.disabled) ? v.disabled : [],
        extra: Array.isArray(v.extra) ? v.extra : [],
      }
    }

    // ── 自动发现缓存：HTTP 路由入口一律 await refreshAutoRows()（每次请求
    // 对齐磁盘现状，并发去重）；同步路径（linkExecutorLabel 等）读最近一次缓存。
    // 失败保留旧缓存——一次 EACCES 不应清空已发现的来源。
    let autoCache = []
    let autoRefresh = null
    const refreshAutoRows = () => {
      if (autoRefresh === null) {
        autoRefresh = (async () => {
          if (!autoDiscover) { autoCache = []; return }
          const discovered = await discoverSkillHomes(executorHome())
          const sheet = runtimeSheet()
          const takenPaths = [installedDir] // dsh 行：根即安装库
          const takenKeys = []
          for (const def of EXECUTOR_DEFS) {
            takenKeys.push(def.key)
            if (def.key !== 'dsh' && def.sub !== undefined) takenPaths.push(join(executorHome(), ...def.sub.split('/')))
          }
          for (const extra of [...cordisExtras, ...sheet.extra]) {
            if (typeof extra.key !== 'string' || extra.key === '') continue
            if (typeof extra.dir !== 'string' || extra.dir === '') continue
            takenKeys.push(extra.key)
            takenPaths.push(resolve(expandTilde(extra.dir)))
          }
          autoCache = deriveAutoExecutors(discovered, takenPaths, takenKeys)
        })()
          .catch((e) => { ctx.logger.warn(`skills-management: auto-discover executors: ${e && e.message}`) })
          .finally(() => { autoRefresh = null })
      }
      return autoRefresh
    }

    const computeExecutorRows = () => {
      const sheet = runtimeSheet()
      const runtimeDisabled = new Set(sheet.disabled)
      const isDisabled = (key) => disabledExecutors.has(key) || runtimeDisabled.has(key)
      const rows = []
      const seen = new Set()
      // 生效根优先级：cordis executorDirs > 运行时 sheet 覆盖 > 默认（约定规则/显式 sub）
      const resolveRoot = (key, defaultRoot) => {
        if (executorDirsOverride[key] !== undefined) return resolve(expandTilde(String(executorDirsOverride[key])))
        if (typeof sheet.dirs[key] === 'string' && sheet.dirs[key] !== '') return resolve(expandTilde(sheet.dirs[key]))
        return defaultRoot
      }
      const pushExtra = (extra, locked) => {
        if (extra === null || typeof extra !== 'object') return
        if (typeof extra.key !== 'string' || extra.key === '') return
        if (typeof extra.dir !== 'string' || extra.dir === '') return
        if (seen.has(extra.key)) return
        seen.add(extra.key)
        rows.push({
          key: extra.key,
          label: typeof extra.label === 'string' && extra.label !== '' ? extra.label : extra.key,
          root: resolve(expandTilde(extra.dir)),
          readOnly: extra.readOnly === true,
          source: 'custom',
          locked: locked === true,
        })
      }
      const pushRow = (key, label, root, readOnly) => {
        if (root === undefined || isDisabled(key) || seen.has(key)) return
        seen.add(key)
        rows.push({ key, label, root, readOnly: readOnly === true, source: 'builtin', locked: key === 'dsh' })
      }
      // 内置（dsh + 约定外显式路径，行常驻）→ 自动发现（约定目录存在才有行；
      // 目录覆盖/停用照常作用于自动行）→ 自定义
      for (const def of EXECUTOR_DEFS) {
        pushRow(def.key, def.label, def.key === 'dsh'
          ? installedDir
          : resolveRoot(def.key, def.sub !== undefined ? join(executorHome(), ...def.sub.split('/')) : undefined), def.readOnly === true)
      }
      for (const row of autoCache) {
        if (seen.has(row.key)) continue // 防御：derive 已按当前 sheet 避开冲突
        if (isDisabled(row.key)) continue
        seen.add(row.key)
        rows.push({ ...row, root: resolveRoot(row.key, row.root) })
      }
      for (const extra of cordisExtras) pushExtra(extra, true)
      for (const extra of sheet.extra) pushExtra(extra, false)
      return rows
    }
    /** 管理面板投影：内置（dsh + 约定外，常驻）+ 自动发现（约定目录在才有行）
     *  + 自定义；停用的也列出（UI 置灰），带每行可编辑性标记。 */
    const executorSheetProjection = () => {
      const sheet = runtimeSheet()
      const runtimeDisabled = new Set(sheet.disabled)
      const executors = []
      // 内置/自动行共用：defaultDisplay 为该来源的默认目录展示串
      const pushRow = (key, label, defaultDisplay, source) => {
        const byConfig = executorDirsOverride[key] !== undefined
        const runtimeOverridden = typeof sheet.dirs[key] === 'string' && sheet.dirs[key] !== ''
        executors.push({
          key,
          label,
          source,
          locked: key === 'dsh',
          managedByConfig: byConfig,
          disabled: key !== 'dsh' && (disabledExecutors.has(key) || runtimeDisabled.has(key)),
          overridden: runtimeOverridden,
          defaultDir: defaultDisplay,
          dir: key === 'dsh'
            ? displayPath(installedDir)
            : byConfig ? displayPath(resolve(expandTilde(String(executorDirsOverride[key]))))
            : runtimeOverridden ? sheet.dirs[key]
            : defaultDisplay,
        })
      }
      for (const def of EXECUTOR_DEFS) {
        pushRow(def.key, def.label, def.key === 'dsh'
          ? displayPath(installedDir)
          : def.sub !== undefined ? '~/' + def.sub : '', 'builtin')
      }
      for (const row of autoCache) pushRow(row.key, row.label, displayPath(row.root), 'auto')
      for (const extra of cordisExtras) {
        if (typeof extra.key !== 'string' || extra.key === '' || typeof extra.dir !== 'string' || extra.dir === '') continue
        executors.push({ key: extra.key, label: typeof extra.label === 'string' && extra.label !== '' ? extra.label : extra.key, source: 'custom', locked: false, managedByConfig: true, disabled: false, dir: extra.dir })
      }
      for (const extra of sheet.extra) {
        if (extra === null || typeof extra !== 'object') continue
        if (typeof extra.key !== 'string' || extra.key === '' || typeof extra.dir !== 'string' || extra.dir === '') continue
        executors.push({ key: extra.key, label: typeof extra.label === 'string' && extra.label !== '' ? extra.label : extra.key, source: 'custom', locked: false, managedByConfig: false, disabled: false, dir: extra.dir })
      }
      return executors
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
     * 链接来源标注：技能目录是软链接时，把 realpath 目标匹配到某个执行器根
     * （最长前缀胜出），命中则给出该来源的 label（如 Agents），前端以此显示
     * 「链接 → Agents」而不是一串裸路径。执行器根先做 realpath——macOS 的
     * /var→/private/var 这类前缀软链接会让裸字符串比较失手。目标不在任何
     * 已知根内时返回 undefined，前端退回显示折叠后的目标路径。
     */
    const rootRealMemo = new Map()
    const realRoot = async (p) => {
      // 失败（路径尚不存在）不缓存——之后目录可能被创建（如首次迁入共享池），
      // 缓存否定结果会让后续的 realpath 前缀比较永久失手
      if (!rootRealMemo.has(p)) {
        const real = await fsP.realpath(p).catch(() => undefined)
        if (real === undefined) return p
        rootRealMemo.set(p, real)
      }
      return rootRealMemo.get(p)
    }
    const linkExecutorLabel = async (target) => {
      let best
      for (const r of computeExecutorRows()) {
        if (typeof r.root !== 'string' || r.root === '') continue
        const rp = await realRoot(resolve(r.root))
        if (target !== rp && !target.startsWith(rp + sep)) continue
        if (best === undefined || rp.length > best.rp.length) best = { rp, label: r.label }
      }
      return best ? best.label : undefined
    }
    /** 列表/详情共用的链接字段包；非链接返回空对象（JSON 里不出现这些键）。 */
    const linkFields = async (isLink, target) => isLink === true && typeof target === 'string'
      ? { isLink: true, linkTarget: displayPath(target), linkExecutor: await linkExecutorLabel(target) }
      : {}

    /**
     * One executor row → summary + flat skill list (ntd `discover_skills_for`).
     * With `countsOnly` the expensive per-skill dir walks are skipped and
     * `skills` stays undefined — callers get `skillCount` only.
     */
    async function scanExecutor(row, countsOnly = false) {
      const summary = { key: row.key, label: row.label, dir: displayPath(row.root), dirExists: false, readOnly: row.readOnly, source: row.source, locked: row.locked === true, skillCount: 0 }
      if (!countsOnly) summary.skills = []
      try { await fsP.access(row.root) } catch { return summary }
      summary.dirExists = true
      // 池行标记：客户端合并刷新时，池行的 skills 不能按计数保留——
      // 反向链接（linkedBy）变化不改变技能计数
      if (await isPoolRow(row)) summary.isPool = true
      for (const entry of await scanRoot(row.root)) {
        try {
          const read = await readSkillEntry(entry)
          // ntd naming: nested skill whose frontmatter name equals its dir
          // basename keeps the category path as display name.
          const listed = entry.relPath.includes('/') && read.name === basename(entry.dir) ? entry.relPath : read.name
          summary.skillCount += 1
          if (countsOnly) continue
          const { fileCount, totalSize } = await countFilesAndSize(entry.dir)
          summary.skills.push({ name: listed, relPath: entry.relPath, description: truncateDescription(read.description), keywords: read.keywords, version: read.version, author: read.author, fileCount, totalSize, modifiedAt: read.modifiedAt, modelInvocable: invocationPolicy(read.meta).modelInvocable, ...(await linkFields(entry.isLink, entry.linkTarget)), ...usageStat(listed, read.description) })
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
      return computeExecutorRows().find((row) => row.key === key)
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

    /**
     * 批量安装到其他执行器：把技能目录复制进每个目标来源的 skills 根。
     * 逐目标隔离结果（一个失败不拖累整批）。守卫：dsh 走默认安装按钮、
     * 只读来源拒绝、目标根不存在拒绝（不在没装该工具的机器上凭空造
     * ~/.xxx/skills）、目标已有同名技能且无 overwrite 拒绝。
     */
    async function installToExecutors(fullName, from, targets, overwrite) {
      let sourceDir
      if (typeof from === 'string' && from !== '' && from !== 'market') {
        const row = findExecutorRow(from)
        if (row === undefined) throw new Error(`unknown executor '${from}'`)
        sourceDir = await findDirUnderRoot(row.root, fullName, `${row.label} (${row.key})`)
      } else {
        for (const root of marketDirs()) {
          try { sourceDir = await resolveSkillDir(root, fullName); break }
          catch (e) { if (!String(e && e.message).includes('not found')) throw e }
        }
        if (sourceDir === undefined) throw new Error(`skill '${fullName}' not found in market`)
      }
      const shortName = installDirName(fullName)
      const results = []
      for (const key of targets) {
        const row = findExecutorRow(key)
        if (row === undefined) { results.push({ key, ok: false, error: `unknown executor '${key}'` }); continue }
        if (row.key === 'dsh') {
          // dsh 库是安装对话框的默认目标：走与默认安装按钮相同的 copyIntoLibrary
          //（自带已装守卫 + 注册表刷新）
          try {
            await copyIntoLibrary(sourceDir, shortName, overwrite)
            results.push({ key, ok: true, path: displayPath(join(installedDir, shortName)) })
          } catch (e) { results.push({ key, ok: false, error: String(e && e.message || e) }) }
          continue
        }
        if (row.readOnly) { results.push({ key, ok: false, error: 'read-only source' }); continue }
        if (!(await pathExists(row.root))) { results.push({ key, ok: false, error: `directory not found: ${displayPath(row.root)}` }); continue }
        const target = join(row.root, shortName)
        if (await pathExists(target)) {
          if (!overwrite) { results.push({ key, ok: false, error: `already exists: ${displayPath(target)}` }); continue }
          // 覆盖 = 旧版进回收站再放新版（与删除语义一致，可恢复）
          if (trashEnabled) await moveToTrash(trashDir, target, shortName, row.key)
          else await fsP.rm(target, { recursive: true, force: true })
        }
        try {
          await copyDir(sourceDir, target)
          results.push({ key, ok: true, path: displayPath(target) })
        } catch (e) { results.push({ key, ok: false, error: String(e && e.message || e) }) }
      }
      return results
    }

    async function deleteSkill(name, executorKey) {
      if (!validSkillName(name)) throw new Error('invalid skill name')
      const key = executorKey === undefined || executorKey === null || executorKey === '' ? 'dsh' : executorKey
      const row = findExecutorRow(key)
      if (row === undefined) throw new Error(`unknown executor '${key}'`)
      if (row.readOnly) throw new Error(`source '${key}' is read-only; cannot delete skills there`)
      const target = await resolveSkillDirByName(row.root, name)
      if (target === undefined) throw new Error(`skill '${name}' not found in ${row.label} (${row.key})`)
      // 删除 = 移入回收站（可恢复/彻底删除）；config.trash === false 恢复旧的永久删除
      const meta = trashEnabled
        ? await moveToTrash(trashDir, target, name, row.key)
        : (await fsP.rm(target, { recursive: true }), null)
      if (key === 'dsh') invalidate()
      return meta !== null ? { removed: name, executor: key, trashId: meta.id } : { removed: name, executor: key }
    }

    /**
     * 迁移到 agents 共享池：实体目录移入 <pool>/<目录 basename>，原位置留链接
     * （Windows 建 junction——不需要管理员权限；POSIX 建 dir symlink）。守卫：
     * 只读来源 / 已是链接 / 已在池里 / 池里同名已存在，一律拒绝不静默覆盖。
     * 建链失败尽力把目录移回原位（回滚失败则抛原始错误，日志留痕）。
     */
    async function migrateToPool(name, executorKey) {
      if (!validSkillName(name)) throw new Error('invalid skill name')
      const key = executorKey === undefined || executorKey === null || executorKey === '' ? 'dsh' : executorKey
      const row = findExecutorRow(key)
      if (row === undefined) throw new Error(`unknown executor '${key}'`)
      if (row.readOnly) throw new Error(`source '${key}' is read-only; cannot migrate skills there`)
      const sourceDir = await resolveSkillDirByName(row.root, name)
      if (sourceDir === undefined) throw new Error(`skill '${name}' not found in ${row.label} (${row.key})`)
      if ((await fsP.lstat(sourceDir)).isSymbolicLink()) throw new Error(`skill '${name}' is already a link; nothing to migrate`)
      const pool = agentsPoolRoot()
      const realPool = await realRoot(pool)
      const realSource = await fsP.realpath(sourceDir)
      if (realSource === realPool || realSource.startsWith(realPool + sep)) throw new Error(`skill '${name}' is already in the agents pool`)
      const target = join(pool, basename(sourceDir))
      if (await pathExists(target)) throw new Error(`pool already has '${basename(sourceDir)}': ${displayPath(target)}`)
      await fsP.mkdir(pool, { recursive: true })
      await movePath(sourceDir, target)
      try {
        await fsP.symlink(target, sourceDir, process.platform === 'win32' ? 'junction' : 'dir')
      } catch (e) {
        await movePath(target, sourceDir).catch((rollback) => ctx.logger.warn(`skills-management: migrate rollback failed: ${rollback && rollback.message}`))
        throw e
      }
      if (key === 'dsh') invalidate()
      return { name, executor: key, poolDir: displayPath(target), link: displayPath(sourceDir) }
    }

    /** 该行的根是否就是 agents 共享池（realpath 比较，含自定义行指向池的情形）。 */
    const isPoolRow = async (row) => typeof row.root === 'string' && row.root !== ''
      && (await realRoot(resolve(row.root))) === (await realRoot(agentsPoolRoot()))

    /**
     * 反向链接索引：池里每个技能目录（realpath）→ 链接它的来源 Map<key, relPath>。
     * relPath 是链接条目在那个来源根下的相对路径（可能与池内名不同，删除该链接
     * 需要按它寻址）。扫全部其它来源根，收集 realpath 落在池内的链接条目；
     * 链接目标在扫描期已解析（scanSkillDirs 的 linkTarget），这里只做前缀归属。
     */
    async function poolBacklinks(realPool) {
      const byTarget = new Map()
      for (const other of computeExecutorRows()) {
        if (typeof other.root !== 'string' || other.root === '') continue
        if ((await realRoot(resolve(other.root))) === realPool) continue // 池自身不算链接者
        for (const entry of await scanRoot(other.root)) {
          if (entry.isLink !== true || typeof entry.linkTarget !== 'string') continue
          if (entry.linkTarget !== realPool && !entry.linkTarget.startsWith(realPool + sep)) continue
          let set = byTarget.get(entry.linkTarget)
          if (set === undefined) { set = new Map(); byTarget.set(entry.linkTarget, set) }
          if (!set.has(other.key)) set.set(other.key, entry.relPath)
        }
      }
      return byTarget
    }

    /** 给池行的技能列表挂 linkedBy：[{ key, name（链接在该来源下的 relPath） }]，按 key 排序。 */
    const attachBacklinks = async (row, skills) => {
      const byTarget = await poolBacklinks(await realRoot(resolve(row.root)))
      for (const s of skills) {
        const set = byTarget.get(await realRoot(join(row.root, s.relPath)))
        if (set !== undefined && set.size > 0) {
          s.linkedBy = [...set.entries()].map(([key, name]) => ({ key, name })).sort((a, b) => (a.key < b.key ? -1 : 1))
        }
      }
    }

    // ── Market sync state (persisted next to the repo root) ──
    const marketStateFile = join(resolve(installedDir, '..'), 'skills-market-sync.json')
    // 回收站：默认 <installedDir>/../skills-management/trash（与所有被扫描根平级）。
    // config.trashDir 覆盖；config.trashRetentionDays 保留天数（默认 30，0/null = 永久保留）；
    // config.trash === false 整体关闭（退回永久删除）。
    const trashEnabled = config.trash !== false
    const trashDir = config.trashDir !== undefined
      ? resolve(expandTilde(String(config.trashDir)))
      : join(resolve(installedDir, '..'), 'skills-management', 'trash')
    const trashRetentionDays = config.trashRetentionDays === null || config.trashRetentionDays === 0
      ? Infinity
      : (typeof config.trashRetentionDays === 'number' && config.trashRetentionDays > 0 ? config.trashRetentionDays : DEFAULT_TRASH_RETENTION_DAYS)
    let marketState = { lastSyncAt: undefined, lastResult: undefined }
    // User-facing settings live in the host settings service when present;
    // the local json only carries runtime sync bookkeeping.
    const settingsOverrides = {}  // 进程内兜底（market 同步设置）
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
            if (ctx.settings && typeof ctx.settings.update === 'function') {
              try {
                await ctx.settings.update('skills-management', { marketSync: legacy })
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
      for (const key of ['url', 'branch', 'gitBinary', 'autoSync', 'syncOnStartup', 'publishMarket']) {
        if (cfg[key] !== undefined) base[key] = cfg[key]
      }
      // 0.1.7 config 回写/投影可能给出 null 等非字符串值：类型不对就走默认，别让激活崩掉
      if (config.marketRepoDir !== undefined && config.marketRepoDir !== null && typeof config.marketRepoDir === 'string' && config.marketRepoDir !== '') {
        base.repoDir = resolve(expandTilde(config.marketRepoDir))
      }
      return base
    }
    function readDescriptor() {
      try {
        if (!ctx.settings || typeof ctx.settings.describe !== 'function') return null
        return ctx.settings.describe().find((x) => x.ns === 'skills-management') || null
      } catch { return null }
    }
    let liveSettings = {} // settings 文档实时值（document-updated 事件驱动刷新）
    // apply 时 loader 可能尚未就绪（describe 投影里还没有本插件条目），间隔重试
    function refreshLive(attempt = 0) {
      const d = readDescriptor()
      if (d) {
        if (d.value && typeof d.value === 'object') liveSettings = d.value
        return
      }
      if (attempt < 15) setTimeout(() => { refreshLive(attempt + 1) }, 2000).unref?.()
    }
    refreshLive()

    // settings 文档变更（dsh 自动生成的设置页、本插件面板写回）刷新实时值
    try {
      if (ctx.on && typeof ctx.on === 'function') {
        ctx.effect(() => {
          const off = ctx.on('settings/document-updated', (ns) => {
            if (ns !== 'skills-management') return
            const d = readDescriptor()
            if (d && d.value && typeof d.value === 'object') liveSettings = d.value
          })
          return () => { try { off() } catch {} }
        }, 'skills-management: settings watch')
      }
    } catch { /* 事件订阅不可用：写回后靠 overrides 维持本次运行 */ }
    const saveMarketState = async () => {
      // 0600: the state file may carry the access token
      try { await fsP.writeFile(marketStateFile, JSON.stringify(marketState, null, 2), { mode: 0o600 }) } catch {}
      try { await fsP.chmod(marketStateFile, 0o600) } catch {}
    }
    const marketSettings = () => {
      const doc = (liveSettings && typeof liveSettings === 'object') ? liveSettings : {}
      const docSync = (doc.marketSync && typeof doc.marketSync === 'object') ? doc.marketSync : {}
      const out = { ...baseSettings(), ...docSync, ...settingsOverrides }
      if (doc.marketRepoDir !== undefined && doc.marketRepoDir !== null && doc.marketRepoDir !== '') {
        out.repoDir = resolve(expandTilde(String(doc.marketRepoDir)))
      }
      return out
    }

    let marketSyncRun = null
    // 注入开销预热：后台把市场技能的 token 统计预先算进 usageStat 的 memo
    // （分块让出事件循环），避免首次打开市场列表时同步编码 6400 条描述
    // （~3s）拖慢首屏。市场同步会改内容，成功路径末尾再次触发。
    let usageWarmSeq = 0
    const warmUsageMemo = async () => {
      const seq = ++usageWarmSeq
      if (usageEncoderLazy() === null) return // 降级模式 memo 永远不命中，预热扫描是纯浪费
      try {
        const { market } = await discoverAll()
        for (let i = 0; i < market.length; i++) {
          if (seq !== usageWarmSeq) return
          usageStat(market[i].name, market[i].description)
          if (i % 500 === 499) await new Promise((r) => setImmediate(r))
        }
      } catch { /* 预热是尽力而为：miss 的条目由列表路由现算兜底 */ }
    }
    const runMarketSync = async () => {
      if (marketSyncRun !== null) return marketSyncRun
      marketSyncRun = (async () => {
        await marketStateLoaded
        const eff = marketSettings()
        const ok = await gitAvailable(eff.gitBinary)
        if (!ok) throw new Error('git is not available on PATH')
        const started = Date.now()
        const repoDir = effectiveRepoDir()
        const result = await gitSyncRepo(eff.gitBinary, eff.url, eff.branch, repoDir, eff.token, marketSparsePaths())
        marketState.lastSyncAt = new Date().toISOString()
        marketState.lastResult = { ...result, at: marketState.lastSyncAt, durationMs: Date.now() - started }
        await saveMarketState()
        invalidate()
        warmUsageMemo()
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

    // 激活后延迟预热 token 统计（给启动路径让路；unref 不拖住退出）
    ctx.effect(() => {
      const timer = setTimeout(() => { warmUsageMemo() }, 3000)
      if (typeof timer.unref === 'function') timer.unref()
      return () => { usageWarmSeq += 1; clearTimeout(timer) }
    }, 'skills-management: usage memo warm-up')

    // 启动即扫一次约定目录，让同步路径（linkExecutorLabel）在首个请求前就有缓存
    refreshAutoRows()

    // 启动清理过期回收项（读列表时也会惰性清理）
    ctx.effect(() => {
      if (trashEnabled) purgeTrash(trashDir, trashRetentionDays).catch((e) => ctx.logger.warn(`skills-management: trash purge: ${e && e.message}`))
      return () => {}
    }, 'skills-management: trash purge')

    const shareRunJobs = new Map()
    // Same-process Agent services（静态注入：apply 时已就绪；动态 ctx.inject 在
    // apply 内不触发是平台 gotcha）。
    const shareServices = { agents: ctx.agents, agentDefaultModel: ctx.agentDefaultModel, sessions: ctx.sessions }
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
          // 市场货架默认不进宿主注册表（publishMarket: false）：数千条候选会把
          // `/` 菜单刷爆，且它们本就不该进模型目录。设置页浏览/安装不受影响。
          if (marketSettings().publishMarket !== false) {
            for (const row of market) {
              const why = isValid(row)
              if (why !== undefined) {
                ctx.logger.warn(`skills-management: skipping market skill '${row.entry.relPath}': ${why}`)
                continue
              }
              const shortName = row.name.includes('/') ? row.name.split('/').pop() : row.name
              if (installed.some((e) => e.name === shortName)) continue
              candidates.push(toCandidate(row, 'market', RANK_MARKET, { modelInvocable: marketModelInvocable }))
            }
          }
          return candidates
        },
        async get(candidate) {
          const entry = candidate.locator
          try {
            const row = await readSkillEntry({ ...entry, stat: entry.stat ?? (await fsP.stat(join(entry.dir, 'SKILL.md'))) })
            const invocation = candidate.source === 'market' && !marketModelInvocable
              ? { modelInvocable: false, userInvocable: true }
              : invocationPolicy(row.meta)
            return { name: row.name, description: row.description, whenToUse: typeof row.meta.whenToUse === 'string' ? row.meta.whenToUse : undefined, invocation, source: candidate.source, provider: providerName, resourceBase: { kind: 'directory', path: entry.dir }, content: row.body, path: join(entry.dir, 'SKILL.md'), metadata: row.meta }
          } catch { return undefined }
        },
      }
    })

    // `invocationOverride.modelInvocable` 为 false 时该候选不进模型目录（available_skills），
    // 但保留 userInvocable（UI 浏览 / 用户命令调用不受影响）。
    function toCandidate(row, source, rank, invocationOverride) {
      const base = invocationPolicy(row.meta)
      const invocation = invocationOverride ? { ...base, ...invocationOverride } : base
      return { name: row.name, description: row.description, invocation, source, provider: providerName, rank, locator: { dir: row.entry.dir, root: row.entry.root, relPath: row.entry.relPath, stat: row.entry.stat }, path: join(row.entry.dir, 'SKILL.md'), metadata: row.meta, whenToUse: typeof row.meta.whenToUse === 'string' ? row.meta.whenToUse : undefined, resourceBase: { kind: 'directory', path: row.entry.dir } }
    }

    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: '/skills-management/api',
      handler: async (req, res) => {
        try {
          // 与其它 host 路由一致的信任栅栏：connection 服务的 Host/Origin 检查
          // 加浏览器认证。缺了它，下面每个路由都能被任意网页跨站调用。
          const rejection = ctx.connection.requestRejection(req)
          if (rejection !== undefined) {
            res.writeHead(rejection)
            res.end()
            return
          }
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
              publishMarket: eff.publishMarket !== false,
              hasToken: typeof eff.token === 'string' && eff.token !== '',
              syncing: marketSyncRun !== null,
              sparsePaths: marketSparsePaths() ?? null,
              settingsFile: join(dshHome(), 'settings.yaml'),
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

          // PUT /skills-management/api/market/settings {url?, branch?, autoSync?, syncOnStartup?, publishMarket?}
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
            let clearToken = false
            if (typeof body.token === 'string' && body.token !== '') patch.token = body.token
            if (body.token === null || body.token === '') clearToken = true
            if (typeof body.repoDir === 'string' && body.repoDir !== '') {
              patch.repoDir = resolve(expandTilde(body.repoDir))
            }
            for (const key of ['autoSync', 'syncOnStartup', 'publishMarket']) {
              if (typeof body[key] === 'boolean') patch[key] = body[key]
            }
            if (clearToken) delete settingsOverrides.token
            else Object.assign(settingsOverrides, patch)
            // 0.1.7 持久化：平铺 patch 挂进 marketSync: 子对象；token 清空走 mutate.unset
            if (ctx.settings && typeof ctx.settings.update === 'function') {
              try {
                if (Object.keys(patch).length > 0) await ctx.settings.update('skills-management', { marketSync: patch })
                if (clearToken) await ctx.settings.mutate('skills-management', [{ op: 'unset', path: ['marketSync', 'token'] }])
              } catch (e) { ctx.logger.warn(`skills-management: settings update 失败（仅本次运行生效）: ${e && e.message}`) }
            }
            // publishMarket 直接决定 provider.list() 的候选集合，改完立刻让
            // `/` 菜单重读注册表，不必等 skills/change 或重启。
            if ('publishMarket' in patch) invalidate()
            const eff = marketSettings()
            const { token, ...safe } = eff  // token 只写不回读
            sendJson(res, 200, { settings: safe, hasToken: typeof token === 'string' && token !== '', settingsFile: join(dshHome(), 'settings.yaml') })
            return
          }

          // GET /skills-management/api/executor-settings → 执行器目录管理面板：
          // 全部内置（停用的也在，UI 置灰）+ 自动发现 + 自定义，带每行可编辑性标记。
          if (req.method === 'GET' && apiPath.endsWith('/skills-management/api/executor-settings')) {
            await refreshAutoRows()
            sendJson(res, 200, { executors: executorSheetProjection(), settingsFile: join(dshHome(), 'settings.yaml') })
            return
          }

          // PUT /skills-management/api/executor-settings — body 就是下一份运行时
          // sheet {dirs, disabled, extra}。走 replace 整体替换（update 深合并
          // 删不掉 dict 里的键，恢复默认/删除行都需要整体覆写）；校验失败抛错 →
          // 外层 catch 回 400，持久化发生在校验通过之后。
          if (req.method === 'PUT' && apiPath.endsWith('/skills-management/api/executor-settings')) {
            const body = await readJsonBody(req)
            await refreshAutoRows() // 校验 disabled/extra 需要当前自动发现的 key 集合
            const dirs = {}
            if (body.dirs !== undefined && body.dirs !== null) {
              if (typeof body.dirs !== 'object' || Array.isArray(body.dirs)) throw new Error('dirs must be an object of executor key → directory')
              // 可覆盖目录的 key = 内置 + 当前自动发现 + 已在 sheet 里的条目
              // （祖父条款：目录暂时不在也不应让整表保存 400）
              const knownDirs = new Set([...BUILTIN_KEYS, ...autoCache.map((r) => r.key), ...Object.keys(runtimeSheet().dirs)])
              for (const [key, value] of Object.entries(body.dirs)) {
                if (key === 'dsh') throw new Error("executor 'dsh' is locked: its root is the installed skill library")
                if (!knownDirs.has(key)) throw new Error(`unknown executor '${key}'`)
                if (typeof value !== 'string' || value.trim() === '') throw new Error(`dir for '${key}' must be a non-empty string`)
                dirs[key] = value.trim()
              }
            }
            const disabled = []
            if (body.disabled !== undefined && body.disabled !== null) {
              if (!Array.isArray(body.disabled)) throw new Error('disabled must be an array of executor keys')
              // 可停用的 key = 内置 + 当前自动发现 + 已在 sheet 里的条目（祖父条款：
              // 停用后目录被删，再次整表保存不应因「unknown executor」整单被拒）
              const knownDisabled = new Set([...BUILTIN_KEYS, ...autoCache.map((r) => r.key), ...runtimeSheet().disabled.map(String)])
              for (const item of body.disabled) {
                const key = String(item)
                if (key === 'dsh') throw new Error("executor 'dsh' cannot be disabled")
                if (!knownDisabled.has(key)) throw new Error(`unknown executor '${key}'`)
                disabled.push(key)
              }
            }
            const extra = []
            if (body.extra !== undefined && body.extra !== null) {
              if (!Array.isArray(body.extra)) throw new Error('extra must be an array of {key, label, dir}')
              for (const item of body.extra) {
                if (item === null || typeof item !== 'object') throw new Error('extra entries must be objects')
                const key = typeof item.key === 'string' ? item.key.trim() : ''
                if (!KEBAB_NAME_RE.test(key)) throw new Error(`executor key '${key || '(empty)'}' must be kebab-case (a-z 0-9 -)`)
                if (BUILTIN_KEYS.has(key) || autoCache.some((r) => r.key === key) || extra.some((e) => e.key === key)) throw new Error(`executor key '${key}' already exists`)
                if (typeof item.dir !== 'string' || item.dir.trim() === '') throw new Error(`dir for '${key}' must be a non-empty string`)
                extra.push({ key, label: typeof item.label === 'string' && item.label.trim() !== '' ? item.label.trim() : key, dir: item.dir.trim() })
              }
            }
            const section = { dirs, disabled, extra }
            Object.assign(executorSettingsOverrides, section)
            // 0.1.7 持久化：sheet 是全量提交，先 unset 再 set，避免深层 merge 残留已删除的键
            if (ctx.settings && typeof ctx.settings.update === 'function') {
              try {
                await ctx.settings.mutate('skills-management', [
                  { op: 'unset', path: ['executorSheet'] },
                  { op: 'set', path: ['executorSheet'], value: section },
                ])
              } catch (e) { ctx.logger.warn(`skills-management: executor sheet update 失败（仅本次运行生效）: ${e && e.message}`) }
            }
            await refreshAutoRows() // sheet 变化影响去重/停用，投影前重派生
            sendJson(res, 200, { executors: executorSheetProjection(), settingsFile: join(dshHome(), 'settings.yaml') })
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
            await refreshAutoRows()
            const scopeKey = query.get('executor')
            if (scopeKey !== null && scopeKey !== '') {
              const scoped = findExecutorRow(scopeKey)
              if (scoped === undefined) throw new Error(`unknown executor '${scopeKey}'`)
              const summary = await scanExecutor(scoped)
              // 池行钻取：给每个技能挂 linkedBy（哪些来源链接了它）
              if (summary.skills !== undefined && (await isPoolRow(scoped))) await attachBacklinks(scoped, summary.skills)
              sendJson(res, 200, { executor: summary })
              return
            }
            const countsOnly = query.get('mode') === 'summary'
            const executors = []
            for (const row of computeExecutorRows()) executors.push(await scanExecutor(row, countsOnly))
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
              market: market.map((row) => ({ name: row.entry.relPath, shortName: row.name, source: row.entry.relPath.split('/')[0], description: truncateDescription(row.description), keywords: row.keywords, version: row.version, installed: installedNames.has(row.name), totalSize: 0, ...usageStat(row.name, row.description) })),
              installed: await Promise.all(installed.map(async (row) => { const { fileCount, totalSize } = await countFilesAndSize(row.entry.dir); return { name: row.name, description: truncateDescription(row.description), path: row.entry.dir, fileCount, totalSize, modifiedAt: row.modifiedAt, ...usageStat(row.name, row.description) } })),
            })
            return
          }

          // GET /skills-management/api/detail?name=&executor= → detail
          if (req.method === 'GET' && apiPath.endsWith('/skills-management/api/detail')) {
            await refreshAutoRows()
            const name = query.get('name') || ''
            const located = await locateNamedSkillDir(name, query.get('executor'))
            const content = await fsP.readFile(join(located.dir, 'SKILL.md'), 'utf8')
            const files = await walkFiles(located.dir, located.dir)
            const { fileCount, totalSize } = await countFilesAndSize(located.dir)
            const { meta, body } = parseSkillMd(content)
            const usage = usageStat(typeof meta.name === 'string' && meta.name !== '' ? meta.name : basename(name), meta.description)
            // 详情同样标注软链接（列表行经 scanRoot 自带；这里按定位到的目录现查）
            let linked = false, linkReal
            try {
              const lst = await fsP.lstat(located.dir)
              if (lst.isSymbolicLink()) { linked = true; linkReal = await fsP.realpath(located.dir) }
            } catch {}
            // 是否已在 agents 共享池内（realpath 比较，链接技能按目标算）+ 池根展示路径
            const pool = agentsPoolRoot()
            const realPool = await realRoot(pool)
            const realDir = linked && linkReal !== undefined ? linkReal : await fsP.realpath(located.dir).catch(() => resolve(located.dir))
            const inPool = realDir === realPool || realDir.startsWith(realPool + sep)
            sendJson(res, 200, { name, shortName: basename(name), dir: displayPath(located.dir), executor: located.executorKey, isInstalled: located.isInstalled, ...(await linkFields(linked, linkReal)), inPool, poolDir: displayPath(pool), content: body, contentWithMeta: content, meta, files, fileCount, totalSize, modifiedAt: files[0]?.modifiedAt, ...usage })
            return
          }

          // GET /skills-management/api/file?name=&path=&executor= → file content
          if (req.method === 'GET' && apiPath.endsWith('/skills-management/api/file')) {
            await refreshAutoRows()
            const name = query.get('name') || '', filePath = query.get('path') || ''
            const located = await locateNamedSkillDir(name, query.get('executor'))
            await sendSkillFile(res, located.dir, filePath, contentTypeFor(filePath))
            return
          }

          // POST /skills-management/api/install {name, from?, overwrite?}
          if (req.method === 'POST' && apiPath.endsWith('/skills-management/api/install')) {
            const body = await readJsonBody(req)
            await refreshAutoRows()
            if (typeof body.name !== 'string' || body.name === '') { sendJson(res, 400, { error: 'body must provide name' }); return }
            const result = typeof body.from === 'string' && body.from !== '' && body.from !== 'market'
              ? await installFromExecutor(body.from, body.name, body.overwrite === true)
              : await installMarketSkill(body.name, body.overwrite === true)
            sendJson(res, 201, { installed: { ...result, from: typeof body.from === 'string' && body.from !== '' && body.from !== 'market' ? body.from : 'market' } })
            return
          }

          // POST /skills-management/api/migrate-to-pool {name, executor?} → 移入 agents
          // 共享池并在原位置留链接（executor 缺省 = dsh 用户库）
          if (req.method === 'POST' && apiPath.endsWith('/skills-management/api/migrate-to-pool')) {
            const body = await readJsonBody(req)
            await refreshAutoRows()
            if (typeof body.name !== 'string' || body.name === '') { sendJson(res, 400, { error: 'body must provide name' }); return }
            sendJson(res, 200, { migrated: await migrateToPool(body.name, typeof body.executor === 'string' ? body.executor : undefined) })
            return
          }

          // POST /skills-management/api/install-to {name, from?, targets[], overwrite?}
          // → 批量安装到其他执行器的 skills 目录（逐目标隔离结果）
          if (req.method === 'POST' && apiPath.endsWith('/skills-management/api/install-to')) {
            const body = await readJsonBody(req)
            await refreshAutoRows()
            if (typeof body.name !== 'string' || body.name === '') { sendJson(res, 400, { error: 'body must provide name' }); return }
            if (!Array.isArray(body.targets) || body.targets.length === 0) { sendJson(res, 400, { error: 'body must provide a non-empty targets array' }); return }
            const results = await installToExecutors(body.name, typeof body.from === 'string' ? body.from : undefined, body.targets.map(String), body.overwrite === true)
            sendJson(res, 200, { results })
            return
          }

          // DELETE /skills-management/api {name, executor?} → 移入回收站（响应带 trashId）
          if (req.method === 'DELETE' && apiPath.endsWith('/skills-management/api')) {
            const body = await readJsonBody(req)
            await refreshAutoRows()
            if (typeof body.name !== 'string' || body.name === '') { sendJson(res, 400, { error: 'body must provide name' }); return }
            sendJson(res, 200, await deleteSkill(body.name, typeof body.executor === 'string' ? body.executor : undefined))
            return
          }

          // GET /skills-management/api/trash → 回收站列表（先惰性清理过期项）
          if (req.method === 'GET' && apiPath.endsWith('/skills-management/api/trash')) {
            if (!trashEnabled) { sendJson(res, 200, { enabled: false, entries: [] }); return }
            await purgeTrash(trashDir, trashRetentionDays)
            const entries = await listTrash(trashDir)
            sendJson(res, 200, {
              enabled: true,
              entries: entries.map((e) => ({ ...e, originalDir: e.originalDir === '' ? '' : displayPath(e.originalDir) })),
              retentionDays: Number.isFinite(trashRetentionDays) ? trashRetentionDays : null,
              trashDir: displayPath(trashDir),
            })
            return
          }

          // POST /skills-management/api/trash/restore { id } → 恢复到原始目录
          if (req.method === 'POST' && apiPath.endsWith('/skills-management/api/trash/restore')) {
            const body = await readJsonBody(req)
            if (!trashEnabled) { sendJson(res, 400, { error: 'trash is disabled' }); return }
            if (typeof body.id !== 'string' || body.id === '') { sendJson(res, 400, { error: 'body must provide id' }); return }
            const restored = await restoreTrashEntry(trashDir, body.id)
            if (restored.executorKey === 'dsh') invalidate() // 回库 → 注册表刷新
            sendJson(res, 200, { restored: { ...restored, dir: displayPath(restored.dir) } })
            return
          }

          // DELETE /skills-management/api/trash { id } 彻底删除单个；{ all: true } 清空
          if (req.method === 'DELETE' && apiPath.endsWith('/skills-management/api/trash')) {
            const body = await readJsonBody(req)
            if (!trashEnabled) { sendJson(res, 400, { error: 'trash is disabled' }); return }
            if (body.all === true) { sendJson(res, 200, await emptyTrash(trashDir)); return }
            if (typeof body.id !== 'string' || body.id === '') { sendJson(res, 400, { error: 'body must provide id (or all: true)' }); return }
            sendJson(res, 200, await deleteTrashEntry(trashDir, body.id))
            return
          }

          // PUT /skills-management/api/invocation {name, modelInvocable} → 治理键开关
          // dsh 原生 frontmatter 键（docs/subsystems/skills.md）：disable-model-invocation。
          // 解析范围：用户库（dsh）优先，找不到再查 ~/.agents/skills——dsh 的
          // skill-filesystem 把 user-agents 作为内置根全量扫进模型目录，这个开关
          // 同样管得住它们（其他键原样保留；写完靠宿主 watcher 失效，无需 invalidate）。
          if (req.method === 'PUT' && apiPath.endsWith('/skills-management/api/invocation')) {
            const body = await readJsonBody(req)
            if (typeof body.name !== 'string' || body.name === '') { sendJson(res, 400, { error: 'body must provide name' }); return }
            if (typeof body.modelInvocable !== 'boolean') { sendJson(res, 400, { error: 'body must provide modelInvocable boolean' }); return }
            // 与 dsh skill-filesystem 的 user-agents 根同款解析
            const agentsSkillsRoot = process.env.DSH_AGENTS_HOME !== undefined && process.env.DSH_AGENTS_HOME !== ''
              ? join(resolve(expandTilde(process.env.DSH_AGENTS_HOME)), 'skills')
              : join(homedir(), '.agents', 'skills')
            let skillDir
            let rootKey = 'dsh'
            try { skillDir = await resolveSkillDir(installedDir, body.name) }
            catch { skillDir = await resolveSkillDir(agentsSkillsRoot, body.name); rootKey = 'agents' }
            const file = join(skillDir, 'SKILL.md')
            const updated = setModelInvocable(await fsP.readFile(file, 'utf8'), body.modelInvocable)
            await atomicWriteJs(file, updated)
            invalidate()
            sendJson(res, 200, { name: body.name, modelInvocable: body.modelInvocable, root: rootKey })
            return
          }

          sendJson(res, 404, { error: 'not found' })
        } catch (error) { sendJson(res, 400, { error: String(error && error.message || error) }) }
      },
    }), 'skills-management: api route')
  },
}
