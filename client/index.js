/**
 * dsh-plugin-skills-management - Browser half.
 *
 * One React app for every surface (sidebar overlay + settings section).
 * All interactive controls are host primitives (@deepseek-ai/dsh-client-ui-
 * primitives); all colors come from the ui-theme `--dsw-*` token layers so
 * light/dark follows the shell; all copy comes from the locale registry
 * (`zh`/`en`) so switches render live. No hardcoded colors, no ad-hoc copy.
 */

// React is a loader platform module. Under plain Node (contract tests) a
// minimal createElement/hook shim keeps the source loadable for assertions.
let __React = null
try { __React = require('react') } catch {}
if (!__React || typeof __React.createElement !== 'function') {
  __React = {
    createElement(type, props, ...kids) {
      return { type, props: props || {}, kids: kids.flat(9).filter(k => k !== null && k !== undefined && k !== false && k !== true && typeof k !== 'string' || true) }
    },
    useState(init) { const v = [typeof init === 'function' ? init() : init]; return [v[0], x => { v[0] = typeof x === 'function' ? x(v[0]) : x }] },
    useEffect() {}, useMemo(fn) { return fn() }, useRef(v = null) { return { current: v } },
  }
}
const { createElement: h, useState, useEffect, useMemo, useRef } = __React

// Platform module — always present in the loader's seeded require table.
// Under plain Node (tests) it is absent; a tagged-element shim keeps the
// tree structurally testable while every real surface ships primitives.
let P = null
try { P = require('@deepseek-ai/dsh-client-ui-primitives') } catch {}

// NOTE: no class components in this module. A `class X extends
// React.Component` error boundary defined here silently killed rendering in
// the plugin loader (components before it rendered, it never instantiated,
// zero errors) — render-time crashes are handled by the try/catch inside
// SkillsPage and recorded into globalThis.__skErrors instead.

/** Idempotent stylesheet injection — the overlay/tab/card classes are
 *  position-critical (.sk-overlay is position:fixed) so mounting without
 *  them renders the panel invisibly at the end of <body>. */
function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById('sk-styles')) return
  const holder = document.createElement('div')
  holder.id = 'sk-styles'
  holder.style.display = 'none'
  holder.innerHTML = STYLE
  document.head.appendChild(holder)
}

const prim = (name) => P && P[name]
  ? P[name]
  : function Shim(props) {
      const { children, text, ...rest } = props
      const tag = props.href ? 'a' : ['item', 'entry'].includes(props.__kind) ? 'div' : 'button'
      const el = document.createElement(tag === 'function' || typeof props.as === 'string' ? props.as : tag)
      return h(tag, { ...rest, 'data-p-shim': name }, children)
    }

// ── Locale ───────────────────────────────────────────────────────────────

const NS = 'skillsManagement'

const ZH = {
  title: '技能市场',
  close: '关闭',
  tabExecutors: '执行器',
  tabMarket: '市场',
  tabSources: '来源',
  tabInstalled: '已安装',
  cardsHint: '选择一个执行器浏览它的技能，或一次查看全部',
  browseAll: '浏览全部技能',
  refresh: '刷新',
  backCards: '← 执行器卡片',
  backExecutors: '← 执行器',
  backAll: '← 全部技能',
  searchAll: '搜索全部技能…',
  filterWithin: '在 {label} 内筛选…',
  pickSource: '全部执行器',
  loadingCatalogs: '正在加载全部执行器目录…',
  scanning: '正在扫描 {label}…',
  skillsSuffix: '个技能',
  noExecutors: '本机未发现任何执行器目录',
  dirMissingTitle: '{label}：目录不存在',
  dirMissingHint: '预期位置 {dir}',
  notFoundGroup: '本机不存在的来源（{n}）',
  dirNotPresent: '目录不存在',
  emptySearch: '没有匹配的技能',
  emptySkillsIn: '{label} 中还没有技能',
  installedTag: '已装',
  readOnlyTag: '只读',
  toDsh: '装入 DSH',
  deleteBtn: '删除',
  detail: '详情',
  filesCount: '{n} 个文件',
  totalSize: '共 {size}',
  copy: '复制内容',
  copied: '已复制到剪贴板',
  installFrom: '从 {label} 安装',
  installConfirm: '把 “{name}” 从 {label} 复制到 DSH 技能库？\n复制后即可通过 DSH 的 skill 工具调用。',
  installFromMarket: '从市场安装 {name}？',
  deleteConfirm: '确认从 {where} 删除 “{name}” ？',
  whereDsh: 'DSH 技能库',
  operationFailed: '操作失败',
  preview: '文件预览',
  content: '内容',
  activeInDsh: '已在 DSH 生效',
  pathLabel: '路径',
  meTag: '本机',
}

const EN = {
  title: 'Skills Market',
  close: 'Close',
  tabExecutors: 'Executors',
  tabMarket: 'Market',
  tabSources: 'Sources',
  tabInstalled: 'Installed',
  cardsHint: 'Pick an executor to browse its skills, or view everything at once',
  browseAll: 'Browse all skills',
  refresh: 'Refresh',
  backCards: '← Executor cards',
  backExecutors: '← Executors',
  backAll: '← All skills',
  searchAll: 'Search all skills…',
  filterWithin: 'Filter within {label}…',
  pickSource: 'All Executors',
  loadingCatalogs: 'Loading all executor catalogs…',
  scanning: 'Scanning {label}…',
  skillsSuffix: 'skills',
  noExecutors: 'No executor directories found on this machine',
  dirMissingTitle: '{label}: directory not found',
  dirMissingHint: 'Expected skills at {dir}',
  notFoundGroup: 'Not found on this machine ({n})',
  dirNotPresent: 'directory not present',
  emptySearch: 'No matching skills',
  emptySkillsIn: 'No skills in {label}',
  installedTag: 'Installed',
  readOnlyTag: 'read-only',
  toDsh: 'To DSH',
  deleteBtn: 'Delete',
  detail: 'Detail',
  filesCount: '{n} files',
  totalSize: '{size}',
  copy: 'Copy content',
  copied: 'Copied to clipboard',
  installFrom: 'Install from {label}',
  installConfirm: 'Copy "{name}" from {label} into the DSH skills library? It becomes callable through the DSH skill tool.',
  installFromMarket: 'Install {name} from market?',
  deleteConfirm: 'Delete "{name}" from {where}?',
  whereDsh: 'the DSH library',
  operationFailed: 'Operation failed',
  preview: 'File preview',
  content: 'Content',
  activeInDsh: 'active in DSH',
  pathLabel: 'Path',
  meTag: 'me',
}

// ── Pure helpers ────────────────────────────────────────────────────────

const API = '/skills-management/api'

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '-'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function formatTime(iso) {
  if (!iso) return '-'
  try {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
    if (days > 30) return new Date(iso).toLocaleDateString()
    if (days > 0) return days + 'd'
    const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000)
    if (hours > 0) return hours + 'h'
    const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
    if (minutes > 0) return minutes + 'm'
    return 'now'
  } catch { return '-' }
}

function gradient(name) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  const h1 = Math.abs(hash) % 360
  return `linear-gradient(135deg, hsl(${h1},55%,55%), hsl(${(h1 + 40) % 360},45%,45%))`
}

const shortName = (name) => name.includes('/') ? name.split('/').slice(1).join('/') : name

/** Shared predicate for skill filtering (name / description / keywords). */
function matchSkill(s, lower) {
  return (s.name || '').toLowerCase().includes(lower) ||
    (s.description || '').toLowerCase().includes(lower) ||
    (s.keywords || []).some(k => String(k).toLowerCase().includes(lower))
}

// ── Token-based stylesheet (light/dark adaptive by construction) ────────

const STYLE = `<style>
.sk-page{position:relative;display:flex;flex-direction:column;gap:14px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:var(--dsw-font-sm-14,14px)}
.sk-overlay{position:fixed;inset:0;z-index:1000;background:var(--dsw-alias-bg-base);overflow:auto;padding:18px 22px}
.sk-tabs{display:flex;gap:6px;border-bottom:1px solid var(--dsw-alias-border-l2);padding-bottom:10px}
.sk-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.spacer{flex:1}
.sk-hint{color:var(--dsw-alias-label-secondary)}
.sk-dir{color:var(--dsw-alias-label-tertiary);font-size:var(--dsw-font-xs-13,12px)}
.sk-tag{display:inline-flex;align-items:center;padding:2px 9px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font-size:11.5px}
.sk-tag.accent{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}
.sk-tag.danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.sk-tag.ok{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.sk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
.sk-src{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}
.sk-card{display:flex;flex-direction:column;gap:10px;padding:16px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);cursor:pointer;text-align:left}
.sk-card:hover{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover)}
.sk-card.missing{opacity:.5;cursor:default}
.sk-avatar{width:42px;height:42px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--dsw-alias-label-primary-inverted,#fff);font-size:17px;flex:none}
.sk-title{font-weight:600;word-break:break-all}
.sk-desc{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.sk-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:auto;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1)}
.sk-chips{display:flex;gap:6px;flex-wrap:wrap}
.sk-rowbtns{display:flex;gap:6px}
.sk-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.sk-count{font-size:26px;font-weight:700;color:var(--dsw-alias-brand-primary,var(--dsw-alias-state-business-primary))}
.sk-count.none{color:var(--dsw-alias-label-dimmed,var(--dsw-alias-label-tertiary))}
.sk-empty{border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;padding:44px 20px;text-align:center;color:var(--dsw-alias-label-secondary)}
.sk-loading{padding:48px;text-align:center;color:var(--dsw-alias-label-secondary)}
.sk-spin{width:30px;height:30px;margin:0 auto 10px;border-radius:50%;border:3px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary,var(--dsw-alias-state-business-primary));animation:skspin .7s linear infinite}
@keyframes skspin{to{transform:rotate(360deg)}}
.sk-list{display:flex;flex-direction:column;gap:8px}
.sk-list .sk-card{flex-direction:row;align-items:center;padding:12px 14px}
.sk-filewrap{display:flex;gap:14px;min-height:300px}
.sk-files{flex:0 0 230px;max-height:430px;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.sk-file{display:flex;align-items:center;gap:8px;width:100%;padding:7px 11px;font-size:12.5px;border:none;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left}
.sk-file:hover{background:var(--dsw-alias-interactive-bg-hover)}
.sk-file.on{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-business-primary)}
.sk-preview{flex:1;max-height:430px;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:14px}
.sk-meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.sk-meta div{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;min-width:0}
.sk-tabpill{background:transparent;border:none;color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-family)}
</style>`

// ── Fetch layer ─────────────────────────────────────────────────────────

async function getJson(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error('HTTP ' + r.status)
  return r.json()
}

// ── Small building blocks ────────────────────────────────────────────────

const Tag = ({ tone, children }) =>
  h('span', { className: 'sk-tag' + (tone ? ' ' + tone : '') }, children)

const Spinner = ({ label }) =>
  h('div', { className: 'sk-loading' },
    h('div', { className: 'sk-spin' }),
    h('div', null, label))

const Empty = ({ children }) => h('div', { className: 'sk-empty' }, children)

function Avatar({ name }) {
  return h('div', { className: 'sk-avatar', style: { background: gradient(name) } },
    (name[0] || '?').toUpperCase())
}

/** Executor dropdown built on Menu (primitives have no Select). */
function SourceFilter({ rows, value, onChange, t }) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef(null)
  const current = value === 'all' ? null : rows.find(r => r.key === value)
  const label = value === 'all'
    ? `${t('pickSource')} (${rows.reduce((a, r) => a + r.skillCount, 0)})`
    : `${current ? current.label : value} (${current ? current.skillCount : 0})`
  return h('span', { ref: anchorRef, style: { position: 'relative' } },
    prim('Button') && P.Button
      ? h(P.Button, { variant: 'outline', size: 'sm', ref: undefined,
          onClick: () => setOpen(o => !o), title: label },
          h('span', { ref: anchorRef, style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
            label,
            P.IconChevronDownOutline14 ? h(P.IconChevronDownOutline14, { size: 12 }) : '▾'))
      : h('button', { className: 'sk-btn-fallback', onClick: () => setOpen(o => !o), style: { position: 'relative' } },
          h('span', { ref: anchorRef }, label, ' ▾')),
    open && prim('Menu')
      ? h(P.Menu, {
          open,
          anchor: anchorRef.current,
          align: 'start',
          items: [
            { id: 'all', label: `${t('pickSource')} (${rows.reduce((a, r) => a + r.skillCount, 0)})` },
            ...rows.map(x => ({ id: x.key, label: `${x.label} (${x.skillCount})` })),
          ],
          selectedId: value,
          onSelect: (id) => { onChange(id); setOpen(false) },
          onClose: () => setOpen(false),
        })
      : null)
}

// ── Skill / executor cards ───────────────────────────────────────────────

function SkillCard({ row, s, t, onOpen, onInstall, onDelete }) {
  const name = shortName(s.name)
  return h('div', { className: 'sk-card', role: 'button', tabIndex: 0,
      onClick: () => onOpen(s),
      onKeyDown: e => e.key === 'Enter' && onOpen(s) },
    h('div', { style: { display: 'flex', gap: 12, alignItems: 'center' } },
      h(Avatar, { name }),
      h('div', { style: { minWidth: 0 } },
        h('div', { className: 'sk-title' }, name),
        h('div', { className: 'sk-dir' }, `${s.fileCount || 0} · ${formatSize(s.totalSize || 0)} · ${formatTime(s.modifiedAt)}`))),
    h('div', { className: 'sk-desc' }, s.description || ''),
    h('div', { className: 'sk-foot' },
      h('div', { className: 'sk-chips' },
        h(Tag, null, row.label),
        row.readOnly && h(Tag, { tone: 'danger' }, t('readOnlyTag')),
        s.version && h(Tag, { tone: 'accent' }, 'v' + s.version)),
      h('div', { className: 'sk-rowbtns' },
        row.key !== 'dsh' && h(ButtonLite, { primary: true, small: true,
          onClick: e => { e.stopPropagation(); onInstall(row, s.name) } }, t('toDsh')),
        !row.readOnly && h(ButtonLite, { danger: true, small: true,
          onClick: e => { e.stopPropagation(); onDelete(row, s.name) } }, t('deleteBtn')))))
}

/** Tiny variant buttons before P.Button availability resolution settles —
 *  unified through primitives in the browser via data-p-* swap below. */
function ButtonLite({ primary, danger, small, children, onClick }) {
  if (prim('Button')) {
    return h(P.Button, {
      variant: primary ? 'primary' : 'outline',
      size: small ? 'sm' : 'md',
      onClick,
    }, children)
  }
  return h('button', {
    onClick,
    'data-p': primary ? 'primary' : danger ? 'danger' : 'outline',
  }, children)
}

function ExecutorCard({ row, t, onEnter }) {
  const count = Array.isArray(row.skills) ? row.skills.length : (row.skillCount || 0)
  const sizeTotal = Array.isArray(row.skills) ? row.skills.reduce((a, s) => a + (s.totalSize || 0), 0) : null
  return h('div', { className: 'sk-card', role: 'button', tabIndex: 0, style: !row.dirExists ? { opacity: 0.5, cursor: 'default' } : undefined,
      onClick: () => row.dirExists && onEnter(row.key),
      onKeyDown: e => e.key === 'Enter' && row.dirExists && onEnter(row.key) },
    h('div', { className: 'sk-head' },
      h('span', { className: 'sk-title' }, row.label),
      row.readOnly && h(Tag, { tone: 'danger' }, t('readOnlyTag')),
      row.key === 'dsh' && h(Tag, { tone: 'accent' }, t('meTag'))),
    h('div', { className: 'sk-count' + (count ? '' : ' none') }, row.dirExists ? String(count) : '—'),
    h('div', { className: 'sk-hint' }, row.dirExists ? `${t('skillsSuffix')}${sizeTotal != null ? ' · ' + formatSize(sizeTotal) : ''}` : t('dirNotPresent')),
    h('div', { className: 'sk-dir' }, row.dir))
}

// ── Detail modal ─────────────────────────────────────────────────────────

function DetailModal({ sel, executors, t, onClose, onInstalled, onDeleted }) {
  const [data, setData] = useState(null)
  const [file, setFile] = useState(null)
  const [fileText, setFileText] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [toast, setToast] = useState(false)
  const row = sel.executorKey ? executors.find(x => x.key === sel.executorKey) : null

  useEffect(() => {
    let alive = true
    setData(null)
    const q = `?name=${encodeURIComponent(sel.name)}${sel.executorKey ? '&executor=' + encodeURIComponent(sel.executorKey) : ''}`
    getJson(API + '/detail' + q).then(d => { if (alive) setData(d) }).catch(() => {})
    return () => { alive = false }
  }, [sel])

  const openFile = (f) => {
    setFile(f)
    const q = `?name=${encodeURIComponent(sel.name)}&path=${encodeURIComponent(f.path)}${sel.executorKey ? '&executor=' + encodeURIComponent(sel.executorKey) : ''}`
    fetch(API + '/file' + q).then(r => { if (!r.ok) throw 0; return r.text() }).then(setFileText).catch(() => setFileText(''))
  }

  const doDelete = async () => {
    try {
      const body = { name: sel.name }
      if (sel.executorKey) body.executor = sel.executorKey
      const r = await fetch(API, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'HTTP ' + r.status)
      setConfirming(false)
      onDeleted()
    } catch (e) { setConfirming(false); alert(t('operationFailed') + ': ' + e.message) }
  }

  const doInstall = async () => {
    try {
      const body = { name: sel.name }
      if (sel.executorKey && sel.executorKey !== 'dsh') body.from = sel.executorKey
      const r = await fetch(API + '/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'HTTP ' + r.status)
      onInstalled()
    } catch (e) { alert(t('operationFailed') + ': ' + e.message) }
  }

  const copyContent = () => {
    navigator.clipboard.writeText(data?.content || '').then(() => {
      setToast(true)
    }).catch(() => {})
  }

  const meta = data?.meta || {}
  const files = data?.files || []
  const isMd = file ? file.path.endsWith('.md') : true

  return h('div', null,
    prim('Modal')
      ? h(P.Modal, { open: true, onClose, title: shortName(sel.name), closeLabel: t('close'), contentClassName: 'sk-modal-wide' },
          h('div', { className: 'sk-page' },
            h('div', { className: 'sk-hint' }, meta.description || meta.whenToUse || ''),
            h('div', { className: 'sk-toolbar' },
              row && row.key !== 'dsh' && h(P.Button, { variant: 'primary', size: 'sm', onClick: doInstall }, `${t('installFrom', { label: row.label })}`),
              row && row.key === 'dsh' && h(Tag, { tone: 'ok' }, t('activeInDsh')),
              row && row.readOnly && h(Tag, { tone: 'danger' }, t('readOnlyTag')),
              h(P.Button, { variant: 'outline', size: 'sm', onClick: copyContent }, t('copy')),
              h('span', { className: 'spacer' }),
              row && !row.readOnly && h(P.Button, { variant: 'outline', size: 'sm', onClick: () => setConfirming(true) }, t('deleteBtn'))),
            h('div', { className: 'sk-meta' },
              h('div', null, h('div', { className: 'sk-dir' }, t('pathLabel')), h('div', { className: 'sk-hint' }, data?.dir || '-')),
              h('div', null, h('div', { className: 'sk-dir' }, t('filesCount', { n: data?.fileCount ?? 0 })), h('div', { className: 'sk-hint' }, formatSize(data?.totalSize || 0))),
              meta.version && h('div', null, h('div', { className: 'sk-dir' }, 'Version'), h('div', { className: 'sk-hint' }, 'v' + meta.version)),
              meta.author && h('div', null, h('div', { className: 'sk-dir' }, 'Author'), h('div', { className: 'sk-hint' }, meta.author))),
            files.length
              ? h('div', { className: 'sk-filewrap' },
                  h('div', { className: 'sk-files' }, files.map(f =>
                    h('button', { key: f.path, className: 'sk-file' + ((file ? f.path === file.path : f.path === 'SKILL.md') ? ' on' : ''), onClick: () => openFile(f) },
                      h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, f.path),
                      h('span', { className: 'sk-dir' }, formatSize(f.size))))),
                  h('div', { className: 'sk-preview sk-md' },
                    isMd && prim('MarkdownText')
                      ? h(P.MarkdownText, { text: file ? fileText : (data?.content || '') })
                      : h('pre', { style: { whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'var(--dsw-font-family)' } }, file ? fileText : (data?.content || ''))))
              : h('div', { className: 'sk-preview sk-md' },
                  prim('MarkdownText')
                    ? h(P.MarkdownText, { text: data?.content || '' })
                    : h('pre', { style: { whiteSpace: 'pre-wrap', margin: 0 } }, data?.content || ''))))
        : null,
    confirming && prim('Modal')
      ? h(P.Modal, { open: true, onClose: () => setConfirming(false), title: t('deleteConfirm', { name: sel.name, where: row ? row.label : t('whereDsh') }), footer:
          h('div', { className: 'sk-toolbar', style: { justifyContent: 'flex-end' } },
            h(P.Button, { variant: 'ghost', size: 'sm', onClick: () => setConfirming(false) }, t('close')),
            h(P.Button, { variant: 'primary', size: 'sm', onClick: doDelete }, t('deleteBtn'))) }, null)
      : null,
    toast && prim('Toast')
      ? h(P.Toast, { text: t('copied'), onDone: () => setToast(false) })
      : null)
}

// ── Views ────────────────────────────────────────────────────────────────

function CardsView({ executors, t, onEnter, onBrowseAll }) {
  if (!executors.length) return h(Empty, null, t('noExecutors'))
  const present = executors.filter(r => r.dirExists)
  const missing = executors.filter(r => !r.dirExists)
  return [
    h('div', { className: 'sk-toolbar' },
      h('span', { className: 'sk-hint' }, t('cardsHint')),
      h('span', { className: 'spacer' }),
      h(P.Button, { variant: 'primary', size: 'sm', onClick: onBrowseAll }, `${t('browseAll')} (${executors.reduce((a, r) => a + r.skillCount, 0)})`),
      h('span', { style: { width: 6 } }),
      h('span', { className: 'sk-refresh-slot' })),
    h('div', { className: 'sk-src' },
      present.map(row => h(ExecutorCard, { key: row.key, row, t, onEnter }))),
    missing.length > 0 && [
      h('div', { className: 'sk-hint', style: { marginTop: 6 } }, t('notFoundGroup', { n: missing.length })),
      h('div', { className: 'sk-src' },
        missing.map(row => h(ExecutorCard, { key: row.key, row, t, onEnter }))),
    ],
  ]
}

function AllSkillsView({ executors, searchText, sourceFilter, t, onSearch, onFilter, onBack, onOpen, onInstall, onDelete }) {
  const pending = executors.some(x => x.dirExists && !Array.isArray(x.skills))
  if (pending) return h(Spinner, { label: t('loadingCatalogs') })
  let items = []
  for (const row of executors) {
    if (!row.dirExists || !Array.isArray(row.skills)) continue
    if (sourceFilter !== 'all' && row.key !== sourceFilter) continue
    for (const s of row.skills) items.push({ row, s })
  }
  if (searchText) items = items.filter(it => matchSkill(it.s, searchText.toLowerCase()))
  return [
    h('div', { className: 'sk-head' },
      h(P.Button, { variant: 'ghost', size: 'sm', onClick: onBack }, t('backCards')),
      h('span', { className: 'sk-title' }, t('title')),
      h(InputBox, { value: searchText, placeholder: t('searchAll'), onSearch }),
      SourceFilterEl({ rows: executors.filter(r => r.dirExists), value: sourceFilter, onChange: onFilter, t }),
      h('span', { className: 'spacer' }),
      h(Tag, null, `${items.length} ${t('skillsSuffix')}`)),
    !items.length
      ? h(Empty, null, t('emptySearch'))
      : h('div', { className: 'sk-grid' }, items.map(({ row, s }) =>
          h(SkillCard, { key: row.key + '/' + s.name, row, s, t, onOpen, onInstall, onDelete })))]
}

function DrillInView({ row, searchText, t, onSearch, onBack, onOpen, onInstall, onDelete }) {
  if (!row) return null
  if (!row.dirExists) {
    return [
      h('div', { className: 'sk-head' },
        h(P.Button, { variant: 'ghost', size: 'sm', onClick: onBack }, t('backAll'))),
      h(Empty, null, `${row.label} — ${row.dir}`)]
  }
  if (!Array.isArray(row.skills)) {
    return h(Spinner, { label: t('scanning', { label: row.label }) })
  }
  let skills = row.skills
  if (searchText) skills = skills.filter(s => matchSkill(s, searchText.toLowerCase()))
  return [
    h('div', { className: 'sk-head' },
      h(P.Button, { variant: 'ghost', size: 'sm', onClick: onBack }, t('backAll')),
      h('span', { className: 'sk-title' }, row.label),
      h('span', { className: 'sk-tag' }, `${skills.length} ${t('skillsSuffix')}`),
      row.readOnly && h(Tag, { tone: 'danger' }, t('readOnlyTag')),
      h(InputBox, { value: searchText, placeholder: t('filterWithin', { label: row.label }), onSearch }),
      h('span', { className: 'spacer' }),
      h('span', { className: 'sk-dir' }, row.dir)),
    !skills.length
      ? h(Empty, null, searchText ? t('emptySearch') : t('emptySkillsIn', { label: row.label }))
      : h('div', { className: 'sk-grid' }, skills.map(s =>
          h(SkillCard, { key: s.name, row, s, t, onOpen, onInstall, onDelete }))),
  ]
}

function InputBox({ value, placeholder, onSearch }) {
  if (prim('Input')) {
    return h(P.Input, { value, placeholder, onChange: e => onSearch(e.target.value),
      style: { minWidth: 220 } })
  }
  return h('input', { value, placeholder, onChange: e => onSearch(e.target.value),
    style: { minWidth: 220, minHeight: 32, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', padding: '6px 12px' } })
}
function SourceFilterEl(args) { return SourceFilter(args) }

// ── App root ─────────────────────────────────────────────────────────────

function SkillsPage({ t, onClose, embedded }) {
  const [base, setBase] = useState({ sources: [], market: [], installed: [] })
  const [executors, setExecutors] = useState([])
  const [tab, setTab] = useState('executors')
  const [executorView, setExecutorView] = useState('cards')
  const [filterExecutor, setFilterExecutor] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [marketFilter, setMarketFilter] = useState('all')
  const [searchExec, setSearchExec] = useState('')
  const [searchDrill, setSearchDrill] = useState('')
  const [searchAll, setSearchAll] = useState('')
  const [searchMarket, setSearchMarket] = useState('')
  const [searchInstalled, setSearchInstalled] = useState('')
  const [sel, setSel] = useState(null)
  const [tick, forceTick] = useState(0)
  const rootRef = useRef(null)

  const reload = () => {
    getJson(API).then(setBase).catch(() => {})
    getJson(API + '/executors?mode=summary').then(d => setExecutors(d.executors || [])).catch(() => {})
  }
  useEffect(reload, [])

  // Load full lists for one executor on demand
  useEffect(() => {
    if (filterExecutor === 'all') return
    const row = executors.find(x => x.key === filterExecutor)
    if (!row || Array.isArray(row.skills)) return
    let alive = true
    getJson(API + '/executors?executor=' + encodeURIComponent(filterExecutor))
      .then(d => { if (alive) setExecutors(rows => rows.map(r => r.key === d.executor.key ? d.executor : r)) })
      .catch(() => {})
    return () => { alive = false }
  }, [filterExecutor, executors])

  // Load all catalogs when entering the flat all-skills view
  useEffect(() => {
    if (!(tab === 'executors' && executorView === 'all')) return
    const targets = executors.filter(x => x.dirExists && !Array.isArray(x.skills))
    targets.forEach(row => {
      getJson(API + '/executors?executor=' + encodeURIComponent(row.key))
        .then(d => setExecutors(rows => rows.map(r => r.key === d.executor.key ? d.executor : r)))
        .catch(() => {})
    })
  }, [tab, executorView, executors])

  const row = filterExecutor !== 'all' ? executors.find(x => x.key === filterExecutor) : null

  const openDetail = (s, executorKey) => setSel({ name: s.name, executorKey })
  const [pendingDelete, setPendingDelete] = useState(null)
  const doPendingDelete = async () => {
    if (!pendingDelete) return
    await quickDelete(t, pendingDelete.executor, pendingDelete.name, afterChange)
    setPendingDelete(null)
    reload()
  }

  let body = null
  try {
  if (tab === 'executors') {
    if (filterExecutor !== 'all') {
      body = h(DrillInView, { row, searchText: searchDrill, t,
        onSearch: setSearchDrill,
        onBack: () => { setFilterExecutor('all'); setSearchDrill('') },
        onOpen: s => openDetail(s, row?.key),
        onInstall: (r, name) => runInstall(t, { name, from: r.key }, afterChange),
        onDelete: (r, name) => setPendingDelete({ executor: r.key, name }) })
    } else if (executorView === 'all') {
      body = h(AllSkillsView, { executors, searchText: searchAll, sourceFilter, t,
        onSearch: setSearchAll,
        onFilter: v => { setSourceFilter(v); if (v !== 'all') { setFilterExecutor(v); setSearchAll(''); setSearchExec('') } },
        onBack: () => setExecutorView('cards'),
        onOpen: s => { const owner = executors.find(x => x.dirExists && Array.isArray(x.skills) && x.skills.some(k => k.name === s.name)); openDetail(s, owner ? owner.key : sourceFilter !== 'all' ? sourceFilter : 'dsh') },
        onInstall: (r, name) => runInstall(t, { name, from: r.key }, afterChange),
        onDelete: (r, name) => setPendingDelete({ executor: r.key, name }) })
    } else {
      body = h(CardsView, { executors, t,
        onEnter: key => { setFilterExecutor(key); setSearchDrill('') },
        onBrowseAll: () => setExecutorView('all') })
    }
  } else if (tab === 'installed') {
    const list = base.installed.filter(s => !searchInstalled ||
      matchSkill({ name: s.name, description: s.description }, searchInstalled.toLowerCase()))
    body = [
      h('div', { className: 'sk-toolbar' },
        h(InputBox, { value: searchInstalled, placeholder: t('searchAll'), onSearch: setSearchInstalled })),
      list.length
        ? h('div', { className: 'sk-list' }, list.map(s =>
            h('div', { key: s.name, className: 'sk-card' },
              h('div', { style: { minWidth: 0 } },
                h('div', { className: 'sk-title' }, s.name),
                h('div', { className: 'sk-dir' }, `${s.fileCount} · ${formatSize(s.totalSize)} · ${formatTime(s.modifiedAt)}`)),
              h('div', { className: 'sk-rowbtns' },
                h(ButtonLite, { small: true, onClick: () => openDetail({ name: s.name }, 'dsh') }, t('detail')),
                h(ButtonLite, { danger: true, small: true, onClick: () => setPendingDelete({ executor: 'dsh', name: s.name }) }, t('deleteBtn'))))))
        : h(Empty, null, t('emptySkillsIn', { label: t('tabInstalled') }))]

  } else {
    // market / sources share the market collection dataset
    const marketList = base.market.filter(s =>
      (!searchMarket || matchSkill(s, searchMarket.toLowerCase())) &&
      (marketFilter === 'all' || s.source === marketFilter))
    if (tab === 'sources') {
      body = base.sources.length
        ? h('div', { className: 'sk-src' }, base.sources.map(src =>
            h('div', { key: src.source, className: 'sk-card', role: 'button', tabIndex: 0,
              onClick: () => { setTab('market'); setMarketFilter(src.source) } },
              h('span', { className: 'sk-title' }, src.displayName || src.source),
              h('span', { className: 'sk-count' }, src.skills))))
        : h(Empty, null, t('emptySearch'))
    } else {
      body = [
        h('div', { className: 'sk-toolbar' },
          h(InputBox, { value: searchMarket, placeholder: t('searchAll'), onSearch: setSearchMarket }),
          h(SourceFilterStatic, { sources: base.sources, value: marketFilter, onChange: setMarketFilter }),
          h('span', { className: 'spacer' }),
          h(Tag, null, `${marketList.length} ${t('skillsSuffix')}`)),
        marketList.length
          ? h('div', { className: 'sk-grid' }, marketList.map(s =>
              h(SkillCard, { key: s.name, row: { key: '@market', label: splitSource(s.source), readOnly: false }, s: { ...s, name: s.shortName || s.name, keywords: s.keywords, totalSize: s.totalSize }, t,
                onOpen: item => openDetail(item, null),
                onInstall: (_r, name) => runInstall(t, { name }, afterChange),
                onDelete: () => {} })))
          : h(Empty, null, t('emptySearch')),
      ]
    }
  }
  } catch (renderErr) {
    ;(globalThis.__skErrors = globalThis.__skErrors || []).push('body: ' + (renderErr && renderErr.message))
    body = h('div', { className: 'sk-empty', style: { color: 'var(--dsw-alias-state-error-primary)' } },
      '\u26A0\uFE0F ' + String((renderErr && renderErr.message) || renderErr))
  }

  return h('div', { className: 'sk-page' + (embedded ? '' : ' sk-overlay'), ref: rootRef },
    !embedded && h('div', { className: 'sk-head' },
      h('span', { className: 'sk-title', style: { fontSize: 16 } }, t('title')),
      h('span', { className: 'spacer' }),
      h(ButtonLite, { onClick: () => onClose && onClose() }, t('close'))),
    h('div', { className: 'sk-tabs' }, ['executors', 'market', 'sources', 'installed'].map(key =>
      h('button', { key, className: 'sk-tabpill' + (tab === key ? ' on' : ''), style: pillStyle(tab === key),
        onClick: () => { setTab(key); setFilterExecutor('all'); setExecutorView('cards'); setSearchExec(''); setSearchDrill(''); setSearchAll('') } }, t('tab' + key[0].toUpperCase() + key.slice(1))))),
    h('div', null, body),
    sel && h(DetailModal, { sel, executors, t,
      onClose: () => setSel(null), onInstalled: () => { setSel(null); reload() }, onDeleted: () => { setSel(null); reload() } }),
    pendingDelete && P && P.Modal && h(P.Modal, {
      open: true,
      onClose: () => setPendingDelete(null),
      title: t('deleteConfirm', {
        name: pendingDelete.name,
        where: pendingDelete.executor === 'dsh' || !pendingDelete.executor ? t('whereDsh') : ((executors.find(x => x.key === pendingDelete.executor) || {}).label || pendingDelete.executor),
      }),
      footer: h('div', { className: 'sk-toolbar', style: { justifyContent: 'flex-end' } },
        h(ButtonLite, { onClick: () => setPendingDelete(null) }, t('close')),
        h(ButtonLite, { primary: true, danger: true, onClick: doPendingDelete }, t('deleteBtn'))),
    }, null))
  }

function SourceFilterStatic({ sources, value, onChange }) {  return h('select', { value, onChange: e => onChange(e.target.value),
      style: selectStyle() },
    h('option', { value: 'all' }, 'All Sources'),
    sources.map(s => h('option', { key: s.source, value: s.source }, (s.displayName || s.source) + ` (${s.skills})`)))
}
function splitSource(source) { return source.split('/')[0] || source }
function selectStyle() {
  return { minHeight: 30, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-specific-input-major, var(--dsw-alias-bg-layer-1))', color: 'var(--dsw-alias-label-primary)', padding: '4px 10px' }
}
function pillStyle(on) {
  return {
    padding: '6px 14px', borderRadius: 999, cursor: 'pointer', fontSize: 13.5, fontWeight: on ? 600 : 400,
    border: '1px solid ' + (on ? 'var(--dsw-alias-brand-primary,var(--dsw-alias-state-business-primary))' : 'transparent'),
    background: on ? 'var(--dsw-alias-bg-layer-2)' : 'transparent',
    color: on ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
  }
}

// install/delete REST helpers shared across views
async function runInstall(t, body, done) {
  try {
    const r = await fetch(API + '/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'HTTP ' + r.status)
    done()
  } catch (e) { alert(t('operationFailed') + ': ' + e.message) }
}
async function quickDelete(t, executor, name, done) {
  try {
    const body = { name }
    if (executor) body.executor = executor
    const r = await fetch(API, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'HTTP ' + r.status)
    done()
  } catch (e) { alert(t('operationFailed') + ': ' + e.message) }
}

// ── Slot entries ─────────────────────────────────────────────────────────

function footerStyle() {
  return { display: 'inline-flex', alignItems: 'center', gap: 6, margin: '4px 10px', padding: '8px 10px',
    border: 'none', borderRadius: 8, background: 'transparent', color: 'var(--dsw-alias-label-secondary)',
    font: 'inherit', fontSize: 13, cursor: 'pointer', width: 'calc(100% - 20px)', textAlign: 'left' }
}

/** Panel state lives OUTSIDE React: sidebar churn remounts slot entries,
 *  and any state kept in them (the old bug) is torn down with them. */
const panelStore = {
  open: false,
  listeners: new Set(),
  set(v) { panelStore.open = v; for (const fn of panelStore.listeners) fn(v) },
  subscribe(fn) { panelStore.listeners.add(fn); return () => panelStore.listeners.delete(fn) },
}

/** Footer slot entry: the button, and — when open — the whole market page
 *  through the host primitives Modal (portal + overlay handled by the host's
 *  own React tree; no custom createRoot, which never commits here). */
function FooterSlotComponent(props) {
  const [open, setOpen] = useState(panelStore.open)
  useEffect(() => panelStore.subscribe(setOpen), [])
  useEffect(ensureStyles, [])
  const t = props.__t
  return h('span', { style: { display: 'contents' } },
    h('button', { title: 'Skills Market', onClick: () => panelStore.set(!panelStore.open),
        style: footerStyle() }, '\u{1F3AF} ', props.label || (t ? t('title') : 'Skills Market')),
    open && P && P.Modal && h(P.Modal, {
        open: true,
        onClose: () => panelStore.set(false),
        title: t ? t('title') : 'Skills Market',
        closeLabel: t ? t('close') : 'Close',
        contentClassName: 'sk-modal-page',
      },
      h(SkillsPage, { t, embedded: true, onClose: () => panelStore.set(false) })))
}

/** Settings section slot entry: render the page directly in the host tree. */
function SettingsSlotComponent(props) {
  useEffect(ensureStyles, [])
  return h(SkillsPage, { t: props.__t, embedded: true })
}

// ── Plugin plane contract ────────────────────────────────────────────────

const CLIENT_NAME = 'dsh-plugin-skills-management'

module.exports = {
  name: CLIENT_NAME,
  inject: ['slots', 'locale'],
  __internals: { NS, ZH, EN, matchSkill, formatSize, formatTime },
  /** Test/host helper: mount a standalone page into any container. */
  __boot(container, opts = {}) {
    ensureStyles()
    let t = opts.t || ((key, vars) => {
      let out = EN[key] ?? key
      if (vars) for (const [k, v] of Object.entries(vars)) out = out.split('{' + k + '}').join(String(v))
      return out
    })
    try {
      if (!opts.t && globalThis.document && !(container.ownerDocument !== document)) { /* noop */ }
    } catch {}
    const root = require('react-dom/client').createRoot(container)
    root.render(h(SkillsPage, { t, embedded: !!opts.embedded }))
    return root
  },
  apply(ctx) {
    // Locale service is optional at boot order — degrade to EN until present
    let t = (key, vars) => {
      let out = EN[key] ?? key
      if (vars) for (const [k, v] of Object.entries(vars)) out = out.split('{' + k + '}').join(String(v))
      return out
    }
    try {
      if (ctx.locale && typeof ctx.locale.register === 'function') {
        ctx.locale.register(NS, 'zh', ZH)
        ctx.locale.register(NS, 'en', EN)
        const bound = typeof ctx.locale.bind === 'function' ? ctx.locale.bind(NS) : null
        if (bound) {
          t = (key, vars) => {
            let out = bound(key) || key
            if (vars) for (const [k, v] of Object.entries(vars)) out = out.split('{' + k + '}').join(String(v))
            return out
          }
          globalThis.__skillsLocaleLive = true
        }
      }
    } catch (e) { try { console.error('[skills-management] locale init:', e) } catch {} }
    ctx.effect(() => {
      try {
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: CLIENT_NAME,
        order: 50,
        inject: () => ({ t }),
      }, function FooterSlot(apiProps) {
        return h(FooterSlotComponent, { __t: t, label: apiProps?.t ? apiProps.t('title') : undefined })
      }))
      } catch (e) { (globalThis.__skErrors = globalThis.__skErrors || []).push('footer:' + (e && e.message)); throw e }
    }, 'skills-management: sidebar footer action')
    ctx.effect(() => {
      try {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: CLIENT_NAME,
        order: 90,
        locale: NS,
        label: (apiT) => (apiT && apiT('title')) || 'Skills Management',
        inject: () => ({}),
      }, function SettingsSectionSlot() {
        return h(SettingsSlotComponent, { __t: t })
      }))
      } catch (e) { (globalThis.__skErrors = globalThis.__skErrors || []).push('settings:' + (e && e.message)); throw e }
    }, 'skills-management: settings section')
  },
}
