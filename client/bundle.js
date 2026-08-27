/* Generated from client/index.js by scripts/build-client.mjs — do not edit by hand.
 * Regenerate with: npm run build:client
 */
window.__ModuleLoader__.load({
  id: "dsh-plugin-skills-management",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })
    var React = require("react")
    /**
     * dsh-plugin-skills-management - Browser half (NTD-style)
     *
     * Tabs: Executors (every on-machine agent skills dir, ntd source table),
     * Market (ntd bundled collections), Sources (market repo grouping) and
     * Installed (the dsh user library). Detail drawer and actions are scoped by
     * executor: `Install` copies into the dsh library so the skill tool can call
     * it, `Delete` removes from the owning source unless it is read-only.
     */

    const API = '/skills-management/api'

    function formatSize(bytes) {
      if (!Number.isFinite(bytes) || bytes < 0) return '-'
      if (bytes < 1024) return bytes + " B"
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB"
      return (bytes / (1024 * 1024)).toFixed(1) + " MB"
    }

    function formatTime(isoString) {
      if (!isoString) return "-"
      try {
        const date = new Date(isoString)
        const now = new Date()
        const diff = now.getTime() - date.getTime()
        const days = Math.floor(diff / (1000 * 60 * 60 * 24))
        if (days > 30) return date.toLocaleDateString('zh-CN', {year:'numeric',month:'short',day:'numeric'})
        if (days > 0) return days + "d ago"
        const hours = Math.floor(diff / (1000 * 60 * 60))
        if (hours > 0) return hours + "h ago"
        const minutes = Math.floor(diff / (1000 * 60))
        if (minutes > 0) return minutes + "m ago"
        return "just now"
      } catch { return "-" }
    }

    function generateGradient(name) {
      let hash = 0
      for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
      const h1 = Math.abs(hash) % 360
      const h2 = (h1 + 40) % 360
      return 'linear-gradient(135deg, hsl(' + h1 + ', 70%, 60%), hsl(' + h2 + ', 60%, 50%))'
    }

    function getFileColor(filename) {
      const ext = (filename.split('.').pop() || '').toLowerCase()
      const m = {md:'#0891b2',ts:'#3178c6',js:'#f7df1e',json:'#f59e0b',yaml:'#e11d48',css:'#06b6d4',html:'#ea580c'}
      return m[ext] || "#94a3b8"
    }

    function splitSkillName(name) {
      if (!name.includes('/')) return {category:null, shortName:name}
      const p = name.split('/')
      return {category:p[0], shortName:p.slice(1).join('/')}
    }

    function escapeHtml(text) {
      return String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    }

    function renderMarkdown(text) {
      if (!text) return ""
      text = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      let h = text
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
        .replace(/`(.+?)`/g, "<code>$1</code>")
        .replace(/^- (.+)$/gm, "<li>$1</li>")
        .replace(/^\d+\. (.+)$/gm, "<li>$1</li>")
      h = h.replace(/(<li>.*?<\/li>)/gs, "<ul>$1</ul>")
      h = h.replace(/\n\n/g, "</p><p>")
      h = "<p>" + h + "</p>"
      h = h.replace(/<p><(h[123]|ul|pre)/g, "<$1")
      h = h.replace(/<(h[123]|\/ul|pre)><\/p>/g, "<$1>")
      h = h.replace(/<p><\/p>/g, "")
      return h
    }

    const STYLE = `<style>
    .skills-page{position:fixed;inset:0;z-index:1000;display:flex;flex-direction:column;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
    .skills-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px;border-bottom:1px solid #e5e5e5;background:#fff}
    .skills-title{font-size:18px;font-weight:600;margin:0;color:#1a1a1a}
    .skills-close{width:44px;height:44px;display:flex;align-items:center;justify-content:center;border:none;border-radius:8px;background:transparent;cursor:pointer;font-size:20px;color:#666}
    .skills-body{flex:1;overflow:auto;padding:20px}
    .skills-inner{max-width:1100px;margin:0 auto;display:flex;flex-direction:column;gap:16px}
    .skills-tabs{display:flex;gap:4px;border-bottom:1px solid #e5e5e5;flex-wrap:wrap}
    .skills-tab{min-height:44px;padding:10px 18px;border:none;background:transparent;color:#666;font-size:14px;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;font-weight:500}
    .skills-tab:hover{color:#1a1a1a}
    .skills-tab.active{color:#1890ff;border-bottom-color:#1890ff;font-weight:600}
    .skills-toolbar{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
    .skills-search{flex:1;min-width:240px;min-height:44px;padding:8px 14px;border-radius:8px;border:1px solid #e5e5e5;background:#fff;font-size:14px;outline:none}
    .skills-select{min-height:44px;padding:8px 12px;border-radius:8px;border:1px solid #e5e5e5;background:#fff;font-size:14px;max-width:260px}
    .skills-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
    .skills-card{display:flex;flex-direction:column;padding:18px;border-radius:14px;border:1px solid #e5e5e5;background:#fff;cursor:pointer;transition:all .2s}
    .skills-card:hover{border-color:#1890ff;transform:translateY(-3px);box-shadow:0 6px 16px rgba(0,0,0,0.1)}
    .skills-card-avatar{width:48px;height:48px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;color:#fff;margin-bottom:14px}
    .skills-card-title{font-size:15px;font-weight:600;color:#1a1a1a;margin-bottom:6px;word-break:break-all}
    .skills-card-desc{font-size:13px;color:#666;line-height:1.5;flex:1;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
    .skills-card-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:auto;padding-top:14px;border-top:1px solid #e5e5e5}
    .skills-card-tags{display:flex;gap:6px;flex-wrap:wrap}
    .skills-tag{font-size:11px;padding:3px 10px;border-radius:8px;background:#f0f0f0;color:#666}
    .skills-tag.version{background:rgba(8,145,178,0.12);color:#0891b2}
    .skills-tag.readonly{background:rgba(229,72,77,0.12);color:#e5484d}
    .skills-tag.ok{background:rgba(37,164,87,0.12);color:#25a457}
    .skills-empty{padding:60px 20px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:12px;border:1px dashed #e5e5e5;border-radius:14px}
    .skills-empty-title{font-size:16px;font-weight:600;color:#1a1a1a}
    .skills-empty-hint{font-size:13px;color:#666}
    .skills-btn{min-height:36px;padding:6px 14px;border-radius:8px;border:1px solid #e5e5e5;background:#fff;color:#1a1a1a;font-size:13px;cursor:pointer;font-weight:500}
    .skills-btn:hover{border-color:#1890ff}
    .skills-btn.primary{border-color:#1890ff;background:#1890ff;color:#fff}
    .skills-btn.danger:hover{border-color:#e5484d;color:#e5484d}
    .skills-source-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}
    .skills-source-card{padding:20px;border-radius:14px;border:1px solid #e5e5e5;background:#fff;cursor:pointer;transition:all .2s}
    .skills-source-card:hover{border-color:#1890ff;transform:translateY(-3px)}
    .skills-source-card.missing{opacity:.55}
    .skills-source-name{font-size:14px;font-weight:600;color:#1a1a1a;margin-bottom:8px;display:flex;align-items:center;gap:8px}
    .skills-source-count{font-size:32px;font-weight:700;color:#1890ff}
    .skills-source-count.none{color:#c0c0c0}
    .skills-source-label{font-size:12px;color:#666}
    .skills-source-dir{font-size:11px;color:#999;margin-top:6px;word-break:break-all}
    .skills-drawer{position:fixed;top:0;right:0;bottom:0;width:720px;max-width:100vw;background:#f5f5f5;box-shadow:-4px 0 24px rgba(0,0,0,0.12);z-index:1001;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .25s}
    .skills-drawer.open{transform:translateX(0)}
    .skills-drawer-header{display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid #e5e5e5;background:#fff}
    .skills-drawer-title{font-size:16px;font-weight:600;color:#1a1a1a;flex:1;word-break:break-all}
    .skills-drawer-body{flex:1;overflow:auto;padding:20px}
    .skills-drawer-close{width:40px;height:40px;display:flex;align-items:center;justify-content:center;border:none;border-radius:8px;background:transparent;cursor:pointer;font-size:18px;color:#666}
    .skills-file-browser{display:flex;gap:16px;min-height:320px;margin-top:16px}
    .skills-file-list{flex:0 0 220px;border:1px solid #e5e5e5;border-radius:10px;overflow:auto;background:#fff;max-height:480px}
    .skills-file-item{display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;font-size:13px;color:#1a1a1a}
    .skills-file-item:hover{background:rgba(0,0,0,0.04)}
    .skills-file-item.selected{background:rgba(24,144,255,0.1);color:#1890ff}
    .skills-file-preview{flex:1;border:1px solid #e5e5e5;border-radius:10px;overflow:hidden;background:#fff;max-height:480px;overflow-y:auto}
    .skills-file-content{padding:16px;font-size:13px;line-height:1.7;white-space:pre-wrap;color:#1a1a1a}
    .skills-md-content h1{font-size:18px;font-weight:600;margin:0 0 14px;padding-bottom:8px;border-bottom:1px solid #e5e5e5}
    .skills-md-content h2{font-size:15px;font-weight:600;margin:18px 0 10px}
    .skills-md-content p{margin:0 0 10px}
    .skills-md-content code{background:#f0f0f0;padding:2px 6px;border-radius:4px}
    .skills-md-content pre{background:#f0f0f0;padding:12px;border-radius:8px;overflow-x:auto}
    .skills-loading{padding:60px 20px;text-align:center}
    .skills-spinner{width:36px;height:36px;border:3px solid #e5e5e5;border-top-color:#1890ff;border-radius:50%;animation:skspin .7s linear infinite;margin:0 auto 12px}
    @keyframes skspin{to{transform:rotate(360deg)}}
    .skills-list{display:flex;flex-direction:column;gap:8px}
    .skills-list-item{display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:10px;border:1px solid #e5e5e5;background:#fff}
    .skills-list-name{font-size:14px;font-weight:600;color:#1a1a1a;flex:1}
    .skills-list-meta{font-size:12px;color:#666}
    /* pointer-events guards: the closed backdrop must never block page clicks */
    .skills-backdrop{position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:999;opacity:0;transition:opacity .2s;pointer-events:none}
    .skills-backdrop.visible{opacity:1;pointer-events:auto}
    .skills-backdrop.visible{opacity:1}
    .skills-alert{padding:12px 16px;border-radius:10px;background:rgba(24,144,255,0.08);border:1px solid rgba(24,144,255,0.15);font-size:14px;margin-bottom:16px}
    .skills-meta-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px}
    .skills-meta-item{padding:12px 14px;background:#fff;border-radius:10px;border:1px solid #e5e5e5}
    .skills-meta-label{font-size:11px;color:#666;margin-bottom:3px}
    .skills-meta-value{font-size:13px;font-weight:500;color:#1a1a1a;word-break:break-all}
    .skills-actions-bar{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center}
    .skills-section-title{font-size:14px;font-weight:600;color:#1a1a1a;margin:16px 0 10px}
    </style>`

    class SkillsApp {
      constructor(root, opts = {}) {
        this.root = root
        // Host shells (footer button / settings section) get notified on close so
        // they can unmount their wrapper; otherwise the page removes itself.
        this.onClosed = typeof opts.onClosed === 'function' ? opts.onClosed : undefined
        this.data = { sources:[], market:[], installed:[] }
        this.executors = []
        this.filterExecutor = 'all'
        this.loading = true
        this.viewMode = 'executors'
        this.searchText = ""
        this.filterSource = 'all'
        this.activeSource = null
        this.selectedSkill = null
        this.selectedExecutor = null
        this.drawerOpen = false
        this.detailData = null
        this._init()
      }

      async _init() {
        document.head.insertAdjacentHTML('beforeend', STYLE)
        this._render()
        await this._loadData()
        window._skillsInstall = (n, from) => this._install(n, from)
        window._skillsView = (n) => this._viewInstalled(n)
        window._skillsDelete = (n, ex) => this._delete(n, ex)
        window._skillsCloseDrawer = () => this._closeDrawer()
        window._skillsCopy = () => navigator.clipboard.writeText(this.detailData?.content || '')
        window._skillsRefresh = () => this._loadData()
      }

      /** Close path shared by header ✕; delegates to the shell when embedded. */
      _closePage() {
        if (this.onClosed !== undefined) { const cb = this.onClosed; this.onClosed = undefined; cb(); return }
        this.root.remove()
      }

      _render() {
        this.root.innerHTML = '<div class="skills-page">' +
          '<div class="skills-header"><h1 class="skills-title">Skills Management</h1><button class="skills-close" id="sk-close">x</button></div>' +
          '<div class="skills-body"><div class="skills-inner">' +
            '<div class="skills-tabs"><button class="skills-tab active" data-t="executors">Executors</button>' +
              '<button class="skills-tab" data-t="market">Market</button>' +
              '<button class="skills-tab" data-t="sources">Sources</button>' +
              '<button class="skills-tab" data-t="installed">Installed</button></div>' +
            '<div class="skills-toolbar" id="sk-toolbar"></div><div id="sk-content"></div>' +
          '</div></div><div id="sk-drawer" class="skills-drawer"></div><div id="sk-backdrop" class="skills-backdrop"></div></div>'
        this.root.querySelectorAll('.skills-tab').forEach(t => t.onclick = () => this._switchTab(t.dataset.t))
        this.root.querySelector('#sk-close').onclick = () => this._closePage()
        this.root.querySelector('#sk-backdrop').onclick = () => this._closeDrawer()
        this._renderToolbar()
        this._renderContent()
      }

      _renderToolbar() {
        const tb = this.root.querySelector('#sk-toolbar')
        // The toolbar is rebuilt from scratch often (lazy scans, refreshes).
        // Preserve focus/selection so typing into the search box survives it.
        const doc = this.root.ownerDocument
        const prevActive = doc.activeElement
        const preserveId = prevActive && tb.contains(prevActive) && prevActive.id ? prevActive.id : null
        let preservePos = null
        if (preserveId === 'sk-search') {
          try { preservePos = prevActive.selectionStart ?? prevActive.value.length } catch { preservePos = prevActive.value.length }
        } else if (preserveId === 'sk-filter') {
          preservePos = prevActive.selectedIndex
        }
        this._renderToolbarInto(tb)
        if (preserveId !== null) {
          const el = tb.querySelector('#' + preserveId)
          if (el) {
            el.focus()
            if (preserveId === 'sk-search') { try { el.setSelectionRange(preservePos, preservePos) } catch {} }
            else if (preservePos !== null) el.selectedIndex = preservePos
          }
        }
      }

      _renderToolbarInto(tb) {
        if (this.viewMode === 'executors') {
          const opts = this.executors.map(x => '<option value="' + x.key + '">' + x.label + ' (' + this._execCount(x) + ')</option>').join('')
          tb.innerHTML = '<input class="skills-search" placeholder="Search all executor skills..." id="sk-search">' +
            '<select class="skills-select" id="sk-filter"><option value="all"' + (this.filterExecutor === 'all' ? ' selected' : '') + '>All Executors (' + this._executorSkillTotal() + ')</option>' + opts + '</select>' +
            '<div style="flex:1"></div><button class="skills-btn" id="sk-refresh">Refresh</button>'
          tb.querySelector('#sk-search').oninput = (e) => { this.searchText = e.target.value; this._renderContent() }
          tb.querySelector('#sk-filter').onchange = (e) => { this.filterExecutor = e.target.value; this.searchText = ''; this._renderToolbar(); this._renderContent() }
          tb.querySelector('#sk-refresh').onclick = () => this._loadData()
        } else if (this.viewMode === 'sources') {
          tb.innerHTML = '<input class="skills-search" placeholder="Search sources..." id="sk-search">' +
            '<div style="flex:1"></div><button class="skills-btn" id="sk-refresh">Refresh</button>'
          tb.querySelector('#sk-search').oninput = (e) => { this.searchText = e.target.value; this._renderContent() }
          tb.querySelector('#sk-refresh').onclick = () => this._loadData()
        } else if (this.viewMode === 'market') {
          const opts = this.data.sources.map(s => '<option value="' + s.source + '"' + (this.filterSource === s.source ? ' selected' : '') + '>' + (s.displayName||s.source) + ' (' + s.skills + ')</option>').join('')
          tb.innerHTML = '<input class="skills-search" placeholder="Search skills..." id="sk-search">' +
            '<select class="skills-select" id="sk-filter"><option value="all">All Sources</option>' + opts + '</select>' +
            '<div style="flex:1"></div><button class="skills-btn" id="sk-refresh">Refresh</button>'
          tb.querySelector('#sk-search').oninput = (e) => { this.searchText = e.target.value; this._renderContent() }
          tb.querySelector('#sk-filter').onchange = (e) => { this.filterSource = e.target.value; this._renderContent() }
          tb.querySelector('#sk-refresh').onclick = () => this._loadData()
        } else {
          tb.innerHTML = '<input class="skills-search" placeholder="Search installed..." id="sk-search">' +
            '<div style="flex:1"></div><button class="skills-btn" id="sk-refresh">Refresh</button>'
          tb.querySelector('#sk-search').oninput = (e) => { this.searchText = e.target.value; this._renderContent() }
          tb.querySelector('#sk-refresh').onclick = () => this._loadData()
        }
      }

      _renderContent() {
        const c = this.root.querySelector('#sk-content')
        if (this.loading) { c.innerHTML = '<div class="skills-loading"><div class="skills-spinner"></div><div>Loading...</div></div>'; return }
        if (this.viewMode === 'executors') this._renderExecutors(c)
        else if (this.viewMode === 'sources') this._renderSources(c)
        else if (this.viewMode === 'market') this._renderMarket(c)
        else this._renderInstalled(c)
      }

      _executorSkillTotal() {
        return this.executors.reduce((sum, x) => sum + this._execCount(x), 0)
      }

      /** Summary rows carry only skillCount; drilled-in rows also hold skills[]. */
      _execCount(row) {
        return Array.isArray(row.skills) ? row.skills.length : (row.skillCount || 0)
      }

      /**
       * Render items into a container pageSize at a time; a trailing button
       * appends the next chunk (keeps the DOM small for big executors).
       */
      _renderPaged(container, items, makeCard, pageSize = 60) {
        let cursor = 0
        const moreBtn = document.createElement('button')
        moreBtn.className = 'skills-btn'
        moreBtn.style.gridColumn = '1/-1'
        const placeMore = () => {
          if (cursor < items.length) {
            moreBtn.textContent = 'Show more (' + (items.length - cursor) + ' remaining)'
            container.appendChild(moreBtn)
          } else if (moreBtn.parentNode) { moreBtn.parentNode.removeChild(moreBtn) }
        }
        moreBtn.onclick = () => {
          moreBtn.parentNode && moreBtn.parentNode.removeChild(moreBtn)
          this._paintPage(container, items, cursor, pageSize, makeCard)
          cursor = Math.min(cursor + pageSize, items.length)
          placeMore()
        }
        this._paintPage(container, items, cursor, pageSize, makeCard)
        cursor = Math.min(cursor + pageSize, items.length)
        placeMore()
      }

      _paintPage(container, items, cursor, pageSize, makeCard) {
        for (const item of items.slice(cursor, cursor + pageSize)) makeCard(item)
      }

      // ── Executors tab ──

      _renderExecutors(c) {
        if (this.filterExecutor === 'all') return this._renderExecutorOverview(c)

        const row = this.executors.find(x => x.key === this.filterExecutor)
        if (!row) { c.innerHTML = ''; return }
        if (!row.dirExists) {
          c.innerHTML = '<div class="skills-empty"><div class="skills-empty-title">' + row.label + ': directory not found</div>' +
            '<div class="skills-empty-hint">Expected skills at ' + escapeHtml(row.dir) + '</div>' +
            '<button class="skills-btn" id="sk-back-exec">&larr; Back to all executors</button></div>'
          c.querySelector('#sk-back-exec').onclick = () => { this.filterExecutor = 'all'; this.searchText=''; this._renderToolbar(); this._renderContent() }
          return
        }
        // Summary rows carry no skill list yet — fetch just this source on demand
        if (!Array.isArray(row.skills)) {
          const seq = (this._detailSeq = (this._detailSeq || 0) + 1)
          c.innerHTML = '<div class="skills-loading"><div class="skills-spinner"></div><div>Scanning ' + escapeHtml(row.label) + '…</div></div>'
          fetch(API + '/executors?executor=' + encodeURIComponent(row.key))
            .then(async (r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
            .then((d) => { Object.assign(row, d.executor) })
            .catch(() => { row.skills = [] })
            .finally(() => {
              if (seq !== this._detailSeq || this.viewMode !== 'executors' || this.filterExecutor !== row.key) return
              this._renderContent()
            })
          return
        }
        let sk = row.skills
        if (this.searchText) {
          const l = this.searchText.toLowerCase()
          sk = sk.filter(s => (s.name||'').toLowerCase().includes(l) || (s.description||'').toLowerCase().includes(l) || (s.keywords||[]).some(k => k.toLowerCase().includes(l)))
        }
        if (!sk.length) { c.innerHTML = '<div class="skills-empty"><div class="skills-empty-title">' + (this.searchText ? 'No matching skills' : 'No skills in ' + row.label) + '</div>' +
          '<button class="skills-btn" id="sk-back-exec">&larr; Back to all executors</button></div>';
          c.querySelector('#sk-back-exec').onclick = () => { this.filterExecutor = 'all'; this.searchText=''; this._renderToolbar(); this._renderContent() }
          return }

        const head = document.createElement('div')
        head.style.cssText = 'display:flex;align-items:center;gap:10px'
        head.innerHTML = '<button class="skills-btn" id="sk-back-exec">&larr; Executors</button>' +
          '<span class="skills-card-title">' + escapeHtml(row.label) + '</span>' +
          '<span class="skills-tag">' + sk.length + ' skills</span>' +
          (row.readOnly ? '<span class="skills-tag readonly">read-only</span>' : '') +
          '<span style="flex:1"></span><span class="skills-source-dir">' + escapeHtml(row.dir) + '</span>'
        c.innerHTML = ''; c.appendChild(head)
        head.querySelector('#sk-back-exec').onclick = () => { this.filterExecutor = 'all'; this.searchText=''; this._renderToolbar(); this._renderContent() }

        const g = document.createElement('div'); g.className = 'skills-grid'; g.style.marginTop = '12px'
        this._renderPaged(g, sk, (s) => this._appendExecutorCard(g, row, s))
        c.appendChild(g)
      }

      _appendExecutorCard(grid, row, s) {
        const shortName = splitSkillName(s.name).shortName || s.name
        const tags = ['<span class="skills-tag">' + escapeHtml(row.label) + '</span>']
        if (row.readOnly) tags.push('<span class="skills-tag readonly">read-only</span>')
        if (s.version) tags.push('<span class="skills-tag version">v' + escapeHtml(s.version) + '</span>')
        const metaBits = (s.fileCount||0) + ' files · ' + formatSize(s.totalSize||0)
        const buttons = []
        if (row.key !== 'dsh') buttons.push('<button class="skills-btn primary" data-act="install" style="padding:4px 12px;font-size:12px">To DSH</button>')
        if (!row.readOnly) buttons.push('<button class="skills-btn danger" data-act="delete" style="padding:4px 12px;font-size:12px">Delete</button>')
        const card = document.createElement('div'); card.className = 'skills-card'
        card.innerHTML = '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">' +
            '<div class="skills-card-avatar" style="margin:0;background:' + generateGradient(shortName) + '">' + escapeHtml(shortName.charAt(0).toUpperCase()) + '</div>' +
            '<div style="min-width:0"><div class="skills-card-title">' + escapeHtml(shortName) + '</div>' +
            '<div style="font-size:11px;color:#999">' + metaBits + ' · ' + formatTime(s.modifiedAt) + '</div></div></div>' +
          '<div class="skills-card-desc">' + escapeHtml(s.description || 'No description') + '</div>' +
          '<div class="skills-card-footer"><div class="skills-card-tags">' + tags.join('') + '</div>' +
          '<div style="display:flex;gap:6px">' + buttons.join('') + '</div></div>'
        card.onclick = () => this._openDetail({ name: s.name, shortName }, row.key)
        card.querySelectorAll('[data-act]').forEach(btn => {
          btn.onclick = (e) => {
            e.stopPropagation()
            if (btn.dataset.act === 'install') this._installFromExecutor(row, s.name)
            else this._delete(s.name, row.key)
          }
        })
        grid.appendChild(card)
      }

      _renderExecutorOverview(c) {
        if (!this.executors.length && !this.loading) { c.innerHTML = '<div class="skills-empty"><div class="skills-empty-title">No executor directories found on this machine</div></div>'; return }
        const l = this.searchText.toLowerCase()
        // Cross-executor search needs full catalogs; fetch them once on demand
        if (l && this.executors.some(r => r.dirExists && !Array.isArray(r.skills))) {
          c.innerHTML = '<div class="skills-loading"><div class="skills-spinner"></div><div>Loading executor catalogs…</div></div>'
          this._ensureCatalog()
          return
        }
        let rows = this.executors
        if (l) {
          rows = this.executors
            .filter(r => r.dirExists)
            .map(r => ({ row: r, matched: r.skills.filter(s => (s.name||'').toLowerCase().includes(l) || (s.description||'').toLowerCase().includes(l)).length }))
            .filter(x => x.matched > 0)
        }
        if (l && !rows.length) { c.innerHTML = '<div class="skills-empty"><div class="skills-empty-title">No matching skills in any executor</div></div>'; return }

        const visible = l ? rows.map(x => x.row) : rows.filter(r => r.dirExists)
        const missing = l ? [] : this.executors.filter(r => !r.dirExists)
        const g = document.createElement('div'); g.className = 'skills-source-grid'
        visible.forEach(x => {
          const count = l ? x.skills.filter(s => (s.name||'').toLowerCase().includes(l) || (s.description||'').toLowerCase().includes(l)).length : this._execCount(x)
          const sizeBit = Array.isArray(x.skills)
            ? ' · total ' + formatSize(x.skills.reduce((a, s) => a + (s.totalSize||0), 0))
            : ''
          const card = document.createElement('div'); card.className = 'skills-source-card'
          card.innerHTML = '<div class="skills-source-name">' + escapeHtml(x.label) +
            (x.readOnly ? ' <span class="skills-tag readonly">read-only</span>' : '') +
            (x.key === 'dsh' ? ' <span class="skills-tag version">me</span>' : '') + '</div>' +
            '<div class="skills-source-count' + (count ? '' : ' none') + '">' + count + '</div>' +
            '<div class="skills-source-label">skills' + sizeBit + '</div>' +
            '<div class="skills-source-dir">' + escapeHtml(x.dir) + '</div>'
          card.onclick = () => { this.filterExecutor = x.key; this.searchText = ''; this._renderToolbar(); this._renderContent() }
          g.appendChild(card)
        })
        c.innerHTML = ''
        c.appendChild(g)
        if (missing.length) {
          const t = document.createElement('div'); t.className = 'skills-section-title'; t.textContent = 'Not found on this machine (' + missing.length + ')'
          const mg = document.createElement('div'); mg.className = 'skills-source-grid'
          missing.forEach(x => {
            const card = document.createElement('div'); card.className = 'skills-source-card missing'
            card.innerHTML = '<div class="skills-source-name">' + escapeHtml(x.label) + '</div>' +
              '<div class="skills-source-count none">-</div>' +
              '<div class="skills-source-label">directory not present</div>' +
              '<div class="skills-source-dir">' + escapeHtml(x.dir) + '</div>'
            mg.appendChild(card)
          })
          c.appendChild(t); c.appendChild(mg)
        }
      }

      /** Load every drilled-in catalog lazily, for cross-executor search. */
      _ensureCatalog() {
        if (this._catalogLoading) return
        this._catalogLoading = true
        const targets = this.executors.filter(x => x.dirExists && !Array.isArray(x.skills))
        Promise.all(targets.map((x) =>
          fetch(API + '/executors?executor=' + encodeURIComponent(x.key))
            .then(async (r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
            .then((d) => { Object.assign(x, d.executor) })
            .catch(() => { x.skills = []; x.skillCount = 0 })
        )).finally(() => {
          this._catalogLoading = false
          if (this.viewMode !== 'executors') return
          this._renderToolbar()
          this._renderContent()
        })
      }

      // ── Sources / Market / Installed tabs (market collection) ──

      _renderSources(c) {
        let srcs = this.data.sources
        if (this.searchText) { const l = this.searchText.toLowerCase(); srcs = srcs.filter(s => (s.source||'').toLowerCase().includes(l) || (s.displayName||'').toLowerCase().includes(l)) }
        if (!srcs.length) { c.innerHTML = '<div class="skills-empty"><div class="skills-empty-title">No sources found</div></div>'; return }
        const g = document.createElement('div'); g.className = 'skills-source-grid'
        srcs.forEach(s => {
          const cnt = this.data.market.filter(m => m.source === s.source).length
          const card = document.createElement('div'); card.className = 'skills-source-card'
          card.innerHTML = '<div class="skills-source-name">' + (s.displayName||s.source) + '</div><div class="skills-source-count">' + cnt + '</div><div class="skills-source-label">skills</div>'
          card.onclick = () => { this.activeSource = s.source; this._switchTab('market') }
          g.appendChild(card)
        })
        c.innerHTML = ''; c.appendChild(g)
      }

      _renderMarket(c) {
        let sk = this.data.market
        if (this.activeSource) sk = sk.filter(s => s.source === this.activeSource)
        else if (this.filterSource !== 'all') sk = sk.filter(s => s.source === this.filterSource)
        if (this.searchText) { const l = this.searchText.toLowerCase(); sk = sk.filter(s => (s.name||'').toLowerCase().includes(l) || (s.shortName||'').toLowerCase().includes(l) || (s.description||'').toLowerCase().includes(l)) }
        if (!sk.length) { c.innerHTML = '<div class="skills-empty"><div class="skills-empty-title">' + (this.searchText ? 'No matching skills' : 'No skills in market') + '</div></div>'; return }
        const g = document.createElement('div'); g.className = 'skills-grid'
        this._renderPaged(g, sk, (s) => {
          const {category, shortName} = splitSkillName(s.name || s.shortName || '')
          const name = shortName || s.shortName || s.name
          const grad = generateGradient(name)
          const tags = []
          if (category) tags.push('<span class="skills-tag">' + category + '</span>')
          if (s.version) tags.push('<span class="skills-tag version">v' + escapeHtml(s.version) + '</span>')
          const installBtn = s.installed ? '<span class="skills-tag version">Installed</span>' : '<button class="skills-btn primary" style="padding:4px 12px;font-size:12px">Install</button>'
          const card = document.createElement('div'); card.className = 'skills-card'
          card.innerHTML = '<div class="skills-card-avatar" style="background:' + grad + '">' + name.charAt(0).toUpperCase() + '</div>' +
            '<div class="skills-card-title">' + name + '</div><div class="skills-card-desc">' + escapeHtml(s.description||'No description') + '</div>' +
            '<div class="skills-card-footer"><div class="skills-card-tags">' + tags.join('') + '</div>' + installBtn + '</div>'
          card.onclick = () => this._openDetail(s, null)
          const btn = card.querySelector('.skills-btn.primary')
          if (btn) btn.onclick = (e) => { e.stopPropagation(); this._install(s.name) }
          g.appendChild(card)
        })
        c.innerHTML = ''; c.appendChild(g)
      }

      _renderInstalled(c) {
        let sk = this.data.installed
        if (this.searchText) { const l = this.searchText.toLowerCase(); sk = sk.filter(s => (s.name||'').toLowerCase().includes(l) || (s.description||'').toLowerCase().includes(l)) }
        if (!sk.length) {
          c.innerHTML = '<div class="skills-empty"><div class="skills-empty-title">No skills installed</div>' +
            '<div class="skills-empty-hint">Go to Market or Executors tab to install</div>' +
            '<button class="skills-btn primary" id="sk-go-market">Go to Market</button></div>'
          c.querySelector('#sk-go-market').onclick = () => this._switchTab('market')
          return
        }
        const list = document.createElement('div'); list.className = 'skills-list'
        sk.forEach(s => {
          const item = document.createElement('div'); item.className = 'skills-list-item'
          item.innerHTML = '<div style="flex:1"><div class="skills-list-name">' + s.name + '</div>' +
            '<div class="skills-list-meta">' + (s.fileCount||0) + ' files - ' + formatSize(s.totalSize||0) + ' - ' + formatTime(s.modifiedAt) + '</div></div>' +
            '<div style="display:flex;gap:8px"><button class="skills-btn" style="padding:4px 12px;font-size:12px">Detail</button>' +
            '<button class="skills-btn danger" style="padding:4px 12px;font-size:12px">Delete</button></div>'
          item.querySelector('.skills-btn').onclick = (e) => { e.stopPropagation(); this._openDetail({name:s.name, shortName:s.name}, 'dsh') }
          item.querySelector('.skills-btn.danger').onclick = (e) => { e.stopPropagation(); this._delete(s.name, 'dsh') }
          list.appendChild(item)
        })
        c.innerHTML = ''; c.appendChild(list)
      }

      _switchTab(mode) {
        this.viewMode = mode; this.searchText = ''; this.filterSource = 'all'; this.activeSource = null; this.filterExecutor = 'all'
        this.root.querySelectorAll('.skills-tab').forEach(t => t.classList.toggle('active', t.dataset.t === mode))
        this._renderToolbar(); this._renderContent()
      }

      async _loadData() {
        this.loading = true; this._renderToolbar(); this._renderContent()
        try {
          // Executors load as counts only; each source's list is fetched lazily on drill-in
          const [baseR, execR] = await Promise.all([fetch(API), fetch(API + '/executors?mode=summary')])
          if (!baseR.ok) throw new Error('HTTP ' + baseR.status)
          this.data = await baseR.json()
          if (execR.ok) { const d = await execR.json(); this.executors = d.executors || [] } else { this.executors = [] }
        } catch (e) { console.error('Load failed:', e) }
        finally { this.loading = false; this._renderToolbar(); this._renderContent() }
      }

      async _openDetail(skill, executorKey) {
        this.selectedSkill = skill; this.selectedExecutor = executorKey; this.drawerOpen = true; this.detailData = null; this._renderDrawer()
        try {
          const q = '?name=' + encodeURIComponent(skill.name) + (executorKey ? '&executor=' + encodeURIComponent(executorKey) : '')
          const r = await fetch(API + '/detail' + q)
          if (!r.ok) throw new Error('HTTP ' + r.status)
          this.detailData = await r.json(); this._renderDrawer()
        } catch (e) { console.error('Detail failed:', e) }
      }

      async _viewInstalled(name) {
        try {
          const r = await fetch(API + '/detail?name=' + encodeURIComponent(name))
          if (!r.ok) throw new Error('HTTP ' + r.status)
          this.detailData = await r.json()
          this.selectedExecutor = this.detailData.executor || 'dsh'
          this.selectedSkill = {name, shortName:name, source:'', description:this.detailData.meta?.description||'', keywords:[], installed:true, totalSize:this.detailData.totalSize}
          this.drawerOpen = true; this._renderDrawer()
        } catch (e) { console.error('Detail failed:', e) }
      }

      _renderDrawer() {
        const d = this.root.querySelector('#sk-drawer')
        const b = this.root.querySelector('#sk-backdrop')
        d.classList.toggle('open', this.drawerOpen)
        b.classList.toggle('visible', this.drawerOpen)
        if (!this.drawerOpen) return
        const skill = this.selectedSkill
        const detail = this.detailData
        const meta = detail?.meta || {}
        const files = detail?.files || []
        const content = detail?.content || detail?.contentWithMeta || ''
        const executorKey = this.selectedExecutor || detail?.executor || null
        const exRow = executorKey ? this.executors.find(x => x.key === executorKey) : null

        let metaHtml = '<div class="skills-meta-grid">' +
          '<div class="skills-meta-item"><div class="skills-meta-label">Source</div><div class="skills-meta-value">' + (exRow ? exRow.label : ((detail?.name||'').split('/')[0] || '-')) + '</div></div>' +
          '<div class="skills-meta-item"><div class="skills-meta-label">Files</div><div class="skills-meta-value">' + (detail?.fileCount||0) + '</div></div>' +
          '<div class="skills-meta-item"><div class="skills-meta-label">Size</div><div class="skills-meta-value">' + formatSize(detail?.totalSize||0) + '</div></div>'
        if (detail?.dir) metaHtml += '<div class="skills-meta-item" style="grid-column:1/-1"><div class="skills-meta-label">Path</div><div class="skills-meta-value">' + escapeHtml(detail.dir) + '</div></div>'
        if (meta.version) metaHtml += '<div class="skills-meta-item"><div class="skills-meta-label">Version</div><div class="skills-meta-value">' + escapeHtml(meta.version) + '</div></div>'
        if (meta.author) metaHtml += '<div class="skills-meta-item"><div class="skills-meta-label">Author</div><div class="skills-meta-value">' + escapeHtml(meta.author) + '</div></div>'
        metaHtml += '</div>'

        let filesHtml = ''
        if (files.length) {
          filesHtml = '<div class="skills-section-title">Files (' + files.length + ')</div><div class="skills-file-browser">' +
            '<div class="skills-file-list">' + files.map((f,i) =>
              '<div class="skills-file-item' + (i===0?' selected':'') + '" data-path="' + escapeHtml(f.path) + '">' +
              '<span style="color:' + getFileColor(f.path) + '">F</span>' +
              '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(f.path) + '</span>' +
              '<span style="font-size:11px;color:#999">' + formatSize(f.size) + '</span></div>'
            ).join('') + '</div>' +
            '<div class="skills-file-preview" id="sk-preview"><div class="skills-file-content skills-md-content">' + renderMarkdown(content) + '</div></div></div>'
        } else {
          filesHtml = '<div class="skills-section-title">Content</div><div class="skills-file-preview"><div class="skills-file-content skills-md-content">' + renderMarkdown(content) + '</div></div>'
        }

        const actions = []
        if (!exRow || exRow.key !== 'dsh') actions.push('<button class="skills-btn primary" id="sk-drawer-install">Install' + (exRow ? ' from ' + exRow.label : '') + '</button>')
        if (exRow && exRow.key === 'dsh') actions.push('<span class="skills-tag ok">active in DSH</span>')
        if (exRow && exRow.readOnly) actions.push('<span class="skills-tag readonly">read-only source</span>')
        if (exRow && !exRow.readOnly) actions.push('<button class="skills-btn danger" onclick="window._skillsDelete(window.__skName, window.__skEx)">Delete</button>')
        actions.push('<button class="skills-btn" onclick="window._skillsCopy()">Copy</button>')

        d.innerHTML = '<div class="skills-drawer-header">' +
          '<div class="skills-drawer-title">' + escapeHtml(skill?.shortName||skill?.name||'Skill Detail') + '</div>' +
          '<button class="skills-drawer-close" onclick="window._skillsCloseDrawer()">x</button></div>' +
          '<div class="skills-drawer-body">' +
            '<div class="skills-alert">' + escapeHtml(meta.description || meta.whenToUse || 'No description') + '</div>' +
            '<div class="skills-actions-bar">' + actions.join('') + '</div>' +
            metaHtml + filesHtml +
          '</div>'

        window.__skName = skill?.name
        window.__skEx = executorKey

        const installBtn = d.querySelector('#sk-drawer-install')
        if (installBtn) installBtn.onclick = () => {
          if (executorKey) this._installFromExecutor(exRow, skill?.name)
          else this._install(skill?.name)
        }

        d.querySelectorAll('.skills-file-item').forEach(item => {
          item.onclick = () => {
            d.querySelectorAll('.skills-file-item').forEach(f => f.classList.remove('selected'))
            item.classList.add('selected')
            this._loadFilePreview(item.dataset.path)
          }
        })
      }

      async _loadFilePreview(path) {
        const p = this.root.querySelector('#sk-preview')
        if (!p) return
        p.innerHTML = '<div class="skills-loading"><div class="skills-spinner"></div></div>'
        try {
          const name = this.detailData?.name || this.selectedSkill?.name
          const q = '?name=' + encodeURIComponent(name) + '&path=' + encodeURIComponent(path) + (this.selectedExecutor ? '&executor=' + encodeURIComponent(this.selectedExecutor) : '')
          const r = await fetch(API + '/file' + q)
          if (!r.ok) throw new Error('HTTP ' + r.status)
          const content = await r.text()
          const isMd = path.endsWith('.md')
          p.innerHTML = '<div class="skills-file-content' + (isMd?' skills-md-content':'') + '">' + (isMd ? renderMarkdown(content) : escapeHtml(content)) + '</div>'
        } catch (e) { p.innerHTML = '<div class="skills-file-content" style="color:#e5484d">Failed: ' + escapeHtml(e.message) + '</div>' }
      }

      _closeDrawer() { this.drawerOpen = false; this._renderDrawer() }

      async _install(name) {
        if (!confirm('Install ' + name + ' from market?')) return
        try {
          const r = await fetch(API + '/install', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name})})
          if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.error||'Install failed') }
          await this._loadData()
        } catch (e) { alert('Install failed: ' + e.message) }
      }

      async _installFromExecutor(row, name) {
        if (!row) return
        if (!confirm('Copy "' + name + '" from ' + row.label + ' into the DSH skills library?\nThe skill becomes callable through the DSH skill tool.')) return
        try {
          const r = await fetch(API + '/install', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name, from: row.key})})
          if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.error||'Install failed') }
          await this._loadData()
        } catch (e) { alert('Install failed: ' + e.message) }
      }

      async _delete(name, executor) {
        const where = executor && executor !== 'dsh' ? ' from ' + executor : ''
        if (!confirm('Delete ' + name + where + '?')) return
        try {
          const body = { name }
          if (executor) body.executor = executor
          const r = await fetch(API, {method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)})
          if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.error||'Delete failed') }
          await this._loadData()
        } catch (e) { alert('Delete failed: ' + e.message) }
      }
    }

    // ── Client-plane module: slots integration ──
    //
    // The current dsh web app has no ctx.sidebar/ctx.settings services — sidebar
    // footer buttons ("sidebar.footer.action") and settings sections
    // ("settings.section") are SLOT entries whose payload is a React component
    // plus a prop factory. Module exports `inject` (cordis services touched on
    // ctx), otherwise the loader's inject guard rejects ctx.slots access.

    function mountSkillsApp(onClosed) {
      const mount = document.createElement('div')
      document.body.appendChild(mount)
      new SkillsApp(mount, { onClosed })
      return mount
    }

    /** Sidebar footer button → toggles the full-page overlay. */
    function FooterActionEntry() {
      const [open, setOpen] = React.useState(false)
      React.useEffect(() => {
        if (!open) return
        const mountEl = mountSkillsApp(() => setOpen(false))
        return () => { mountEl.remove() }
      }, [open])
      if (open) return null
      return React.createElement('button', {
        className: 'skills-footer-action',
        title: 'Skills Market',
        style: { display:'flex', alignItems:'center', gap:'6px', margin:'4px 10px', padding:'8px 10px',
          border:'none', borderRadius:'8px', background:'transparent', color:'inherit',
          fontSize:'13px', cursor:'pointer', width:'calc(100% - 20px)', textAlign:'left' },
        onClick: () => setOpen(true),
      }, '🎯 Skills Market')
    }

    /** Settings section entry → mounts the same surface in place. */
    function SettingsSectionEntry() {
      const [holder, setHolder] = React.useState(null)
      React.useEffect(() => {
        if (!holder) return
        const mount = document.createElement('div')
        holder.appendChild(mount)
        // In-place mode: closing from inside just empties this section.
        new SkillsApp(mount)
        return () => { mount.remove() }
      }, [holder])
      return React.createElement('div', { ref: setHolder, style: { minHeight: '70vh' } })
    }

    const CLIENT_NAME = 'dsh-plugin-skills-management'

    module.exports = {
      name: CLIENT_NAME,
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => {
          ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
            name: 'sidebar.footer.action',
            id: CLIENT_NAME,
            order: 50,
            inject: () => ({}),
          }, FooterActionEntry))
        }, 'skills-management: sidebar footer action')
        ctx.effect(() => {
          ctx.slots.inject('settings.section', () => ctx.slots.register({
            name: 'settings.section',
            id: CLIENT_NAME,
            order: 90,
            label: () => 'Skills Management',
            inject: () => ({}),
          }, SettingsSectionEntry))
        }, 'skills-management: settings section')
      },
    }

    return module.exports
  }
})
