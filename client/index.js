/**
 * dsh-plugin-skills-management — Browser half
 *
 * Registers a `settings.section` management page and a `sidebar.footer.action`
 * button opening the same surface as a full-page overlay. The page has two
 * tabs: the market (browse the ntd bundled collection by source, search,
 * open detail, install) and the installed library (list, delete). All data
 * comes from `fetch` on `/skills-management/api`; the bundle runs in the
 * real page, so a plain relative fetch reaches the host.
 *
 * Zero renderer-bound props hooks: everything is reached through the apply
 * closure, so the bundle renders in any client runtime serving `slots`.
 * `require("react")` is a platform module provided by the module loader.
 */

const API = '/skills-management/api'

/** Market cards rendered per increment; scrolling the sentinel loads more. */
const PAGE_SIZE = 60

const LOCALE_NS = 'settings.skillsMarketplace'

const LOCALE_DICT = {
  zh: {
    nav: '技能市场',
    title: '技能市场',
    close: '关闭',
    tabMarket: '市场',
    tabInstalled: '已安装',
    search: '搜索技能名或描述…',
    allSources: '全部来源',
    install: '安装',
    reinstall: '覆盖安装',
    installed: '已安装',
    delete: '删除',
    emptyMarket: '市场为空：请检查市场目录配置（默认 ~/.ntd/bundled/skills）',
    emptyInstalled: '还没有安装任何技能',
    files: '个文件',
    detail: '技能详情',
    back: '返回',
    confirmDelete: '确认删除该技能？',
    loadFailed: '加载失败',
  },
  en: {
    nav: 'Skill Market',
    title: 'Skill Market',
    close: 'Close',
    tabMarket: 'Market',
    tabInstalled: 'Installed',
    search: 'Search name or description…',
    allSources: 'All sources',
    install: 'Install',
    reinstall: 'Overwrite install',
    installed: 'Installed',
    delete: 'Delete',
    emptyMarket: 'Market is empty: check the market directory config (default ~/.ntd/bundled/skills)',
    emptyInstalled: 'No skills installed yet',
    files: 'files',
    detail: 'Skill detail',
    back: 'Back',
    confirmDelete: 'Delete this skill?',
    loadFailed: 'Load failed',
  },
}

/**
 * Styles, scoped by the `skm-` class prefix. Colors ride the host theme
 * alias tokens (as scheduled-items does) so light/dark both work.
 */
const STYLE = `
.skm-page{position:fixed;inset:0;z-index:1000;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1)}
.skm-pageHeader{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);flex-shrink:0}
.skm-pageTitle{font-size:17px;font-weight:600;margin:0;color:var(--dsw-alias-label-primary)}
.skm-pageClose{display:flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background .16s,color .16s}
.skm-pageClose:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent);color:var(--dsw-alias-label-primary)}
.skm-pageBody{flex:1;overflow:auto;padding:20px}
.skm-inner{max-width:980px;margin:0 auto;display:flex;flex-direction:column;gap:16px}
.skm-tabs{display:flex;gap:4px;border-bottom:1px solid var(--dsw-alias-border-l2);padding:0 2px}
.skm-tab{padding:8px 14px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}
.skm-tab:hover{color:var(--dsw-alias-label-primary)}
.skm-tab[data-active="true"]{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600}
.skm-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.skm-search{flex:1;min-width:220px;padding:8px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:13px;outline:none}
.skm-search:focus{border-color:var(--dsw-alias-brand-primary)}
.skm-select{padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:13px;max-width:260px}
.skm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
.skm-card{display:flex;flex-direction:column;gap:8px;padding:14px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);cursor:pointer;transition:border-color .16s}
.skm-card:hover{border-color:var(--dsw-alias-brand-primary)}
.skm-cardName{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary);word-break:break-all}
.skm-cardSource{font-size:11px;color:var(--dsw-alias-label-secondary)}
.skm-cardDesc{font-size:12px;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;min-height:16px}
.skm-cardActions{display:flex;gap:8px;align-items:center;margin-top:auto}
.skm-badge{font-size:11px;padding:2px 8px;border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);color:var(--dsw-alias-label-primary)}
.skm-btn{padding:5px 12px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer}
.skm-btn:hover{border-color:var(--dsw-alias-brand-primary)}
.skm-btnPrimary{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-layer-1)}
.skm-btnDanger:hover{border-color:var(--dsw-alias-fill-error,var(--dsw-alias-brand-primary));color:var(--dsw-alias-fill-error,var(--dsw-alias-label-primary))}
.skm-row{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.skm-rowName{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.skm-rowMeta{font-size:11px;color:var(--dsw-alias-label-secondary)}
.skm-rowActions{margin-left:auto;display:flex;gap:8px}
.skm-empty{padding:40px 0;text-align:center;color:var(--dsw-alias-label-secondary);font-size:13px}
.skm-more{padding:16px 0;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12px}
.skm-detail{max-width:860px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
.skm-detailHeader{display:flex;align-items:center;gap:10px}
.skm-detailTitle{font-size:16px;font-weight:600;color:var(--dsw-alias-label-primary);word-break:break-all}
.skm-fileList{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--dsw-alias-label-secondary);max-height:200px;overflow:auto;padding:10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2)}
.skm-fileRow{display:flex;justify-content:space-between;gap:10px;padding:3px 4px;border-radius:4px;cursor:pointer}
.skm-fileRow:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}
.skm-md{padding:16px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);font-size:13px;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word;max-height:50vh;overflow:auto}
.skm-sidebarTrigger{display:flex;align-items:center;gap:6px;width:100%;padding:8px 12px;border-radius:8px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;text-align:left;cursor:pointer;transition:background .16s,border-color .16s}
.skm-sidebarTrigger:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent)}
.skm-sidebarTriggerIcon{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;color:var(--dsw-alias-label-secondary);font-size:14px}
.skm-err{padding:10px 12px;border-radius:8px;border:1px solid var(--dsw-alias-fill-error,#e5484d);color:var(--dsw-alias-fill-error,#e5484d);font-size:12px}
.skim-spin{color:var(--dsw-alias-label-secondary);font-size:13px;padding:20px 0;text-align:center}
`

module.exports = {
  name: 'skills-management-client',
  inject: ['slots'],

  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    const locale = ctx.get('locale')
    const t = locale ? locale.bind(LOCALE_NS) : (key) => key
    if (locale) {
      ctx.effect(() => locale.register(LOCALE_NS, LOCALE_DICT))
    }

    /** Read one JSON response or throw its error payload. */
    async function readJson(response) {
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`)
      return payload
    }

    /**
     * The management surface: market browse + installed library, with a
     * detail view over either. All state is component-local.
     */
    function SkillsPanel() {
      const [tab, setTab] = React.useState('market')
      const [data, setData] = React.useState({ sources: [], market: [], installed: [] })
      const [loading, setLoading] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [search, setSearch] = React.useState('')
      const [source, setSource] = React.useState('all')
      const [detail, setDetail] = React.useState(null)
      const [busy, setBusy] = React.useState(null)
      const [detailFile, setDetailFile] = React.useState(null)
      const [visibleCount, setVisibleCount] = React.useState(PAGE_SIZE)

      const load = React.useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
          setData(await readJson(await fetch(API)))
        } catch (err) {
          setError(String((err && err.message) || err))
        }
        setLoading(false)
      }, [])

      React.useEffect(() => { void load() }, [load])

      const install = async (name, overwrite) => {
        setBusy(name)
        try {
          await readJson(await fetch(`${API}/install`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name, overwrite }),
          }))
          await load()
        } catch (err) {
          setError(String((err && err.message) || err))
        }
        setBusy(null)
      }

      const remove = async (name) => {
        setBusy(name)
        try {
          await readJson(await fetch(API, {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name }),
          }))
          await load()
        } catch (err) {
          setError(String((err && err.message) || err))
        }
        setBusy(null)
      }

      const openDetail = async (name) => {
        setError(null)
        try {
          const payload = await readJson(await fetch(`${API}/detail?name=${encodeURIComponent(name)}`))
          setDetail({ name, ...payload })
          setDetailFile(null)
        } catch (err) {
          setError(String((err && err.message) || err))
        }
      }

      const openFile = async (name, path) => {
        try {
          const response = await fetch(`${API}/file?name=${encodeURIComponent(name)}&path=${encodeURIComponent(path)}`)
          const text = await response.text()
          setDetailFile({ path, text })
        } catch (err) {
          setError(String((err && err.message) || err))
        }
      }

      const formatSize = (bytes) => {
        if (bytes === undefined) return ''
        if (bytes < 1024) return `${bytes} B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`
      }

      if (detail !== null) {
        return React.createElement('div', { className: 'skm-detail' },
          React.createElement('div', { className: 'skm-detailHeader' },
            React.createElement('button', { type: 'button', className: 'skm-btn', onClick: () => { setDetail(null); setDetailFile(null) } }, '← ', t('back')),
            React.createElement('h3', { className: 'skm-detailTitle' }, detail.name),
          ),
          React.createElement('div', { className: 'skm-fileList' },
            detail.files.map((file) => React.createElement('div', {
              key: file.path,
              className: 'skm-fileRow',
              onClick: () => { void openFile(detail.name, file.path) },
            },
              React.createElement('span', null, file.path),
              React.createElement('span', null, formatSize(file.size)),
            )),
          ),
          detailFile !== null && React.createElement('div', { className: 'skm-md' }, detailFile.text),
          React.createElement('div', { className: 'skm-md' }, detail.content),
        )
      }

      const lower = search.trim().toLowerCase()
      const match = (row) => lower === ''
        || row.name.toLowerCase().includes(lower)
        || (row.description || '').toLowerCase().includes(lower)
        || (row.shortName || '').toLowerCase().includes(lower)

      const marketRows = data.market.filter((row) => (source === 'all' || row.source === source) && match(row))
      const installedNames = new Set(data.installed.map((row) => row.name))
      // Render incrementally: with 6000+ market rows one full render blocked
      // the main thread for seconds and made detail clicks feel dead.
      const visibleRows = marketRows.slice(0, visibleCount)
      const sentinelRef = React.useRef(null)
      React.useEffect(() => {
        setVisibleCount(PAGE_SIZE)
      }, [search, source])
      React.useEffect(() => {
        const sentinel = sentinelRef.current
        if (sentinel === null) return
        const observer = new IntersectionObserver((entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            setVisibleCount((count) => count + PAGE_SIZE)
          }
        }, { rootMargin: '600px' })
        observer.observe(sentinel)
        return () => { observer.disconnect() }
      }, [visibleCount, search, source])

      return React.createElement('div', { className: 'skm-inner' },
        error !== null && React.createElement('div', { className: 'skm-err' }, error),
        React.createElement('div', { className: 'skm-tabs' },
          React.createElement('button', { type: 'button', className: 'skm-tab', 'data-active': tab === 'market', onClick: () => setTab('market') }, `${t('tabMarket')} (${data.market.length})`),
          React.createElement('button', { type: 'button', className: 'skm-tab', 'data-active': tab === 'installed', onClick: () => setTab('installed') }, `${t('tabInstalled')} (${data.installed.length})`),
        ),
        loading ? React.createElement('div', { className: 'skim-spin' }, '…') : tab === 'market'
          ? React.createElement(React.Fragment, null,
            React.createElement('div', { className: 'skm-toolbar' },
              React.createElement('input', { className: 'skm-search', placeholder: t('search'), value: search, onChange: (event) => setSearch(event.target.value) }),
              React.createElement('select', { className: 'skm-select', value: source, onChange: (event) => setSource(event.target.value) },
                React.createElement('option', { value: 'all' }, `${t('allSources')} (${data.market.length})`),
                data.sources.map((row) => React.createElement('option', { key: row.source, value: row.source }, `${row.displayName} (${row.skills})`)),
              ),
            ),
            marketRows.length === 0
              ? React.createElement('div', { className: 'skm-empty' }, t('emptyMarket'))
              : React.createElement(React.Fragment, null,
                React.createElement('div', { className: 'skm-grid' },
                  visibleRows.map((row) => React.createElement('div', {
                    key: row.name,
                    className: 'skm-card',
                    onClick: () => { void openDetail(row.name) },
                  },
                    React.createElement('div', { className: 'skm-cardName' }, row.shortName || row.name),
                    React.createElement('div', { className: 'skm-cardSource' }, row.source),
                    React.createElement('div', { className: 'skm-cardDesc' }, row.description || ''),
                    React.createElement('div', { className: 'skm-cardActions' },
                      row.installed && React.createElement('span', { className: 'skm-badge' }, t('installed')),
                      React.createElement('button', {
                        type: 'button',
                        className: 'skm-btn skm-btnPrimary',
                        disabled: busy === row.name,
                        onClick: (event) => {
                          event.stopPropagation()
                          void install(row.name, row.installed === true)
                        },
                      }, busy === row.name ? '…' : row.installed ? t('reinstall') : t('install')),
                    ),
                  )),
                ),
                visibleRows.length < marketRows.length && React.createElement('div', {
                  ref: sentinelRef,
                  className: 'skm-more',
                }, `${visibleRows.length} / ${marketRows.length}`),
              ),
          )
          : React.createElement(React.Fragment, null,
            React.createElement('div', { className: 'skm-toolbar' },
              React.createElement('input', { className: 'skm-search', placeholder: t('search'), value: search, onChange: (event) => setSearch(event.target.value) }),
            ),
            data.installed.length === 0
              ? React.createElement('div', { className: 'skm-empty' }, t('emptyInstalled'))
              : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                data.installed.filter(match).map((row) => React.createElement('div', { key: row.name, className: 'skm-row' },
                  React.createElement('div', null,
                    React.createElement('div', { className: 'skm-rowName' }, row.name),
                    React.createElement('div', { className: 'skm-rowMeta' },
                      `${row.fileCount} ${t('files')} · ${formatSize(row.totalSize)} · ${row.path}`),
                  ),
                  React.createElement('div', { className: 'skm-rowActions' },
                    React.createElement('button', { type: 'button', className: 'skm-btn', onClick: () => { void openDetail(row.name) } }, t('detail')),
                    React.createElement('button', {
                      type: 'button',
                      className: 'skm-btn skm-btnDanger',
                      disabled: busy === row.name,
                      onClick: () => {
                        if (window.confirm(`${t('confirmDelete')} ${row.name}`)) void remove(row.name)
                      },
                    }, busy === row.name ? '…' : t('delete')),
                  ),
                )),
              ),
          ),
      )
    }

    /** Full-page overlay hosting the panel. */
    function SkillsPage() {
      const [open, setOpen] = React.useState(false)
      React.useEffect(() => {
        const style = document.createElement('style')
        style.textContent = STYLE
        document.head.appendChild(style)
        return () => { document.head.removeChild(style) }
      }, [])
      return React.createElement(React.Fragment, null,
        React.createElement('button', {
          type: 'button',
          className: 'skm-sidebarTrigger',
          onClick: () => setOpen(true),
        },
          React.createElement('span', { className: 'skm-sidebarTriggerIcon' }, '◆'),
          t('nav'),
        ),
        open && React.createElement('div', { className: 'skm-page', role: 'dialog', 'aria-modal': 'true' },
          React.createElement('div', { className: 'skm-pageHeader' },
            React.createElement('h2', { className: 'skm-pageTitle' }, t('title')),
            React.createElement('button', { type: 'button', className: 'skm-pageClose', 'aria-label': t('close'), onClick: () => setOpen(false) }, '✕'),
          ),
          React.createElement('div', { className: 'skm-pageBody' },
            React.createElement(SkillsPanel, null),
          ),
        ),
      )
    }

    // Settings page.
    slots.inject('settings.section', () => slots.register(
      {
        name: 'settings.section',
        id: 'skills-management',
        order: 31,
        label: () => t('nav'),
        locale: LOCALE_NS,
      },
      () => React.createElement(SkillsPanel, null),
    ))

    // Sidebar footer action: full-page management overlay.
    slots.inject('sidebar.footer.action', () => slots.register(
      {
        name: 'sidebar.footer.action',
        id: 'skills-management',
        order: 31,
        locale: LOCALE_NS,
      },
      () => React.createElement(SkillsPage, null),
    ))
  },
}
