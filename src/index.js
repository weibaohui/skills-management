'use strict'

/**
 * dsh-plugin-skills-management — Host half
 *
 * ntd skill marketplace for dsh: reads the ntd bundled skill collection
 * (`~/.ntd/bundled/skills` by default — a directory tree of GitHub skill
 * repos, one skill per directory holding a SKILL.md), serves it plus the
 * user's installed
 * library over an HTTP API under `/skills-management/api`, and registers a
 * `ctx.skills` provider so every listed skill is callable through the dsh
 * `skill` tool. Install copies a market skill directory into the user
 * library; delete removes it. The market tree is read-only.
 *
 * Zero `@deepseek-ai/dsh-*` imports: harness capabilities are reached
 * through `ctx.*` runtime services (`skills`, `webServer`). Runtime
 * dependencies are plain npm packages (yaml).
 */

const { createReadStream } = require('node:fs')
const fs = require('node:fs/promises')
const { basename, dirname, join, relative, resolve, sep } = require('node:path')
const { homedir } = require('node:os')
const YAML = require('yaml')

/** Default market roots: the ntd bundled collection checked out on disk. */
const DEFAULT_MARKET_DIRS = [join(homedir(), '.ntd', 'bundled', 'skills')]

/** Subdirectories never descended into while scanning a market root. */
const MARKET_SCAN_SKIP = new Set(['.git', 'node_modules'])

/** Registry rank: installed skills shadow same-named market skills. */
const RANK_INSTALLED = 100
const RANK_MARKET = 500

/** Maximum request body the API accepts (install/delete payloads). */
const MAX_BODY_BYTES = 64 * 1024

/** Extract YAML frontmatter: `---` must open and close on its own line. */
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

/** Parse one SKILL.md into `{ meta, body }`; frontmatter is optional. */
function parseSkillMd(content) {
  const yamlText = extractFrontmatter(content)
  if (yamlText === undefined) return { meta: {}, body: content }
  let meta = {}
  try {
    const parsed = YAML.parse(yamlText)
    if (parsed !== null && typeof parsed === 'object') meta = parsed
  } catch {
    // A malformed frontmatter block still leaves the body usable.
  }
  // The body is everything after the closing `---` line; recompute it from
  // the line structure instead of string offsets so YAML content can never
  // shift the split.
  const lines = content.split(/\r?\n/)
  let closer = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') {
      closer = index
      break
    }
  }
  const body = closer >= 0 ? lines.slice(closer + 1).join('\n').replace(/^\r?\n/, '') : content
  return { meta, body }
}

/**
 * One discovered skill directory. `root` is the scan root (market or user
 * library), `dir` the skill's own directory; `relPath` is `dir` relative to
 * `root` and doubles as the market skill's full name (ntd semantics: the
 * path segments carry the source repo).
 */
function buildEntry(root, dir, stat) {
  return { root, dir, relPath: relative(root, dir).split(sep).join('/'), stat }
}

/** Recursively collect skill directories (dirs holding SKILL.md) under one root. */
async function scanSkillDirs(root, current, out) {
  let entries
  try {
    entries = await fs.readdir(current, { withFileTypes: true })
  } catch {
    return // unreadable directory: skip, not fail the scan
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || MARKET_SCAN_SKIP.has(entry.name)) continue
    const dir = join(current, entry.name)
    const skillMd = join(dir, 'SKILL.md')
    let hasSkillMd = false
    let stat
    try {
      stat = await fs.stat(skillMd)
      hasSkillMd = stat.isFile()
    } catch {
      hasSkillMd = false
    }
    if (hasSkillMd) {
      out.push(buildEntry(root, dir, stat))
    } else {
      await scanSkillDirs(root, dir, out)
    }
  }
}

/** List every skill directory under one root (empty when the root is absent). */
async function scanRoot(root) {
  const out = []
  try {
    await fs.access(root)
  } catch {
    return out
  }
  await scanSkillDirs(root, root, out)
  return out
}

/** Read and parse one skill directory's SKILL.md into a market/summary row. */
async function readSkillEntry(entry) {
  const content = await fs.readFile(join(entry.dir, 'SKILL.md'), 'utf8')
  const { meta, body } = parseSkillMd(content)
  const name = typeof meta.name === 'string' && meta.name !== '' ? meta.name : basename(entry.dir)
  const description = typeof meta.description === 'string' ? meta.description : ''
  return {
    entry,
    name,
    description,
    meta,
    body,
    modifiedAt: entry.stat !== undefined ? entry.stat.mtime.toISOString() : undefined,
  }
}

/** Count files and total bytes under one skill directory. */
async function countFilesAndSize(dir) {
  let fileCount = 0
  let totalSize = 0
  const walk = async (current) => {
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(path)
      } else if (entry.isFile()) {
        fileCount += 1
        const stat = await fs.stat(path)
        totalSize += stat.size
      }
    }
  }
  await walk(dir)
  return { fileCount, totalSize }
}

/** Recursively copy one directory tree. */
async function copyDir(from, to) {
  await fs.mkdir(to, { recursive: true })
  const entries = await fs.readdir(from, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.git') continue
    const source = join(from, entry.name)
    const target = join(to, entry.name)
    if (entry.isDirectory()) {
      await copyDir(source, target)
    } else if (entry.isFile()) {
      await fs.copyFile(source, target)
    }
  }
}

/** Resolve a skill by full name (`source/…/short`) within one root, refusing escapes. */
async function resolveSkillDir(root, fullName) {
  if (fullName === '' || fullName.includes('..') || fullName.includes('\\') || fullName.startsWith('/')) {
    throw new Error('invalid skill name')
  }
  const dir = resolve(root, fullName)
  if (!dir.startsWith(resolve(root) + sep)) throw new Error('invalid skill name')
  try {
    const stat = await fs.stat(join(dir, 'SKILL.md'))
    if (!stat.isFile()) throw new Error('not a skill directory')
    return dir
  } catch {
    throw new Error(`skill '${fullName}' not found`)
  }
}

/**
 * Stream one file from a skill directory as an HTTP response. The path is
 * canonicalized and prefix-checked against the skill dir (ntd's
 * `get_skill_file` traversal guard, kept verbatim in spirit).
 */
async function sendSkillFile(res, skillDir, relPath, contentType) {
  const target = resolve(skillDir, relPath)
  const skillRoot = resolve(skillDir)
  if (!target.startsWith(skillRoot + sep)) throw new Error('invalid file path: escapes skill directory')
  const stat = await fs.stat(target)
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

/** Read and answer one JSON request body, bounded by MAX_BODY_BYTES. */
function readJsonBody(req) {
  return new Promise((fulfil, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        fulfil(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(new Error(`invalid JSON body: ${String((error && error.message) || error)}`))
      }
    })
    req.on('error', reject)
  })
}

/** Send one JSON response. */
function sendJson(res, status, payload) {
  const text = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(text)
}

/** Resolve one frontmatter flag to a boolean; unrecognized values are absent. */
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

/**
 * Invocation policy from frontmatter: `disable-model-invocation` and
 * `user-invocable` both default to permitting their surface.
 */
function invocationPolicy(meta) {
  return {
    modelInvocable: flagValue(meta, 'disable-model-invocation') !== true,
    userInvocable: flagValue(meta, 'user-invocable') !== false,
  }
}

/** Cap for descriptions in list responses; the detail endpoint serves full text. */
const DESCRIPTION_LIMIT = 140

/** One-line clamp for a list-view description. */
function truncateDescription(text) {
  if (typeof text !== 'string') return ''
  const single = text.split(/\r?\n/)[0]
  return single.length > DESCRIPTION_LIMIT ? `${single.slice(0, DESCRIPTION_LIMIT)}…` : single
}

/** Directory name for an installed skill: the last path segment of its full name. */
function installDirName(fullName) {
  return basename(fullName)
}

module.exports = {
  name: 'skills-management',
  inject: ['skills', 'webServer'],
  /** Pure helpers exported for offline tests; not a runtime surface. */
  __internals: { extractFrontmatter, parseSkillMd, invocationPolicy, installDirName },

  /**
   * Mount the marketplace provider and the HTTP API.
   * @param ctx - harness context carrying `skills` and `webServer`.
   * @param config - plugin config (`marketDirs`, `installedDir`, `providerName`).
   */
  apply(ctx, config = {}) {
    const marketDirs = (config.marketDirs !== undefined ? config.marketDirs : DEFAULT_MARKET_DIRS)
      .map((dir) => resolve(expandTilde(dir)))
    const installedDir = resolve(expandTilde(
      config.installedDir !== undefined ? config.installedDir : process.env.DSH_HOME
        ? join(process.env.DSH_HOME, 'skills')
        : join(homedir(), '.dsh', 'skills')))
    const providerName = config.providerName !== undefined ? config.providerName : 'ntd-skills'

    /** Expand a leading `~` against the OS home directory. */
    function expandTilde(path) {
      return path === '~' || path.startsWith('~/') || path.startsWith('~\\')
        ? join(homedir(), path.slice(2))
        : path
    }

    /**
     * Discover every skill in both libraries. Returns market rows keyed by
     * full name and installed rows keyed by directory name.
     */
    async function discoverAll() {
      const market = []
      for (const root of marketDirs) {
        for (const entry of await scanRoot(root)) {
          try {
            market.push(await readSkillEntry(entry))
          } catch (error) {
            ctx.logger.warn(`skills-management: skipping unreadable skill at ${entry.dir}: ${String((error && error.message) || error)}`)
          }
        }
      }
      const installed = []
      for (const entry of await scanRoot(installedDir)) {
        try {
          installed.push(await readSkillEntry(entry))
        } catch (error) {
          ctx.logger.warn(`skills-management: skipping unreadable skill at ${entry.dir}: ${String((error && error.message) || error)}`)
        }
      }
      return { market, installed }
    }

    /** Install one market skill into the user library by full name. */
    async function installSkill(fullName, overwrite) {
      let sourceDir
      for (const root of marketDirs) {
        try {
          sourceDir = await resolveSkillDir(root, fullName)
          break
        } catch (error) {
          if (!String((error && error.message) || error).includes('not found')) throw error
        }
      }
      if (sourceDir === undefined) throw new Error(`skill '${fullName}' not found in market`)
      const target = join(installedDir, installDirName(fullName))
      if (!overwrite) {
        try {
          await fs.access(target)
          throw new Error(`skill '${installDirName(fullName)}' already installed (pass overwrite to replace)`)
        } catch (error) {
          if (error.code !== 'ENOENT') throw error
        }
      } else {
        await fs.rm(target, { recursive: true, force: true })
      }
      await copyDir(sourceDir, target)
      invalidate()
      return { name: installDirName(fullName), path: target }
    }

    /** Remove one installed skill by its directory name. */
    async function removeSkill(name) {
      if (name === '' || name.includes('/') || name.includes('\\') || name.includes('..')) {
        throw new Error('invalid skill name')
      }
      const target = join(installedDir, name)
      const stat = await fs.stat(target).catch(() => undefined)
      if (stat === undefined || !stat.isDirectory()) throw new Error(`installed skill '${name}' not found`)
      await fs.rm(target, { recursive: true })
      invalidate()
      return { removed: name }
    }

    // ── provider: both libraries become one `ctx.skills` provider ───────────
    let providerControl
    const invalidate = () => {
      if (providerControl !== undefined) providerControl.invalidate()
    }
    ctx.skills.registerProvider((control) => {
      providerControl = control
      control.signal.addEventListener('abort', () => {
        if (providerControl === control) providerControl = undefined
      }, { once: true })
      return {
        name: providerName,
        async list() {
          const { market, installed } = await discoverAll()
          const candidates = []
          for (const row of installed) {
            candidates.push(toCandidate(row, 'user-installed', RANK_INSTALLED))
          }
          for (const row of market) {
            // An installed skill shadows the market row with the same short name.
            if (market.length > 0 && installed.some((entry) => entry.name === row.name)) continue
            candidates.push(toCandidate(row, 'market', RANK_MARKET))
          }
          return candidates
        },
        async get(candidate) {
          const entry = candidate.locator
          try {
            return await readSkillEntry({ ...entry, stat: entry.stat ?? (await fs.stat(join(entry.dir, 'SKILL.md'))) })
              .then((row) => ({
                name: row.name,
                description: row.description,
                whenToUse: typeof row.meta.whenToUse === 'string' ? row.meta.whenToUse : undefined,
                invocation: invocationPolicy(row.meta),
                source: candidate.source,
                provider: providerName,
                resourceBase: { kind: 'directory', path: entry.dir },
                content: row.body,
                path: join(entry.dir, 'SKILL.md'),
                metadata: row.meta,
              }))
          } catch {
            return undefined // deleted or unreadable since discovery
          }
        },
      }
    })

    /** Shape one discovered row into a registry candidate. */
    function toCandidate(row, source, rank) {
      return {
        name: row.name,
        description: row.description,
        invocation: invocationPolicy(row.meta),
        source,
        provider: providerName,
        rank,
        locator: { dir: row.entry.dir, root: row.entry.root, relPath: row.entry.relPath, stat: row.entry.stat },
        path: join(row.entry.dir, 'SKILL.md'),
        metadata: row.meta,
        whenToUse: typeof row.meta.whenToUse === 'string' ? row.meta.whenToUse : undefined,
        resourceBase: { kind: 'directory', path: row.entry.dir },
      }
    }

    // ── HTTP API under the registered prefix ─────────────────────────────────
    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: '/skills-management/api',
      handler: async (req, res) => {
        try {
          const url = new URL(req.url || '/', 'http://dsh.local')
          const apiPath = url.pathname.replace(/\/+$/, '')
          const query = url.searchParams

          if (req.method === 'GET' && apiPath.endsWith('/skills-management/api')) {
            const { market, installed } = await discoverAll()
            const sources = new Map()
            for (const row of market) {
              const source = row.entry.relPath.split('/')[0]
              const aggregate = sources.get(source) ?? { source, skills: 0, displayName: source }
              aggregate.skills += 1
              sources.set(source, aggregate)
            }
            const installedNames = new Set(installed.map((row) => row.name))
            // The list view truncates descriptions (full text lives on the
            // detail endpoint): with 6000+ skills the untruncated payload
            // reached 3MB and half of it was description bytes.
            sendJson(res, 200, {
              sources: [...sources.values()],
              market: market.map((row) => ({
                name: row.entry.relPath,
                shortName: row.name,
                source: row.entry.relPath.split('/')[0],
                description: truncateDescription(row.description),
                installed: installedNames.has(row.name),
              })),
              installed: await Promise.all(installed.map(async (row) => {
                const { fileCount, totalSize } = await countFilesAndSize(row.entry.dir)
                return {
                  name: row.name,
                  description: truncateDescription(row.description),
                  path: row.entry.dir,
                  fileCount,
                  totalSize,
                  modifiedAt: row.modifiedAt,
                }
              })),
            })
            return
          }

          if (req.method === 'GET' && apiPath.endsWith('/skills-management/api/detail')) {
            const name = query.get('name') || ''
            let dir
            try {
              dir = await resolveSkillDir(installedDir, name)
            } catch {
              for (const root of marketDirs) {
                try {
                  dir = await resolveSkillDir(root, name)
                  break
                } catch (error) {
                  if (!String((error && error.message) || error).includes('not found')) throw error
                }
              }
            }
            if (dir === undefined) {
              sendJson(res, 404, { error: `skill '${name}' not found` })
              return
            }
            const content = await fs.readFile(join(dir, 'SKILL.md'), 'utf8')
            const files = []
            const walk = async (base, current) => {
              const entries = await fs.readdir(current, { withFileTypes: true })
              for (const entry of entries) {
                if (entry.isDirectory()) {
                  await walk(base, join(current, entry.name))
                } else if (entry.isFile()) {
                  const stat = await fs.stat(join(current, entry.name))
                  files.push({
                    path: relative(base, join(current, entry.name)).split(sep).join('/'),
                    size: stat.size,
                    modifiedAt: stat.mtime.toISOString(),
                  })
                }
              }
            }
            await walk(dir, dir)
            sendJson(res, 200, { name, dir, content, files })
            return
          }

          if (req.method === 'GET' && apiPath.endsWith('/skills-management/api/file')) {
            const name = query.get('name') || ''
            const path = query.get('path') || ''
            let dir
            try {
              dir = await resolveSkillDir(installedDir, name)
            } catch {
              for (const root of marketDirs) {
                try {
                  dir = await resolveSkillDir(root, name)
                  break
                } catch (error) {
                  if (!String((error && error.message) || error).includes('not found')) throw error
                }
              }
            }
            if (dir === undefined) {
              sendJson(res, 404, { error: `skill '${name}' not found` })
              return
            }
            await sendSkillFile(res, dir, path, contentTypeFor(path))
            return
          }

          if (req.method === 'POST' && apiPath.endsWith('/skills-management/api/install')) {
            const body = await readJsonBody(req)
            if (typeof body.name !== 'string' || body.name === '') {
              sendJson(res, 400, { error: 'body must provide name' })
              return
            }
            const result = await installSkill(body.name, body.overwrite === true)
            sendJson(res, 201, { installed: result })
            return
          }

          if (req.method === 'DELETE' && apiPath.endsWith('/skills-management/api')) {
            const body = await readJsonBody(req)
            if (typeof body.name !== 'string' || body.name === '') {
              sendJson(res, 400, { error: 'body must provide name' })
              return
            }
            sendJson(res, 200, await removeSkill(body.name))
            return
          }

          sendJson(res, 404, { error: 'not found' })
        } catch (error) {
          sendJson(res, 400, { error: String((error && error.message) || error) })
        }
      },
    }), 'skills-management: api route')

    /** Content-type guess for served skill files. */
    function contentTypeFor(path) {
      const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
      const map = {
        md: 'text/markdown; charset=utf-8',
        txt: 'text/plain; charset=utf-8',
        json: 'application/json; charset=utf-8',
        js: 'text/javascript; charset=utf-8',
        mjs: 'text/javascript; charset=utf-8',
        css: 'text/css; charset=utf-8',
        html: 'text/html; charset=utf-8',
        svg: 'image/svg+xml',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
      }
      return map[extension]
    }
  },
}
