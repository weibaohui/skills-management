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
 * UI follows the ui-ux-pro-max rule set: visible focus rings on every
 * interactive element, 44px touch targets, skeleton loading, toast feedback
 * for async actions, styled empty states with recovery actions, no-results
 * suggestions, tabular-nums counters (no width jumping), reduced-motion
 * support, and 160ms ease-out micro-interactions on transform/opacity only.
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
    detail: '详情',
    emptyMarket: '市场为空',
    emptyMarketHint: '请检查市场目录配置（默认 ~/.ntd/bundled/skills）',
    emptyInstalled: '还没有安装任何技能',
    emptyInstalledHint: '去市场标签页挑一个装上',
    goMarket: '去市场',
    noResults: '没有匹配的技能',
    noResultsHint: '换个关键词，或清除筛选试试',
    clearFilters: '清除搜索和筛选',
    files: '个文件',
    back: '返回',
    loadingMarket: '正在扫描市场目录…',
    toastInstalled: '已安装',
    toastRemoved: '已删除',
    dismiss: '关闭提示',
    copyPath: '复制路径',
    copied: '已复制',
    more: '滚动加载更多',
    lastUpdated: '更新于',
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
    reinstall: 'Overwrite',
    installed: 'Installed',
    delete: 'Delete',
    detail: 'Detail',
    emptyMarket: 'Market is empty',
    emptyMarketHint: 'Check the market directory config (default ~/.ntd/bundled/skills)',
    emptyInstalled: 'No skills installed yet',
    emptyInstalledHint: 'Pick one from the Market tab',
    goMarket: 'Go to market',
    noResults: 'No matching skills',
    noResultsHint: 'Try another keyword or clear the filters',
    clearFilters: 'Clear search & filters',
    files: 'files',
    back: 'Back',
    loadingMarket: 'Scanning market directories…',
    toastInstalled: 'Installed',
    toastRemoved: 'Removed',
    dismiss: 'Dismiss',
    copyPath: 'Copy path',
    copied: 'Copied',
    more: 'Scroll to load more',
    lastUpdated: 'Updated',
  },
}

/**
 * Styles, scoped by the `skm-` prefix and riding the host theme alias
 * tokens. Focus rings, 44px targets, tabular-nums counters, reduced motion.
 */
const STYLE = `
.skm-page{position:fixed;inset:0;z-index:1000;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1)}
.skm-pageHeader{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 20px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);flex-shrink:0}
.skm-pageTitle{font-size:17px;font-weight:600;margin:0;color:var(--dsw-alias-label-primary)}
.skm-pageClose{display:flex;align-items:center;justify-content:center;width:44px;height:44px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background .16s,color .16s;font-size:15px}
.skm-pageClose:hover{background:color-mix(in srgb,var(--dsh-alias-label-primary, var(--dsw-alias-label-primary)) 12%,transparent);color:var(--dsw-alias-label-primary)}
.skm-pageClose:focus-visible,.skm-tab:focus-visible,.skm-card:focus-visible,.skm-btn:focus-visible,.skm-fileRow:focus-visible,.skm-search:focus-visible,.skm-select:focus-visible,.skm-sidebarTrigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.skm-pageBody{flex:1;overflow:auto;padding:20px;overscroll-behavior:contain}
.skm-inner{max-width:980px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
.skm-tabs{display:flex;gap:4px;border-bottom:1px solid var(--dsw-alias-border-l2);padding:0 2px}
.skm-tab{min-height:44px;padding:8px 14px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .16s;font-feature-settings:"tnum" 1}
.skm-tab:hover{color:var(--dsw-alias-label-primary)}
.skm-tab[data-active="true"]{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600}
.skm-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.skm-search{flex:1;min-width:220px;min-height:44px;padding:8px 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:13px;outline:none;transition:border-color .16s}
.skm-search:focus{border-color:var(--dsw-alias-brand-primary)}
.skm-search::placeholder{color:var(--dsw-alias-label-secondary)}
.skm-select{min-height:44px;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:13px;max-width:280px;cursor:pointer}
.skm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
.skm-card{display:flex;flex-direction:column;gap:8px;padding:14px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);cursor:pointer;transition:transform .16s ease-out,border-color .16s ease-out,box-shadow .16s ease-out}
.skm-card:hover{border-color:var(--dsw-alias-brand-primary);transform:translateY(-1px);box-shadow:0 2px 8px color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}
.skm-card:active{transform:translateY(0)}
.skm-cardName{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary);word-break:break-all}
.skm-cardSource{font-size:11px;color:var(--dsw-alias-label-secondary)}
.skm-cardDesc{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;min-height:18px}
.skm-cardActions{display:flex;gap:8px;align-items:center;margin-top:auto}
.skm-badge{font-size:11px;padding:3px 10px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);color:var(--dsw-alias-label-primary)}
.skm-btn{min-height:36px;padding:6px 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer;transition:border-color .16s,opacity .16s}
.skm-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary)}
.skm-btn:disabled{opacity:.55;cursor:wait}
.skm-btnPrimary{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-layer-1);font-weight:600}
.skm-btnPrimary:hover:not(:disabled){opacity:.9;border-color:var(--dsw-alias-brand-primary)}
.skm-btnDanger:hover:not(:disabled){border-color:var(--dsw-alias-fill-error,#e5484d);color:var(--dsw-alias-fill-error,#e5484d)}
.skm-row{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.skm-rowName{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.skm-rowMeta{font-size:11px;color:var(--dsw-alias-label-secondary);font-feature-settings:"tnum" 1}
.skm-rowActions{margin-left:auto;display:flex;gap:8px}
.skm-empty{padding:48px 20px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:8px;border:1px dashed var(--dsw-alias-border-l2);border-radius:12px}
.skm-emptyTitle{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.skm-emptyHint{font-size:12px;color:var(--dsw-alias-label-secondary);max-width:400px;line-height:1.5}
.skm-detail{max-width:860px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
.skm-detailHeader{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.skm-detailTitle{font-size:16px;font-weight:600;color:var(--dsw-alias-label-primary);word-break:break-all}
.skm-fileList{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--dsw-alias-label-secondary);max-height:220px;overflow:auto;padding:10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2)}
.skm-fileRow{display:flex;justify-content:space-between;gap:10px;min-height:44px;align-items:center;padding:4px 8px;border-radius:6px;cursor:pointer;border:none;background:transparent;text-align:left;font-size:12px;color:inherit;width:100%}
.skm-fileRow:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}
.skm-md{padding:16px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);font-size:13px;line-height:1.6;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word;max-height:50vh;overflow:auto}
.skm-sidebarTrigger{display:flex;align-items:center;gap:8px;width:100%;min-height:44px;padding:8px 12px;border-radius:8px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;text-align:left;cursor:pointer;transition:background .16s,border-color .16s}
.skm-sidebarTrigger:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent)}
.skm-sidebarTriggerIcon{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;color:var(--dsw-alias-label-secondary);font-size:14px}
.skm-err{display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:8px;border:1px solid var(--dsw-alias-fill-error,#e5484d);color:var(--dsw-alias-fill-error,#e5484d);font-size:12px}
.skm-errClose{margin-left:auto;border:none;background:transparent;color:inherit;cursor:pointer;font-size:14px;min-width:32px;min-height:32px;border-radius:6px}
.skm-errClose:hover{background:color-mix(in srgb,var(--dsw-alias-fill-error,#e5484d) 12%,transparent)}
.skm-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:1100;display:flex;align-items:center;gap:10px;padding:10px 18px;border-radius:10px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 30%,transparent);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:13px;box-shadow:0 8px 24px color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent);animation:skm-toast-in .16s ease-out}
@keyframes skm-toast-in{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
.skm-toastCheck{color:var(--dsw-alias-fill-success,#30a46c);font-weight:700}
.skm-more{padding:16px 0;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12px;font-feature-settings:"tnum" 1}
.skm-count{font-feature-settings:"tnum" 1}
.skm-skeleton{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
.skm-skCard{border-radius:10px;border:1px solid var(--dsw-alias-border-l2);padding:14px;display:flex;flex-direction:column;gap:10px;min-height:132px}
.skm-skLine{height:12px;border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);animation:skm-pulse 1.2s ease-in-out infinite}
.skm-skWide{width:70%}
.skm-skMid{width:45%}
.skm-skFull{width:100%}
@keyframes skm-pulse{0%,100%{opacity:1}50%{opacity:.45}}
@media (prefers-reduced-motion: reduce){
  .skm-card,.skm-card:hover,.skm-toast{transition:none;animation:none;transform:none}
  .skm-skLine{animation:none}
  .skm-tab,.skm-btn,.skm-pageClose,.skm-sidebarTrigger,.skm-fileRow{transition:none}
}
`

/** Format a byte count for display. */
function formatSize(bytes) {
  if (bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

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

    /** Loading skeleton: six shimmering card placeholders. */
    function Skeleton() {
      return React.createElement('div', { className: 'skm-skeleton', 'aria-busy': 'true', 'aria-label': t('loadingMarket') },
        Array.from({ length: 6 }, (_, index) => React.createElement('div', { key: index, className: 'skm-skCard' },
          React.createElement('div', { className: 'skm-skLine skmWide' }),
          React.createElement('div', { className: 'skm-skLine skmMid' }),
          React.createElement('div', { className: 'skm-skLine skmFull' }),
        )),
        React.createElement('span', { className: 'skm-more', role: 'status' }, t('loadingMarket')),
      )
    }

    /**
     * Styled empty state: title, hint, optional recovery action.
     */
    function EmptyState({ title, hint, actionLabel, onAction }) {
      return React.createElement('div', { className: 'skm-empty' },
        React.createElement('div', { className: 'skm-emptyTitle' }, title),
        React.createElement('div', { className: 'skm-emptyHint' }, hint),
        actionLabel !== undefined && React.createElement('button', {
          type: 'button',
          className: 'skm-btn skm-btnPrimary',
          style: { marginTop: 8 },
          onClick: onAction,
        }, actionLabel),
      )
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
      const [toast, setToast] = React.useState(null)

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

      // Toast auto-dismiss: feedback appears near the action and leaves on
      // its own, so it never demands a click to clear.
      React.useEffect(() => {
        if (toast === null) return
        const timer = setTimeout(() => { setToast(null) }, 2600)
        return () => { clearTimeout(timer) }
      }, [toast])

      const notify = (text) => { setToast({ text, at: Date.now() }) }

      const install = async (name, overwrite) => {
        setBusy(name)
        try {
          await readJson(await fetch(`${API}/install`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name, overwrite }),
          }))
          notify(`${t('toastInstalled')} · ${name.split('/').pop()}`)
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
          notify(`${t('toastRemoved')} · ${name}`)
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

      // All hooks above this point, before the early return: the detail view
      // renders with the same hook order as the list, or React #300 kills it.
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

      if (detail !== null) {
        return React.createElement('div', { className: 'skm-detail' },
          toast !== null && React.createElement('div', { className: 'skm-toast', role: 'status' },
            React.createElement('span', { className: 'skm-toastCheck' }, '✓'),
            React.createElement('span', null, toast.text),
          ),
          error !== null && React.createElement('div', { className: 'skm-err', role: 'alert' },
            React.createElement('span', null, error),
            React.createElement('button', {
              type: 'button',
              className: 'skm-errClose',
              'aria-label': t('dismiss'),
              onClick: () => { setError(null) },
            }, '✕'),
          ),
          React.createElement('div', { className: 'skm-detailHeader' },
            React.createElement('button', { type: 'button', className: 'skm-btn', onClick: () => { setDetail(null); setDetailFile(null) } }, '← ', t('back')),
            React.createElement('h3', { className: 'skm-detailTitle' }, detail.name),
          ),
          React.createElement('div', { className: 'skm-fileList', role: 'list' },
            detail.files.map((file) => React.createElement('button', {
              key: file.path,
              type: 'button',
              role: 'listitem',
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

      const hasFilters = lower !== '' || source !== 'all'
      const marketEmpty = data.market.length === 0

      return React.createElement('div', { className: 'skm-inner' },
        toast !== null && React.createElement('div', { className: 'skm-toast', role: 'status' },
          React.createElement('span', { className: 'skm-toastCheck' }, '✓'),
          React.createElement('span', null, toast.text),
        ),
        error !== null && React.createElement('div', { className: 'skm-err', role: 'alert' },
          React.createElement('span', null, error),
          React.createElement('button', {
            type: 'button',
            className: 'skm-errClose',
            'aria-label': t('dismiss'),
            onClick: () => { setError(null) },
          }, '✕'),
        ),
        React.createElement('div', { className: 'skm-tabs', role: 'tablist' },
          React.createElement('button', {
            type: 'button',
            role: 'tab',
            'aria-selected': tab === 'market',
            className: 'skm-tab',
            'data-active': tab === 'market',
            onClick: () => setTab('market'),
          }, `${t('tabMarket')} `, React.createElement('span', { className: 'skm-count' }, data.market.length)),
          React.createElement('button', {
            type: 'button',
            role: 'tab',
            'aria-selected': tab === 'installed',
            className: 'skm-tab',
            'data-active': tab === 'installed',
            onClick: () => setTab('installed'),
          }, `${t('tabInstalled')} `, React.createElement('span', { className: 'skm-count' }, data.installed.length)),
        ),
        loading
          ? React.createElement(Skeleton, null)
          : tab === 'market'
            ? React.createElement(React.Fragment, null,
              React.createElement('div', { className: 'skm-toolbar' },
                React.createElement('input', {
                  className: 'skm-search',
                  type: 'search',
                  placeholder: t('search'),
                  'aria-label': t('search'),
                  value: search,
                  onChange: (event) => setSearch(event.target.value),
                }),
                React.createElement('select', {
                  className: 'skm-select',
                  'aria-label': t('allSources'),
                  value: source,
                  onChange: (event) => setSource(event.target.value),
                },
                  React.createElement('option', { value: 'all' }, `${t('allSources')} (${data.market.length})`),
                  data.sources.map((row) => React.createElement('option', { key: row.source, value: row.source }, `${row.displayName} (${row.skills})`)),
                ),
              ),
              loading === false && marketRows.length === 0
                ? (marketEmpty
                    ? React.createElement(EmptyState, { title: t('emptyMarket'), hint: t('emptyMarketHint') })
                    : React.createElement(EmptyState, {
                      title: t('noResults'),
                      hint: t('noResultsHint'),
                      actionLabel: hasFilters ? t('clearFilters') : undefined,
                      onAction: hasFilters
                        ? () => { setSearch(''); setSource('all') }
                        : undefined,
                    }))
                : React.createElement(React.Fragment, null,
                  React.createElement('div', { className: 'skm-grid' },
                    visibleRows.map((row) => React.createElement('div', {
                      key: row.name,
                      className: 'skm-card',
                      role: 'button',
                      tabIndex: 0,
                      'aria-label': row.shortName || row.name,
                      onClick: () => { void openDetail(row.name) },
                      onKeyDown: (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          void openDetail(row.name)
                        }
                      },
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
                          'aria-busy': busy === row.name,
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
                    'aria-live': 'polite',
                  }, `${t('more')} · ${visibleRows.length} / ${marketRows.length}`),
                ),
            )
            : React.createElement(React.Fragment, null,
              React.createElement('div', { className: 'skm-toolbar' },
                React.createElement('input', {
                  className: 'skm-search',
                  type: 'search',
                  placeholder: t('search'),
                  'aria-label': t('search'),
                  value: search,
                  onChange: (event) => setSearch(event.target.value),
                }),
              ),
              data.installed.filter(match).length === 0
                ? (data.installed.length === 0
                    ? React.createElement(EmptyState, {
                      title: t('emptyInstalled'),
                      hint: t('emptyInstalledHint'),
                      actionLabel: t('goMarket'),
                      onAction: () => { setTab('market'); setSearch(''); setSource('all') },
                    })
                    : React.createElement(EmptyState, {
                      title: t('noResults'),
                      hint: t('noResultsHint'),
                      actionLabel: search !== '' ? t('clearFilters') : undefined,
                      onAction: search !== '' ? () => setSearch('') : undefined,
                    }))
                : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                  data.installed.filter(match).map((row) => React.createElement('div', { key: row.name, className: 'skm-row' },
                    React.createElement('div', null,
                      React.createElement('div', { className: 'skm-rowName' }, row.name),
                      React.createElement('div', { className: 'skm-rowMeta' },
                        `${row.fileCount} ${t('files')} · ${formatSize(row.totalSize)}`),
                    ),
                    React.createElement('div', { className: 'skm-rowActions' },
                      React.createElement('button', { type: 'button', className: 'skm-btn', onClick: () => { void openDetail(row.name) } }, t('detail')),
                      React.createElement('button', {
                        type: 'button',
                        className: 'skm-btn skm-btnDanger',
                        disabled: busy === row.name,
                        'aria-busy': busy === row.name,
                        onClick: () => {
                          if (window.confirm(`${t('delete')} ${row.name}?`)) void remove(row.name)
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
      // Close on Escape: a modal dialog answers the keyboard like one.
      React.useEffect(() => {
        if (!open) return
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        window.addEventListener('keydown', onKey)
        return () => { window.removeEventListener('keydown', onKey) }
      }, [open])
      return React.createElement(React.Fragment, null,
        React.createElement('button', {
          type: 'button',
          className: 'skm-sidebarTrigger',
          onClick: () => setOpen(true),
        },
          React.createElement('span', { className: 'skm-sidebarTriggerIcon' }, '◆'),
          t('nav'),
        ),
        open && React.createElement('div', { className: 'skm-page', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('title') },
          React.createElement('div', { className: 'skm-pageHeader' },
            React.createElement('h2', { className: 'skm-pageTitle' }, t('title')),
            React.createElement('button', {
              type: 'button',
              className: 'skm-pageClose',
              'aria-label': t('close'),
              onClick: () => setOpen(false),
            }, '✕'),
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
