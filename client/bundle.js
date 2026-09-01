/* Generated from client/index.js by scripts/build-client.mjs — do not edit by hand.
 * Regenerate with: npm run build:client
 */
window.__ModuleLoader__.load({
  id: "@weibaohui/skills-management",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })
    var React = require("react")
    /**
     * dsh-plugin-skills-management - Browser half.
     *
     * One React app for every surface (settings section; the former sidebar
     *  full-page entry was retired — pair with dsh-settings-ui for room).
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
    let RDP = null
    try { RDP = require('react-dom') } catch {}

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

    // Sessions service (client runtime): opens the run's conversation in the
    // real UI. Resolved through dynamic ctx.inject (ui-commands precedent);
    // absence degrades the 打开对话 button to hidden.
    let sessionsApi = null
    const sessionsSvc = () => sessionsApi

    // Composer services (inputTriggers + sessions) for the ＋ 技能 button plus
    // the `connection` service for the picker's skill catalog: the button opens
    // the plugin's own searchable picker popover (the host slash menu filters
    // only by a typed query, which a button click cannot provide); the pick is
    // written into the draft through the same scoped `slash/input-insert-text`
    // event the host menu executes. Absence hides the button; nothing else
    // depends on it.
    let composerScope = null
    let connectionApi = null

    /**
     * Open one registered '/' source over a synthetic collapsed span appended at
     * the draft end (host toggleCommandMenu 同款调用形状；标准 kit 不暴露光标，
     * pick 依赖 span-CAS：点击后草稿若再变动则本次 pick 静默作废）。
     *
     * NOTE: the ＋ 技能 button no longer uses this — the host menu cannot offer
     * a search box, so the button opens SkillPicker instead. Kept for the
     * contract tests and as the documented toggleSource path.
     */
    function openTriggerSource(scope, sessionId, input, sourceName) {
      const inputTriggers = scope && scope.inputTriggers
      const sessions = scope && scope.sessions
      if (!inputTriggers || !sessions) return false
      let actx
      try { actx = sessions.scope(sessionId) } catch { return false }
      if (actx === undefined || actx === null) return false
      let controller
      try { controller = inputTriggers.sessionOf(actx) } catch { return false }
      const draft = (input && input.draft) || ''
      const at = draft.length
      controller.toggleSource(sourceName, {
        trigger: '/',
        query: '',
        quoted: false,
        position: draft.trim() === '' ? 'leading' : 'inline',
        span: { start: at, end: at, draftRev: (input && input.draftRev) || 0 },
      })
      return true
    }

    /**
     * Insert `text` at the end of the session draft through the same scoped
     * event the host slash menu executes (`slash/input-insert-text`). The span
     * CAS uses the freshest input snapshot handed to the slot props — while the
     * picker popover is open the composer draft cannot move (focus is in the
     * picker), so the splice applies; a stale snapshot quietly no-ops, same as
     * the host menu's span-CAS.
     */
    function insertComposerText(scope, sessionId, input, text) {
      const sessions = scope && scope.sessions
      if (!sessions) return false
      let actx
      try { actx = sessions.scope(sessionId) } catch { return false }
      if (actx === undefined || actx === null || typeof actx.bail !== 'function') return false
      const draft = (input && input.draft) || ''
      const at = draft.length
      try {
        return actx.bail(actx, 'slash/input-insert-text', {
          text,
          span: { start: at, end: at, draftRev: (input && input.draftRev) || 0 },
        }) === true
      } catch { return false }
    }

    /** Best-effort refocus of the composer textarea after the picker closes. */
    function refocusComposer() {
      try {
        const card = document.querySelector('[data-composer-card]')
        const ta = card && card.querySelector('textarea')
        if (ta && typeof ta.focus === 'function') ta.focus()
      } catch {}
    }

    /** Picker popover list cap — beyond this the search input is the filter. */
    const PICKER_ROW_CAP = 200

    /** Skill catalog cache for the picker (ui-skill 同源：connection.api.skills). */
    let skillCatalog = { sessionId: null, at: 0, rows: null }
    const SKILL_CATALOG_TTL = 60_000

    /**
     * Picker candidates from the host skill registry (the same list the `/`
     * skill source shows). Subagent sessions have no catalog (ui-skill 同款守卫);
     * a failed/absent connection rejects → the picker shows its empty state.
     */
    async function fetchSkillCandidates(connection, sessions, sessionId) {
      try { if (sessions && typeof sessions.subagentAddress === 'function' && sessions.subagentAddress(sessionId) !== undefined) return [] } catch {}
      const now = Date.now()
      if (skillCatalog.rows !== null && skillCatalog.sessionId === sessionId && now - skillCatalog.at < SKILL_CATALOG_TTL) return skillCatalog.rows
      const skills = connection && connection.api && connection.api.skills
      if (!skills || typeof skills.list !== 'function') throw new Error('connection.api.skills unavailable')
      const res = await skills.list({ sessionId })
      const result = res && res.result
      if (!result || result.ok !== true) throw new Error('skill.list failed')
      const list = result.value && Array.isArray(result.value.skills) ? result.value.skills : []
      const rows = list.map((s) => ({ name: s.name, description: s.description || '', modelInvocable: s.modelInvocable !== false }))
      skillCatalog = { sessionId, at: now, rows }
      return rows
    }

    /**
     * ＋ 技能 picker：锚定在按钮上方、自带搜索框的候选浮层（portal 到 body）。
     * 宿主斜杠菜单靠「输入的 query」过滤，按钮打开的菜单没有输入载体——候选
     * 太多时无从筛选，所以浮层自带搜索框。键盘 ↑/↓/Enter/Esc，鼠标 hover+点击。
     */
    function SkillPicker(props) {
      const t = props.t
      const [query, setQuery] = useState('')
      const [active, setActive] = useState(0)
      const inputRef = useRef(null)
      const listRef = useRef(null)
      useEffect(() => { try { if (inputRef.current) inputRef.current.focus() } catch {} }, [])
      useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape' && !(e.isComposing === true)) props.onClose() }
        try { document.addEventListener('keydown', onKey) } catch {}
        return () => { try { document.removeEventListener('keydown', onKey) } catch {} }
      }, [])
      const lower = query.trim().toLowerCase()
      const all = props.rows || []
      const filtered = lower === '' ? all : all.filter((r) => matchSkill(r, lower))
      const shown = filtered.slice(0, PICKER_ROW_CAP)
      useEffect(() => { setActive(0) }, [lower, props.rows])
      useEffect(() => {
        const list = listRef.current
        const el = list && list.children[active]
        if (el && typeof el.scrollIntoView === 'function') { try { el.scrollIntoView({ block: 'nearest' }) } catch {} }
      }, [active])
      const onKeyDown = (e) => {
        // IME 组词中的按键不触发选择（回车是选定拼音候选，不是 pick）
        if (e.nativeEvent && e.nativeEvent.isComposing === true) return
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, shown.length - 1)) }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
        else if (e.key === 'Enter') { e.preventDefault(); const row = shown[active]; if (row) props.onPick(row) }
      }
      const width = 400
      const winW = typeof window !== 'undefined' ? window.innerWidth : 800
      const winH = typeof window !== 'undefined' ? window.innerHeight : 600
      const left = Math.max(8, Math.min(props.anchor.left, winW - width - 8))
      const bottom = Math.max(8, winH - props.anchor.top + 6)
      return h('div', { className: 'sk-picker-backdrop', onMouseDown: (e) => { if (e.target === e.currentTarget) props.onClose() } },
        h('div', { className: 'sk-picker', style: { left, bottom, width }, role: 'dialog', 'aria-label': t('pickSkillTitle') },
          h('input', {
            ref: inputRef, className: 'sk-input sk-picker-input', value: query,
            placeholder: t('pickerSearch'), onChange: (e) => setQuery(e.target.value), onKeyDown,
          }),
          h('div', { className: 'sk-picker-list', ref: listRef, role: 'listbox' },
            props.rows === null
              ? h('div', { className: 'sk-picker-empty' }, t('pickerLoading'))
              : shown.length === 0
                ? h('div', { className: 'sk-picker-empty' }, t('emptySearch'))
                : shown.map((row, i) => h('button', {
                    key: row.name, type: 'button', role: 'option', 'aria-selected': i === active,
                    className: 'sk-picker-row', 'data-active': i === active,
                    onMouseEnter: () => setActive(i),
                    onMouseDown: (e) => { e.preventDefault(); props.onPick(row) },
                  },
                    h('span', { className: 'sk-picker-name' }, row.name),
                    h('span', { className: 'sk-picker-desc' },
                      row.modelInvocable ? row.description : `${t('pickerUserOnly')} · ${row.description}`))))))
    }

    // ── Locale ───────────────────────────────────────────────────────────────

    const NS = 'skillsManagement'

    const ZH = {
      title: '技能市场',
      close: '关闭',
      tabExecutors: '已安装',
      tabMarket: '市场',
      tabSources: '来源',
      cardsHint: '选择一个智能体工具浏览它的技能，或一次查看全部',
      marketCardsHint: '选择一个来源仓库浏览其技能，或一次查看全部',
      marketLoading: '正在加载市场目录…',
      marketSettings: '市场设置',
      syncNow: '立即同步',
      syncing: '同步中，可能需要一分钟…',
      syncDoneUpdated: '同步完成，市场已更新',
      syncDoneLatest: '已是最新版本',
      firstCloneDone: '首次克隆完成',
      repoUrlLabel: '仓库地址',
      branchLabel: '分支',
      lastSyncLabel: '上次同步',
      localCommitLabel: '本地版本',
      remoteCommitLabel: '远程版本',
      needsUpdateTag: '有更新',
      autoSyncLabel: '每天自动同步',
      syncOnStartupLabel: '启动时同步',
      save: '保存',
      saved: '设置已保存',
      gitMissing: '未检测到 git',
      repoDirLabel: '本地目录（同步内容存放处）',
      tokenLabel: '访问令牌（分享到社区/私有仓库需要）',
      tokenConfigured: '已配置',
      clearToken: '清除',
      shareBtn: '分享',
      shareTitle: '分享技能到官方仓库',
      shareHintPatMissing: '尚未配置访问令牌：先在 ⚙ 市场设置 中保存 GitCode 令牌，AI 才能以你的身份提交 PR。',
      shareHint: 'AI 将读取本机令牌，fork 官方仓库 → 建分支 → 提交该技能目录 → 创建 PR。确认或修改提示词后，复制到当前会话发送执行。',
      shareParamName: '技能名',
      shareParamDir: '本机目录',
      shareParamRemote: '目标路径',
      shareParamVersion: '版本',
      copyPrompt: '复制提示词',
      runBtn: '执行',
      openChat: '打开对话',
      running: '执行中…（可能需要几分钟）',
      runDone: '执行完成',
      runFailed: '执行失败',
      outputLabel: '执行输出',
      promptCopied: '提示词已复制，粘贴到输入框发送即可执行',
      repoMissing: '尚未克隆，点「立即同步」拉取',
      backSources: '← 按来源',
      backMarketCards: '← 来源卡片',
      allMarketTitle: '全部市场技能',
      browseAllMarket: '浏览全部市场技能',
      showMore: '显示更多（剩余 {n}）',
      browseAll: '浏览全部技能',
      refresh: '刷新',
      backCards: '← 智能体工具卡片',
      backExecutors: '← 已安装',
      backAll: '← 全部技能',
      searchAll: '搜索全部技能…',
      filterWithin: '在 {label} 内筛选…',
      pickSource: '全部智能体工具',
      loadingCatalogs: '正在加载全部智能体工具目录…',
      scanning: '正在扫描 {label}…',
      skillsSuffix: '个技能',
      noExecutors: '本机未发现任何智能体工具目录',
      dirMissingTitle: '{label}：目录不存在',
      dirMissingHint: '预期位置 {dir}',
      notFoundGroup: '本机不存在的来源（{n}）',
      dirNotPresent: '目录不存在',
      emptySearch: '没有匹配的技能',
      emptySkillsIn: '{label} 中还没有技能',
      installedTag: '已装',
      readOnlyTag: '只读',
      toDsh: '安装',
      deleteBtn: '删除',
      detail: '详情',
      filesCount: '{n} 个文件',
      totalSize: '共 {size}',
      copy: '复制内容',
      copied: '已复制到剪贴板',
      installFrom: '从 {label} 安装',
      installTitle: '安装',
      installOk: '确认安装',
      cancel: '取消',
      installedToast: '已装入 DSH 技能库',
      marketLabel: '市场',
      installConfirm: '即将把「{name}」从「{label}」安装到 DSH 技能库，安装后可通过 DSH 的 skill 工具调用。',
      installFromMarket: '从市场安装 {name}？',
      deleteTitle: '删除技能',
      deleteConfirm: '即将从「{where}」删除技能「{name}」，删除后不可恢复。',
      whereDsh: 'DSH 技能库',
      operationFailed: '操作失败',
      preview: '文件预览',
      content: '内容',
      activeInDsh: '已在 DSH 生效',
      invocationToggle: '模型可调用',
      hiddenTag: '已隐藏',
      hideAction: '隐藏',
      restoreAction: '恢复可见',
      modelVisibleTag: '模型可见',
      detailHideAction: '在模型目录隐藏',
      invocationOn: '模型可见',
      invocationOff: '已从模型目录隐藏',
      invocationHint: '关闭后技能保留在库里，但不再注入对话目录（skill 工具也调不到）',
      pathLabel: '路径',
      meTag: '本机',
      pickSkill: '＋ 技能',
      pickSkillTitle: '选择一个技能，其内容将注入本条消息',
      pickerSearch: '搜索技能名称或描述…',
      pickerLoading: '正在加载技能目录…',
      pickerUserOnly: '仅用户',
    }

    const EN = {
      title: 'Skills Market',
      close: 'Close',
      tabExecutors: 'Installed',
      tabMarket: 'Market',
      tabSources: 'Sources',
      cardsHint: 'Pick an agent tool to browse its skills, or view everything at once',
      marketCardsHint: 'Pick a source repo to browse its skills, or view everything at once',
      marketLoading: 'Loading market catalog…',
      marketSettings: 'Market Settings',
      syncNow: 'Sync now',
      syncing: 'Syncing, may take a minute…',
      syncDoneUpdated: 'Synced, market updated',
      syncDoneLatest: 'Already up to date',
      firstCloneDone: 'Initial clone complete',
      repoUrlLabel: 'Repository URL',
      branchLabel: 'Branch',
      lastSyncLabel: 'Last sync',
      localCommitLabel: 'Local commit',
      remoteCommitLabel: 'Remote commit',
      needsUpdateTag: 'Updates available',
      autoSyncLabel: 'Auto sync daily',
      syncOnStartupLabel: 'Sync on startup',
      save: 'Save',
      saved: 'Settings saved',
      gitMissing: 'git not found',
      repoDirLabel: 'Local directory (sync target)',
      tokenLabel: 'Access token (community sharing / private repos)',
      tokenConfigured: 'configured',
      clearToken: 'Clear',
      shareBtn: 'Share',
      shareTitle: 'Share skill to the official repo',
      shareHintPatMissing: 'No access token configured — save a GitCode token in ⚙ Market Settings first so the AI can open the PR as you.',
      shareHint: 'The AI will read the local token, fork the official repo, create a branch, commit this skill directory and open a PR. Review or edit the prompt, copy it into the current session and send.',
      shareParamName: 'Skill',
      shareParamDir: 'Local directory',
      shareParamRemote: 'Remote path',
      shareParamVersion: 'Version',
      copyPrompt: 'Copy prompt',
      runBtn: 'Run',
      openChat: 'Open chat',
      running: 'Running… (may take minutes)',
      runDone: 'Run complete',
      runFailed: 'Run failed',
      outputLabel: 'Output',
      promptCopied: 'Prompt copied — paste into the composer and send',
      repoMissing: 'Not cloned yet — hit Sync now',
      backSources: '← By source',
      backMarketCards: '← Source cards',
      allMarketTitle: 'All Market Skills',
      browseAllMarket: 'Browse all market skills',
      showMore: 'Show more ({n} left)',
      browseAll: 'Browse all skills',
      refresh: 'Refresh',
      backCards: '← Agent tool cards',
      backExecutors: '← Installed',
      backAll: '← All skills',
      searchAll: 'Search all skills…',
      filterWithin: 'Filter within {label}…',
      pickSource: 'All agent tools',
      loadingCatalogs: 'Loading all agent tool catalogs…',
      scanning: 'Scanning {label}…',
      skillsSuffix: 'skills',
      noExecutors: 'No agent tool directories found on this machine',
      dirMissingTitle: '{label}: directory not found',
      dirMissingHint: 'Expected skills at {dir}',
      notFoundGroup: 'Not found on this machine ({n})',
      dirNotPresent: 'directory not present',
      emptySearch: 'No matching skills',
      emptySkillsIn: 'No skills in {label}',
      installedTag: 'Installed',
      readOnlyTag: 'read-only',
      toDsh: 'Install',
      deleteBtn: 'Delete',
      detail: 'Detail',
      filesCount: '{n} files',
      totalSize: '{size}',
      copy: 'Copy content',
      copied: 'Copied to clipboard',
      installFrom: 'Install from {label}',
      installTitle: 'Install',
      installOk: 'Install',
      cancel: 'Cancel',
      installedToast: 'Installed into the DSH library',
      marketLabel: 'Market',
      installConfirm: 'Install "{name}" from {label} into the DSH skills library. It becomes callable through the DSH skill tool.',
      installFromMarket: 'Install {name} from market?',
      deleteTitle: 'Delete skill',
      deleteConfirm: 'You are about to delete "{name}" from {where}. This cannot be undone.',
      whereDsh: 'the DSH library',
      operationFailed: 'Operation failed',
      preview: 'File preview',
      content: 'Content',
      activeInDsh: 'active in DSH',
      invocationToggle: 'Model-invocable',
      hiddenTag: 'hidden',
      hideAction: 'Hide',
      restoreAction: 'Restore',
      modelVisibleTag: 'model-visible',
      detailHideAction: 'Hide from model catalog',
      invocationOn: 'model-visible',
      invocationOff: 'hidden from model catalog',
      invocationHint: 'When off, the skill stays in the library but is not injected into conversation catalogs',
      pathLabel: 'Path',
      meTag: 'me',
      pickSkill: '+ Skill',
      pickSkillTitle: 'Pick a skill; its content is injected into this message',
      pickerSearch: 'Search skills by name or description…',
      pickerLoading: 'Loading skill catalog…',
      pickerUserOnly: 'user-only',
    }

    // ── Pure helpers ────────────────────────────────────────────────────────

    /** ntd ActionButton 同款 {{key}} 替换:split/join 规避正则元字符 */
    function substituteParams(template, params) {
      let out = template
      for (const [key, value] of Object.entries(params)) {
        out = out.split(`{{${key}}}`).join(String(value))
      }
      return out
    }

    const SHARE_PROMPT_ZH = [
      '请把本地技能「{{skillName}}」{{version}}打包提交到 GitCode 官方仓库，作为一个 PR 供维护者审核。',
      '',
      '## 关键信息',
      '- 技能目录：{{resourceDir}}（~ 表示当前用户家目录，执行前先展开为绝对路径）',
      '- 官方仓库：weibaohui/ntd-resource（GitCode，API base = https://api.gitcode.com）',
      '- PAT 位置：~/.dsh/settings.yaml 中 skills-management.market 段的 token 字段（由技能市场设置面板保存）。',
      '',
      '## 执行步骤（严格按顺序）',
      '1. 读取 PAT：读取 ~/.dsh/settings.yaml，定位 skills-management.market 段下的 token 字段。token 是敏感凭据，读取后不要把明文打印到输出、日志或最终结果里。',
      '2. 展开技能目录为绝对路径，遍历该目录，收集每个文件的「相对该目录的路径」与内容；跳过 .downloaded_at、.clawhub、.git 三类同步元数据。',
      '3. 把第 1 步读到的 token 作为 HTTP 认证令牌，附加到下面每个 GitCode API 请求的认证头里（bearer 认证方式），不要写成占位符：',
      '   a. 验证用户：`GET https://api.gitcode.com/api/v5/user`，拿到返回的 login 字段——这是 token 真实所属的账号，后续所有 URL 里的 {owner} 一律用它。',
      '   b. fork：`POST https://api.gitcode.com/api/v5/repos/weibaohui/ntd-resource/forks`；若返回 409/422 表示已 fork，视为成功。',
      '   c. 建分支：`POST https://api.gitcode.com/api/v5/repos/{步骤 a 的 login}/ntd-resource/branches`，JSON body 为 {"branch_name":"contrib/{{skillName}}-<unix 时间戳>","refs":"main"}。',
      '   d. 写文件：对第 2 步收集的每个文件，`POST https://api.gitcode.com/api/v5/repos/{步骤 a 的 login}/ntd-resource/contents/{{remotePath}}<该文件的相对路径>`。**必须**用这个远端路径前缀，不能写到仓库根目录。表单字段 content=<文件字节的 base64>、message="贡献技能 {{skillName}} {{version}}"、branch=<步骤 c 的分支名>。',
      '   e. 创建 PR：`POST https://api.gitcode.com/api/v5/repos/weibaohui/ntd-resource/pulls`，JSON body 为 {"title":"[技能] {{skillName}} {{version}}","body":"技能目录 {{resourceDir}} 的文件清单与用途简介","head":"{步骤 a 的 login}:{branch}","base":"main"}。',
      '4. 完成后，最终输出 PR 的网页链接（响应里的 web_url 字段）。',
      '',
      '## 注意',
      '- token 是敏感凭据，任何输出里都不要回显其明文。',
      '- 如果任一步骤失败，先检查错误信息，不要盲目重试；若 token 失效，提示用户到技能市场的 ⚙ 设置面板重新填写。',
      '- 全程与最终汇报都使用中文。',
    ].join('\n')

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
    .sk-overlay{position:fixed;inset:0;z-index:2147483000;background:var(--dsw-alias-bg-base);overflow:auto;padding:20px 26px}
    .sk-tabs{display:flex;gap:6px;border-bottom:1px solid var(--dsw-alias-border-l2);padding-bottom:10px}
    .sk-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
    .sk-body{display:flex;flex-direction:column;gap:14px}
    .sk-inv-toggle{display:inline-flex;gap:8px;align-items:center}
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
    .sk-avatar.sq{border-radius:12px}
    .sk-avatar{width:42px;height:42px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--dsw-alias-label-primary-inverted,#fff);font-size:17px;flex:none}
    .sk-title{font-weight:600;word-break:break-all}
    .sk-desc{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
    .sk-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:auto;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1);flex-wrap:wrap}
    .sk-chips{display:flex;gap:6px;flex-wrap:wrap;min-width:0}
    .sk-rowbtns{display:flex;gap:6px;flex-wrap:wrap}
    .sk-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
    .sk-countline{display:flex;align-items:baseline;gap:2px;color:var(--dsw-alias-label-secondary);font-size:13px}
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
    .sk-dlg-backdrop{position:fixed;inset:0;z-index:30;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:24px}
    .sk-dlg{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;min-width:340px;max-width:640px;max-height:82vh;overflow:auto;padding:18px;box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family)}
    .sk-dlg h3{margin:0 0 12px;font-size:15px}
    .sk-dlg-foot{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
    .sk-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:6px 16px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;cursor:pointer;font-family:var(--dsw-font-family);white-space:nowrap}
    .sk-btn:hover{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover)}
    .sk-btn:disabled{opacity:.5;cursor:not-allowed}
    .sk-btn-primary{background:var(--dsw-alias-state-business-primary);border-color:transparent;color:var(--dsw-alias-label-primary-inverted,#fff)}
    .sk-btn-primary:hover{filter:brightness(1.08);background:var(--dsw-alias-state-business-primary)}
    .sk-btn-sm{min-height:28px;padding:4px 12px;font-size:12.5px;min-width:64px}
    .sk-input{min-height:32px;padding:6px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:13px;font-family:var(--dsw-font-family);outline:none}
    .sk-input:focus{border-color:var(--dsw-alias-state-business-primary)}
    .sk-input::placeholder{color:var(--dsw-alias-label-tertiary)}
    .sk-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:40;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:8px 18px;font-size:13px;box-shadow:var(--dsw-shadow-lv2)}
    .sk-menu{position:absolute;top:100%;left:0;margin-top:4px;min-width:220px;max-height:340px;overflow:auto;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;box-shadow:var(--dsw-shadow-lv2,var(--dsw-shadow-lv1));z-index:2147483600;padding:4px}
    .sk-menu-item{padding:8px 12px;border-radius:8px;cursor:pointer;color:var(--dsw-alias-label-primary);font-size:13px;white-space:nowrap}
    .sk-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
    .sk-menu-item.on{color:var(--dsw-alias-state-business-primary);font-weight:500}
    .sk-tabpill{background:transparent;border:none;color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-family)}
    .sk-chip{display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-family);font-size:12px;cursor:pointer;white-space:nowrap}
    .sk-chip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
    .sk-picker-backdrop{position:fixed;inset:0;z-index:2147483200}
    .sk-picker{position:fixed;z-index:2147483201;width:400px;max-width:92vw;max-height:360px;display:flex;flex-direction:column;gap:4px;padding:6px;background:var(--dsw-specific-menu);border:1px solid var(--dsw-alias-border-inverted);border-radius:12px;box-shadow:var(--dsw-shadow-lv3)}
    .sk-picker-input{flex:none;box-sizing:border-box;width:100%}
    .sk-picker-list{display:flex;flex-direction:column;min-height:40px;overflow-y:auto}
    .sk-picker-row{display:flex;align-items:center;gap:8px;width:100%;min-height:36px;padding:6px 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer;font-family:var(--dsw-font-family);font-size:13px}
    .sk-picker-row[data-active="true"]{background:var(--dsw-alias-interactive-bg-hover)}
    .sk-picker-name{flex:none;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
    .sk-picker-desc{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:12px}
    .sk-picker-empty{padding:12px 10px;text-align:center;color:var(--dsw-alias-label-dimmed);font-size:13px}
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

    function Avatar({ name, square, size }) {
      const sizing = size ? { width: size, height: size, fontSize: Math.round(size * 0.42) } : {}
      return h('div', { className: 'sk-avatar' + (square ? ' sq' : ''),
          style: { background: gradient(name), ...sizing } },
        (name[0] || '?').toUpperCase())
    }

    /** Executor dropdown: self-contained popover (host primitives expose no Menu). */
    function SourceFilter({ rows, value, onChange, t }) {
      const [open, setOpen] = useState(false)
      const items = [
        { id: 'all', label: `${t('pickSource')} (${rows.reduce((a, r) => a + r.skillCount, 0)})` },
        ...rows.map(x => ({ id: x.key, label: `${x.label} (${x.skillCount})` })),
      ]
      const current = value === 'all' ? null : rows.find(r => r.key === value)
      const label = value === 'all'
        ? `${t('pickSource')} (${rows.reduce((a, r) => a + r.skillCount, 0)})`
        : `${current ? current.label : value} (${current ? current.skillCount : 0})`
      return h('span', { style: { position: 'relative', display: 'inline-flex' } },
        h(P.Button, { variant: 'outline', size: 'sm',
            onClick: () => setOpen(o => !o), title: label },
          label,
          P.IconChevronDownOutline14 ? h(P.IconChevronDownOutline14, { size: 12 }) : ' ▾'),
        open && h('div', { className: 'sk-menu' },
          items.map(item => h('div', {
            key: item.id,
            className: 'sk-menu-item' + (item.id === value ? ' on' : ''),
            role: 'button', tabIndex: 0,
            onClick: () => { onChange(item.id); setOpen(false) },
            onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { onChange(item.id); setOpen(false) } },
          }, item.label))))
    }

    // ── Skill / executor cards ───────────────────────────────────────────────

    function SkillCard({ row, s, t, onOpen, onInstall, onDelete, onShare, onToggleVisible }) {
      const name = shortName(s.name)
      return h('div', { className: 'sk-card', role: 'button', tabIndex: 0,
          onClick: () => onOpen(s),
          onKeyDown: e => e.key === 'Enter' && onOpen(s) },
        h('div', { style: { display: 'flex', gap: 12, alignItems: 'center' } },
          h(Avatar, { name }),
          h('div', { style: { minWidth: 0 } },
            h('div', { className: 'sk-title' }, name),
            (s.fileCount || s.totalSize) && h('div', { className: 'sk-dir' }, `${s.fileCount || 0} · ${formatSize(s.totalSize || 0)} · ${formatTime(s.modifiedAt)}`))),
        h('div', { className: 'sk-desc' }, s.description || ''),
        h('div', { className: 'sk-foot' },
          h('div', { className: 'sk-chips' },
            h(Tag, null, row.label),
            row.readOnly && h(Tag, { tone: 'danger' }, t('readOnlyTag')),
            s.version && h(Tag, { tone: 'accent' }, 'v' + s.version),
            (row.key === 'dsh' || row.key === 'agents') && s.modelInvocable === false && h(Tag, { tone: 'danger' }, t('hiddenTag'))),
          h('div', { className: 'sk-rowbtns' },
            row.key !== 'dsh' && h(ButtonLite, { primary: true, small: true,
              onClick: e => { e.stopPropagation(); onInstall(row, s.installName || s.name) } }, t('toDsh')),
            (row.key === 'dsh' || row.key === 'agents') && h(ButtonLite, { small: true,
              title: s.modelInvocable === false ? t('restoreAction') : t('hideAction'),
              onClick: e => { e.stopPropagation(); onToggleVisible(row, s.name, s.modelInvocable === false) } },
              s.modelInvocable === false ? t('restoreAction') : t('hideAction')),
            (row.deletable !== false && !row.readOnly) && h(ButtonLite, { danger: true, small: true,
              onClick: e => { e.stopPropagation(); onDelete(row, s.name) } }, t('deleteBtn')),
            onShare && h(ButtonLite, { small: true, title: t('shareBtn'),
              onClick: e => { e.stopPropagation(); onShare(row, s) } }, t('shareBtn')))))
    }

    /** Tiny variant buttons before P.Button availability resolution settles —
     *  unified through primitives in the browser via data-p-* swap below. */
    function ButtonLite({ primary, danger, small, children, ...rest }) {
      const cls = 'sk-btn' + (primary ? ' sk-btn-primary' : '') + (small ? ' sk-btn-sm' : '')
      if (prim('Button')) {
        return h(P.Button, {
          variant: primary ? 'primary' : 'outline',
          size: small ? 'sm' : 'md',
          className: cls,
          ...rest,
        }, children)
      }
      return h('button', {
        className: cls,
        ...rest,
      }, children)
    }

    function ExecutorCard({ row, t, onEnter }) {
      const count = Array.isArray(row.skills) ? row.skills.length : (row.skillCount || 0)
      const sizeTotal = Array.isArray(row.skills) ? row.skills.reduce((a, s) => a + (s.totalSize || 0), 0) : null
      return h('div', { className: 'sk-card', role: 'button', tabIndex: 0, style: !row.dirExists ? { opacity: 0.5, cursor: 'default' } : undefined,
          onClick: () => row.dirExists && onEnter(row.key),
          onKeyDown: e => e.key === 'Enter' && row.dirExists && onEnter(row.key) },
        h('div', { className: 'sk-head' },
          h(Avatar, { name: row.label, square: true, size: 40 }),
          h('span', { className: 'sk-title' }, row.label),
          row.readOnly && h(Tag, { tone: 'danger' }, t('readOnlyTag')),
          row.key === 'dsh' && h(Tag, { tone: 'accent' }, t('meTag'))),
        h('div', { className: 'sk-countline' },
          row.dirExists
            ? [h('span', { key: 'n', className: 'sk-count' + (count ? '' : ' none') }, String(count)),
               ' ' + t('skillsSuffix') + (sizeTotal != null ? ' · ' + t('totalSize', { size: formatSize(sizeTotal) }) : '')]
            : t('dirNotPresent')),
        h('div', { className: 'sk-dir' }, row.dir))
    }

    // ── Detail modal ─────────────────────────────────────────────────────────

    function DetailModal({ sel, executors, t, onClose, onInstalled, onDeleted }) {
      const [data, setData] = useState(null)
      const [file, setFile] = useState(null)
      const [fileText, setFileText] = useState('')
      const [confirming, setConfirming] = useState(false)
      const [toast, setToast] = useState(false)
      const meta = data?.meta || {}
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
          setTimeout(() => setToast(false), 2200)
        }).catch(() => {})
      }

      // 治理键开关（dsh 原生 disable-model-invocation）：对用户库（dsh 行）和
      // user-agents 根（agents 行——dsh 内置扫描 ~/.agents/skills）的技能开放
      const [invBusy, setInvBusy] = useState(false)
      const modelVisible = meta['disable-model-invocation'] !== true
      const toggleInvocation = async () => {
        setInvBusy(true)
        try {
          const r = await fetch(API + '/invocation', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: sel.name, modelInvocable: !modelVisible }) })
          if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'HTTP ' + r.status)
          const q = `?name=${encodeURIComponent(sel.name)}${sel.executorKey ? '&executor=' + encodeURIComponent(sel.executorKey) : ''}`
          getJson(API + '/detail' + q).then(d => { setData(d) }).catch(() => {})
        } catch (e) { alert(t('operationFailed') + ': ' + e.message) } finally { setInvBusy(false) }
      }

      const files = data?.files || []
      const isMd = file ? file.path.endsWith('.md') : true

      return h('div', null,
        h(SkDialog, { title: shortName(sel.name), onClose, wide: true },
              h('div', { className: 'sk-page' },
                h('div', { className: 'sk-hint' }, meta.description || meta.whenToUse || ''),
                h('div', { className: 'sk-toolbar' },
                  row && row.key !== 'dsh' && h(P.Button, { variant: 'primary', size: 'sm', onClick: doInstall }, `${t('installFrom', { label: row.label })}`),
                  row && row.key === 'dsh' && h(Tag, { tone: 'ok' }, t('activeInDsh')),
                  row && (row.key === 'dsh' || row.key === 'agents') && h('span', { className: 'sk-inv-toggle', title: t('invocationHint') },
                    h('span', { className: 'sk-dir' }, t('invocationToggle')),
                    modelVisible ? h(Tag, { tone: 'ok' }, t('modelVisibleTag')) : h(Tag, { tone: 'danger' }, t('hiddenTag')),
                    h(P.Button, { size: 'sm', variant: 'outline', disabled: invBusy, onClick: toggleInvocation },
                      modelVisible ? t('detailHideAction') : t('restoreAction'))),
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
                        : h('pre', { style: { whiteSpace: 'pre-wrap', margin: 0 } }, data?.content || '')))),
        confirming && h(SkDialog, {
          title: t('deleteTitle'),
          onClose: () => setConfirming(false),
          footer: [
            h(ButtonLite, { onClick: () => setConfirming(false) }, t('cancel')),
            h(ButtonLite, { danger: true, primary: true, onClick: doDelete }, t('deleteBtn')),
          ],
        }, h('div', { className: 'sk-hint' }, t('deleteConfirm', { name: sel.name, where: row ? row.label : t('whereDsh') }))),
        toast && h(InToast, { text: t('copied') }))
    }

    /** In-page dialog: rendered INSIDE the fullscreen overlay's stacking context
     *  so it can never fall behind it (host Modal portals to <body> with a lower
     *  z-index than the fullscreen page and would be invisible). */
    function SkDialog({ title, onClose, footer, children, wide }) {
      return h('div', { className: 'sk-dlg-backdrop', onClick: onClose },
        h('div', { className: 'sk-dlg', style: wide ? { maxWidth: 920, width: '92vw' } : undefined,
            onClick: e => e.stopPropagation() },
          title && h('h3', null, title),
          children,
          footer && h('div', { className: 'sk-dlg-foot' }, footer)))
    }

    function InToast({ text }) {
      return h('div', { className: 'sk-toast' }, text)
    }

    /** ntd ActionButton 同款分享抽屉:可编辑提示词 + 参数预览 + 复制到会话执行。 */
    function ShareSkillDialog({ t, params, onClose, onToast }) {
      const [prompt, setPrompt] = useState(substituteParams(SHARE_PROMPT_ZH, params))
      const [hasToken, setHasToken] = useState(null)
      const [job, setJob] = useState(null)   // {jobId,status,output,code}
      const [busy, setBusy] = useState(false)
      useEffect(() => {
        getJson(API + '/market/status').then(d => setHasToken(d.hasToken === true)).catch(() => setHasToken(false))
      }, [])
      // 轮询执行输出,直到关闭/结束
      useEffect(() => {
        if (job === null || job.status !== 'running') return
        const timer = setInterval(() => {
          getJson(API + '/share/run?id=' + encodeURIComponent(job.jobId))
            .then(d => setJob(prev => prev && { ...prev, status: d.status, output: d.output || '', code: d.code, sessionId: d.sessionId || prev.sessionId }))
            .catch(() => {})
        }, 2000)
        if (typeof timer.unref === 'function') timer.unref()
        return () => clearInterval(timer)
      }, [job && job.status])
      const doRun = async () => {
        setBusy(true)
        try {
          const r = await fetch(API + '/share/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, dir: params.resourceDir }) })
          const d = await r.json().catch(() => ({}))
          if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status)
          setJob({ jobId: d.jobId, status: 'running', output: '', code: null })
        } catch (e) { onToast(t('runFailed') + ': ' + e.message) } finally { setBusy(false) }
      }
      const row = (label, value) => h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '3px 0' } },
        h('span', { className: 'sk-dir' }, label), h('span', { className: 'sk-hint', style: { wordBreak: 'break-all', textAlign: 'right' } }, value))
      const copy = () => {
        navigator.clipboard.writeText(prompt).then(() => onToast(t('promptCopied'))).catch(() => {})
      }
      return h(SkDialog, { title: t('shareTitle'), onClose, wide: true },
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, minWidth: 380 } },
          h('div', { className: 'sk-hint' }, hasToken === false ? t('shareHintPatMissing') : t('shareHint')),
          h('div', null,
            row(t('shareParamName'), params.skillName),
            row(t('shareParamVersion'), params.version || '-'),
            row(t('shareParamDir'), params.resourceDir),
            row(t('shareParamRemote'), params.remotePath)),
          h('textarea', { className: 'sk-input', value: prompt, onChange: e => setPrompt(e.target.value),
            style: { width: '100%', minHeight: 190, resize: 'vertical', fontFamily: 'var(--dsw-font-family)', lineHeight: 1.6 } }),
          job !== null && h('div', null,
            h('div', { className: 'sk-dir', style: { margin: '4px 0' } },
              t('outputLabel') + ' · ' + (job.status === 'running' ? t('running') : job.status === 'done' ? t('runDone') : t('runFailed') + (job.code != null ? ' (' + job.code + ')' : ''))),
            h('pre', { className: 'sk-preview', style: { maxHeight: 220, margin: 0, whiteSpace: 'pre-wrap', fontSize: 12 } },
              job.output || '…')),
          h('div', { className: 'sk-dlg-foot', style: { marginTop: 0 } },
            h(ButtonLite, { onClick: copy }, t('copyPrompt')),
            job !== null && job.sessionId && sessionsSvc() && h(ButtonLite, { onClick: () => { if (openRunSession(job.sessionId)) onClose() } }, t('openChat')),
            h(ButtonLite, { primary: true, disabled: busy || (job !== null && job.status === 'running'), onClick: doRun },
              job !== null && job.status === 'running' ? t('running') : t('runBtn')))))
    }

    /** Market sync settings: status card, sync action, editable url/branch. */
    function MarketSettingsDialog({ t, onClose, onToast, onSynced }) {
      const [status, setStatus] = useState(null)
      const [busy, setBusy] = useState(false)
      const [url, setUrl] = useState('')
      const [branch, setBranch] = useState('')
      const [token, setToken] = useState('')
      const [repoDir, setRepoDir] = useState('')
      const [autoSync, setAutoSync] = useState(true)
      const [syncOnStartup, setSyncOnStartup] = useState(true)

      const refresh = () => getJson(API + '/market/status').then(d => {
        setStatus(d)
        setUrl(d.url)
        setBranch(d.branch)
        setRepoDir(d.dir)
        setAutoSync(d.autoSync)
        setSyncOnStartup(d.syncOnStartup)
      }).catch(() => {})
      useEffect(() => { refresh() }, [])

      const doSync = async () => {
        setBusy(true)
        try {
          const r = await fetch(API + '/market/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
          const d = await r.json().catch(() => ({}))
          if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status)
          onToast(d.isFirstClone ? t('firstCloneDone') : d.hasUpdates ? t('syncDoneUpdated') : t('syncDoneLatest'))
          onSynced && onSynced()
          refresh()
        } catch (e) { onToast(t('operationFailed') + ': ' + e.message) } finally { setBusy(false) }
      }
      const putSettings = async (patch) => {
        const r = await fetch(API + '/market/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.json().catch(() => ({}))
      }
      const doSave = async () => {
        try {
          const patch = { url, branch, autoSync, syncOnStartup }
          if (repoDir !== '' && repoDir !== (status && status.dir)) patch.repoDir = repoDir
          if (token !== '') patch.token = token
          await putSettings(patch)
          setToken('')
          onToast(t('saved'))
          refresh()
        } catch (e) { onToast(t('operationFailed') + ': ' + e.message) }
      }
      const doClearToken = async () => {
        try {
          await putSettings({ token: null })
          onToast(t('saved'))
          refresh()
        } catch (e) { onToast(t('operationFailed') + ': ' + e.message) }
      }

      const short = (c) => (c ? String(c).slice(0, 8) : '-')
      const row = (label, value) => h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '3px 0' } },
        h('span', { className: 'sk-dir' }, label), h('span', { className: 'sk-hint', style: { wordBreak: 'break-all', textAlign: 'right' } }, value))

      return h(SkDialog, { title: t('marketSettings'), onClose },
        h('div', { style: { minWidth: 380, display: 'flex', flexDirection: 'column', gap: 10 } },
          status === null
            ? h(Spinner, { label: '…' })
            : [
              status.gitAvailable === false && h('div', { className: 'sk-tag danger' }, t('gitMissing')),
              h('div', null,
                row(t('repoUrlLabel'), status.url),
                row(t('branchLabel'), status.branch),
                row(t('localCommitLabel'), short(status.localCommit) + (status.needsUpdate ? ' · ' : '')),
                status.needsUpdate !== undefined && h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: -6 } },
                  status.needsUpdate ? h('span', { className: 'sk-tag accent' }, t('needsUpdateTag')) : null),
                row(t('remoteCommitLabel'), short(status.remoteCommit)),
                row(t('lastSyncLabel'), status.lastSyncAt ? formatTime(status.lastSyncAt) : t('repoMissing')),
                row(t('repoDirLabel'), status.dir)),
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, color: 'var(--dsw-alias-label-secondary)', fontSize: 13 } },
                  h('input', { type: 'checkbox', checked: autoSync, onChange: e => setAutoSync(e.target.checked) }), t('autoSyncLabel')),
                h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, color: 'var(--dsw-alias-label-secondary)', fontSize: 13 } },
                  h('input', { type: 'checkbox', checked: syncOnStartup, onChange: e => setSyncOnStartup(e.target.checked) }), t('syncOnStartupLabel'))),
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                h('input', { className: 'sk-input', value: url, onChange: e => setUrl(e.target.value), placeholder: t('repoUrlLabel'), style: { width: '100%' } }),
                h('input', { className: 'sk-input', value: branch, onChange: e => setBranch(e.target.value), placeholder: t('branchLabel'), style: { width: '100%' } }),
                h('input', { className: 'sk-input', value: repoDir, onChange: e => setRepoDir(e.target.value), placeholder: t('repoDirLabel'), style: { width: '100%' } }),
                h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
                  h('input', { className: 'sk-input', type: 'password', value: token, onChange: e => setToken(e.target.value),
                    placeholder: status && status.hasToken ? `${t('tokenLabel')} · ${t('tokenConfigured')}` : t('tokenLabel'), style: { flex: 1 } }),
                  status && status.hasToken && h(ButtonLite, { onClick: doClearToken }, t('clearToken')))),
              h('div', { className: 'sk-dlg-foot', style: { marginTop: 4 } },
                h(ButtonLite, { onClick: doSave }, t('save')),
                h(ButtonLite, { primary: true, onClick: doSync }, busy ? t('syncing') : t('syncNow')))]))
    }

    /** Incremental grid: renders the first pageSize cards and grows on demand —
     *  the market collection alone holds 6k+ skills and must not mount at once.
     *  Key the element by the active filter so filtering resets the window. */
    function PagedGrid({ items, render, t, pageSize = 120, grow = 240, keyPrefix = '' }) {
      const [shown, setShown] = useState(pageSize)
      return [
        h('div', { className: 'sk-grid' }, items.slice(0, shown).map(render)),
        items.length > shown && h('div', { style: { textAlign: 'center', margin: '14px 0' } },
          h(ButtonLite, { onClick: () => setShown(n => n + grow) }, t('showMore', { n: items.length - shown }))),
      ]
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

    function AllSkillsView({ executors, searchText, sourceFilter, t, onSearch, onFilter, onBack, onOpen, onInstall, onDelete, onShare, onToggleVisible }) {
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
              h(SkillCard, { key: row.key + '/' + s.name, row, s, t, onOpen, onInstall, onDelete, onShare, onToggleVisible })))]
    }

    function DrillInView({ row, searchText, t, onSearch, onBack, onOpen, onInstall, onDelete, onShare, onToggleVisible }) {
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
          : h(PagedGrid, { key: 'ed' + row.key + searchText, items: skills, t,
              render: s => h(SkillCard, { key: s.name, row, s, t, onOpen, onInstall, onDelete, onShare, onToggleVisible }) }),
      ]
    }

    function InputBox({ value, placeholder, onSearch }) {
      if (prim('Input')) {
        return h(P.Input, { value, placeholder, className: 'sk-input', onChange: e => onSearch(e.target.value),
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
      const [marketSettingsOpen, setMarketSettingsOpen] = useState(false)
      const [shareParams, setShareParams] = useState(null)
      const [marketToast, setMarketToast] = useState(null)
      const [marketView, setMarketView] = useState('cards')
      const [marketDrill, setMarketDrill] = useState(null)
      const [searchMarketDrill, setSearchMarketDrill] = useState('')
      const [searchMarketAll, setSearchMarketAll] = useState('')
      const [searchExec, setSearchExec] = useState('')
      const [searchDrill, setSearchDrill] = useState('')
      const [searchAll, setSearchAll] = useState('')
      const [sel, setSel] = useState(null)
      const [tick, forceTick] = useState(0)
      const rootRef = useRef(null)

      // Two data planes with very different costs: the executor summary is a
      // fast (~0.2s) count scan, while GET / walks the whole market collection
      // (~2.3s). Load the summary eagerly and the market set lazily — only when
      // a tab that needs it is opened, and re-fetch it after mutations.
      const [baseStale, setBaseStale] = useState(true)
      const [baseLoading, setBaseLoading] = useState(false)
      const reloadExecutors = () => {
        getJson(API + '/executors?mode=summary').then(d => setExecutors(d.executors || [])).catch(() => {})
      }
      const reloadBase = () => {
        setBaseStale(false)
        setBaseLoading(true)
        getJson(API).then(setBase).catch(() => {}).finally(() => setBaseLoading(false))
      }
      useEffect(reloadExecutors, [])
      useEffect(() => {
        if (tab === 'market' && baseStale) reloadBase()
      }, [tab, baseStale])

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
      const openShare = (row, s) => {
        const skillName = shortName(s.name)
        const dir = s.__dir || (row && row.dir ? row.dir + (s.relPath ? '/' + s.relPath : '/' + skillName) : '')
        if (!dir) return
        setShareParams({
          skillName,
          version: s.version || '',
          resourceDir: dir,
          remotePath: row && row.key && row.key !== 'dsh' && row.key !== '@market'
            ? `skills/${row.key}/${skillName}/`
            : `skills/${skillName}/`,
        })
      }
      const [pendingDelete, setPendingDelete] = useState(null)
      const [pendingInstall, setPendingInstall] = useState(null)
      const [toastText, setToastText] = useState(null)
      const doPendingInstall = async () => {
        if (!pendingInstall) return
        const { row, name } = pendingInstall
        setPendingInstall(null)
        try {
          const body = { name }
          if (row && row.key && row.key !== '@market') body.from = row.key
          const r = await fetch(API + '/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
          if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'HTTP ' + r.status)
          setToastText(t('installedToast'))
          setTimeout(() => setToastText(null), 2600)
          reloadExecutors()
          setBaseStale(true)
        } catch (e) { alert(t('operationFailed') + ': ' + e.message) }
      }
      const doPendingDelete = async () => {
        if (!pendingDelete) return
        await quickDelete(t, pendingDelete.executor, pendingDelete.name)
        setPendingDelete(null)
        reloadExecutors()
        setBaseStale(true)
      }

      let body = null
      try {
      if (tab === 'executors') {
        if (filterExecutor !== 'all') {
          body = h(DrillInView, { row, searchText: searchDrill, t,
            onSearch: setSearchDrill, onShare: openShare,
            onBack: () => { setFilterExecutor('all'); setSearchDrill('') },
            onOpen: s => openDetail(s, row?.key),
            onInstall: (r, name) => setPendingInstall({ row: r, name }),
            onDelete: (r, name) => setPendingDelete({ executor: r.key, name }),
            onToggleVisible: (r, name, modelInvocable) => {
              fetch(API + '/invocation', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, modelInvocable }) })
                .then(() => getJson(API + '/executors?executor=' + encodeURIComponent(r.key))
                  .then(d => setExecutors(rows => rows.map(x => x.key === d.executor.key ? d.executor : x))))
                .catch(() => {})
            } })
        } else if (executorView === 'all') {
          body = h(AllSkillsView, { executors, searchText: searchAll, sourceFilter, t,
            onSearch: setSearchAll, onShare: openShare,
            onFilter: v => { setSourceFilter(v); if (v !== 'all') { setFilterExecutor(v); setSearchAll(''); setSearchExec('') } },
            onBack: () => setExecutorView('cards'),
            onOpen: s => { const owner = executors.find(x => x.dirExists && Array.isArray(x.skills) && x.skills.some(k => k.name === s.name)); openDetail(s, owner ? owner.key : sourceFilter !== 'all' ? sourceFilter : 'dsh') },
            onInstall: (r, name) => setPendingInstall({ row: r, name }),
            onDelete: (r, name) => setPendingDelete({ executor: r.key, name }),
            onToggleVisible: (r, name, modelInvocable) => {
              fetch(API + '/invocation', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, modelInvocable }) })
                .then(() => getJson(API + '/executors?executor=' + encodeURIComponent(r.key))
                  .then(d => setExecutors(rows => rows.map(x => x.key === d.executor.key ? d.executor : x))))
                .catch(() => {})
            } })
        } else {
          body = h(CardsView, { executors, t,
            onEnter: key => { setFilterExecutor(key); setSearchDrill('') },
            onBrowseAll: () => setExecutorView('all') })
        }
      } else {
        // Market tab mirrors the executors tab: source cards by default, a flat
        // all-skills view on demand, and per-source drill-in with a scoped filter.
        const allMarket = base.market || []
        const lowerAll = searchMarketAll.toLowerCase()
        const mkRow = (src) => ({ key: '@market', label: splitSource(src), readOnly: false, deletable: false })
        if (baseLoading && !allMarket.length) {
          body = h(Spinner, { label: t('marketLoading') })
        } else if (marketDrill !== null) {
          let sk = allMarket.filter(s => s.source === marketDrill)
          const l = searchMarketDrill.toLowerCase()
          if (l) sk = sk.filter(s => matchSkill({ ...s, name: s.shortName || s.name }, l))
          body = [
            h('div', { className: 'sk-head' },
              h(ButtonLite, { onClick: () => { setMarketDrill(null); setSearchMarketDrill('') } }, t('backSources')),
              h('span', { className: 'sk-title' }, marketDrill),
              h('span', { className: 'sk-tag' }, `${sk.length} ${t('skillsSuffix')}`),
              h(InputBox, { value: searchMarketDrill, placeholder: t('filterWithin', { label: marketDrill }), onSearch: setSearchMarketDrill })),
            sk.length
              ? h(PagedGrid, { key: 'md' + marketDrill + searchMarketDrill, items: sk, t,
                  render: s => h(SkillCard, { key: s.name, row: mkRow(s.source), s: mkCard(s), t,
                    onOpen: item => openDetail({ name: item.installName || item.name }, null),
                    onInstall: (_r, name) => setPendingInstall({ row: null, name }),
                    onDelete: () => {} }) })
              : h(Empty, null, t('emptySearch')),
          ]
        } else if (marketView === 'all') {
          const sk = lowerAll ? allMarket.filter(s => matchSkill({ ...s, name: s.shortName || s.name }, lowerAll)) : allMarket
          body = [
            h('div', { className: 'sk-head' },
              h(ButtonLite, { onClick: () => { setMarketView('cards'); setSearchMarketAll('') } }, t('backMarketCards')),
              h('span', { className: 'sk-title' }, t('allMarketTitle')),
              h(InputBox, { value: searchMarketAll, placeholder: t('searchAll'), onSearch: setSearchMarketAll }),
              h('span', { className: 'spacer' }),
              h(Tag, null, `${sk.length} ${t('skillsSuffix')}`)),
            sk.length
              ? h(PagedGrid, { key: 'ma' + searchMarketAll, items: sk, t,
                  render: s => h(SkillCard, { key: s.name, row: mkRow(s.source), s: mkCard(s), t,
                    onOpen: item => openDetail({ name: item.installName || item.name }, null),
                    onInstall: (_r, name) => setPendingInstall({ row: null, name }),
                    onDelete: () => {} }) })
              : h(Empty, null, t('emptySearch')),
          ]
        } else {
          body = [
            h('div', { className: 'sk-toolbar' },
              h('span', { className: 'sk-hint' }, t('marketCardsHint')),
              h('span', { className: 'spacer' }),
              h(P.Button, { variant: 'primary', size: 'sm', onClick: () => setMarketView('all') }, `${t('browseAllMarket')} (${allMarket.length})`),
              h('span', { style: { width: 6 } }),
              h(ButtonLite, { onClick: () => setMarketSettingsOpen(true), title: t('marketSettings') }, t('marketSettings'))),
            base.sources.length
              ? h('div', { className: 'sk-src' }, base.sources.map(src =>
                  h('div', { key: src.source, className: 'sk-card', role: 'button', tabIndex: 0,
                    onClick: () => { setMarketDrill(src.source); setSearchMarketDrill('') } },
                    h('div', { className: 'sk-head' },
                      h(Avatar, { name: src.displayName || src.source, square: true, size: 40 }),
                      h('span', { className: 'sk-title' }, src.displayName || src.source)),
                    h('div', { className: 'sk-countline' },
                      h('span', { className: 'sk-count' }, src.skills), ' ' + t('skillsSuffix')))))
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
        h('div', { className: 'sk-tabs' }, ['executors', 'market'].map(key =>
          h('button', { key, className: 'sk-tabpill' + (tab === key ? ' on' : ''), style: pillStyle(tab === key),
            onClick: () => { setTab(key); setFilterExecutor('all'); setExecutorView('cards'); setSearchExec(''); setSearchDrill(''); setSearchAll(''); setMarketView('cards'); setMarketDrill(null); setSearchMarketDrill(''); setSearchMarketAll('') } }, t('tab' + key[0].toUpperCase() + key.slice(1))))),
        h('div', { className: 'sk-body' }, body),
        sel && h(DetailModal, { sel, executors, t,
          onClose: () => setSel(null),
          onInstalled: () => { setSel(null); reloadExecutors(); setBaseStale(true) },
          onDeleted: () => { setSel(null); reloadExecutors(); setBaseStale(true) } }),
        shareParams && h(ShareSkillDialog, {
          t, params: shareParams, onClose: () => setShareParams(null),
          onToast: (text) => { setMarketToast(text); setTimeout(() => setMarketToast(null), 3000) },
        }),
        marketSettingsOpen && h(MarketSettingsDialog, {
          t,
          onClose: () => setMarketSettingsOpen(false),
          onToast: (text) => { setMarketToast(text); setTimeout(() => setMarketToast(null), 3000) },
          onSynced: () => { setBaseStale(true) },
        }),
        marketToast && h(InToast, { text: marketToast }),
        pendingInstall && h(SkDialog, {
          title: t('installTitle'),
          onClose: () => setPendingInstall(null),
          footer: [
            h(ButtonLite, { onClick: () => setPendingInstall(null) }, t('cancel')),
            h(ButtonLite, { primary: true, onClick: doPendingInstall }, t('installOk')),
          ],
        }, h('div', { className: 'sk-hint' },
            t('installConfirm', { name: pendingInstall.name, label: pendingInstall.row ? pendingInstall.row.label : t('marketLabel') }))),
        toastText && h(InToast, { text: toastText }),
        pendingDelete && h(SkDialog, {
          title: t('deleteTitle'),
          onClose: () => setPendingDelete(null),
          footer: [
            h(ButtonLite, { onClick: () => setPendingDelete(null) }, t('cancel')),
            h(ButtonLite, { primary: true, danger: true, onClick: doPendingDelete }, t('deleteBtn')),
          ],
        }, h('div', { className: 'sk-hint' }, t('deleteConfirm', {
          name: pendingDelete.name,
          where: pendingDelete.executor === 'dsh' || !pendingDelete.executor ? t('whereDsh') : ((executors.find(x => x.key === pendingDelete.executor) || {}).label || pendingDelete.executor),
        }))))
      }

    function splitSource(source) { return source.split('/')[0] || source }
    /** Market rows carry the full repo path in .name; cards display the short
     *  name but install/detail must POST the full one. */
    function mkCard(s) { return { ...s, name: s.shortName || s.name, installName: s.name } }
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

    async function quickDelete(t, executor, name, done) {
      try {
        const body = { name }
        if (executor) body.executor = executor
        const r = await fetch(API, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'HTTP ' + r.status)
        if (typeof done === 'function') done()
      } catch (e) { alert(t('operationFailed') + ': ' + e.message) }
    }

    // ── Slot entries ─────────────────────────────────────────────────────────

    /** Jump to the run's conversation: open() is best-effort (it may reject
     *  after the selection lands). */
    function openRunSession(sessionId) {
      try {
        const svc = sessionsSvc()
        if (svc && typeof svc.open === 'function') svc.open(sessionId)
      } catch {}
      return true
    }

    /** Settings section slot entry: render the page directly in the host tree. */
    function SettingsSlotComponent(props) {
      useEffect(ensureStyles, [])
      return h(SkillsPage, { t: props.__t, embedded: true })
    }

    // ── Plugin plane contract ────────────────────────────────────────────────

    const CLIENT_NAME = '@weibaohui/skills-management'

    module.exports = {
      name: CLIENT_NAME,
      inject: ['slots', 'locale'],
      __internals: { NS, ZH, EN, matchSkill, formatSize, formatTime, openTriggerSource, insertComposerText, fetchSkillCandidates },
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
        // Sessions face for 打开对话: dynamic inject per the ui-commands
        // precedent (scope.sessions). Static inject must NOT list services —
        // that stalls activation; root-level slot entries get no standard kit.
        try {
          if (typeof ctx.inject === 'function') {
            ctx.inject(['sessions'], (scope) => {
              const svc = scope && scope.sessions
              if (svc && typeof svc.open === 'function') sessionsApi = svc
            })
          }
        } catch {}
        // Composer services (inputTriggers + sessions) for the ＋ 技能 button;
        // absence hides the button only.
        try {
          if (typeof ctx.inject === 'function') {
            ctx.inject(['inputTriggers', 'sessions'], (scope) => { composerScope = scope })
          }
        } catch {}
        // connection service for the picker skill catalog (host skill registry,
        // ui-skill 同源); absence keeps the button hidden.
        try {
          if (typeof ctx.inject === 'function') {
            ctx.inject(['connection'], (scope) => { connectionApi = scope && scope.connection })
          }
        } catch {}
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
          ctx.slots.inject('settings.section', () => ctx.slots.register({
            name: 'settings.section',
            id: CLIENT_NAME,
            order: 90,
            locale: NS,
            // resolveSlotLabel 调用 label() 不传参;官方模式是自带绑定翻译的闭包
            label: () => t('title'),
            inject: () => ({}),
          }, function SettingsSectionSlot() {
            return h(SettingsSlotComponent, { __t: t })
          }))
          } catch (e) { (globalThis.__skErrors = globalThis.__skErrors || []).push('settings:' + (e && e.message)); throw e }
        }, 'skills-management: settings section')
        ctx.effect(() => {
          try {
          ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
            name: 'conversation.input.left',
            id: CLIENT_NAME,
            order: 60,
            locale: NS,
            label: () => t('pickSkill'),
            inject: () => ({ t }),
          }, function SkillButtonSlot(apiProps) {
            return h(ComposerButtonSlot, {
              __t: t, label: t('pickSkill'), title: t('pickSkillTitle'),
              source: 'skill', sessionId: apiProps && apiProps.sessionId, input: apiProps && apiProps.input,
            })
          }))
          } catch (e) { (globalThis.__skErrors = globalThis.__skErrors || []).push('input.left:' + (e && e.message)); throw e }
        }, 'skills-management: input left button')
      },
    }

    /** Composer tool-row button: 加号+文字 chip，点击在按钮上方打开自带搜索的
     *  技能 picker 浮层（候选 = 宿主技能注册表，ui-skill 同源）；pick 经
     *  slash/input-insert-text 写入 `/<name> `。浮层背板盖住按钮以外的区域，
     *  再点一次按钮会先落在背板上——天然形成开关切换。
     *  connection 缺席（picker 无目录来源）时回退旧的 toggleSource 宿主菜单；
     *  inputTriggers/sessions 缺席时按钮隐藏（与旧行为一致）。 */
    function ComposerButtonSlot(props) {
      useEffect(ensureStyles, [])
      const [picker, setPicker] = useState(null) // {left, top} 锚点快照；null = 关闭
      const [rows, setRows] = useState(null)     // null = 加载中
      const btnRef = useRef(null)
      const liveInput = useRef(props.input)
      liveInput.current = props.input
      const ready = !!(composerScope && composerScope.inputTriggers && composerScope.sessions && props.sessionId)
      if (!ready) return null
      const close = () => setPicker(null)
      const open = () => {
        // 目录来源缺席 → 退回宿主斜杠菜单（无搜索，但按钮不消失）
        if (!connectionApi) { openTriggerSource(composerScope, props.sessionId, liveInput.current, props.source); return }
        let anchor = { left: 16, top: 160 }
        try { if (btnRef.current) anchor = btnRef.current.getBoundingClientRect() } catch {}
        setPicker({ left: anchor.left, top: anchor.top })
        setRows(null)
        fetchSkillCandidates(connectionApi, composerScope.sessions, props.sessionId)
          .then((list) => setRows(Array.isArray(list) ? list : []))
          .catch(() => setRows([]))
      }
      const pick = (row) => {
        insertComposerText(composerScope, props.sessionId, liveInput.current, `/${row.name} `)
        close()
        refocusComposer()
      }
      const popover = picker !== null && RDP && typeof RDP.createPortal === 'function'
        ? RDP.createPortal(h(SkillPicker, { t: props.__t, anchor: picker, rows, onClose: close, onPick: pick }), document.body)
        : null
      return h('button', {
        className: 'sk-chip',
        ref: btnRef,
        title: props.title || props.label,
        'aria-haspopup': 'dialog',
        'aria-expanded': picker !== null,
        onClick: open,
      }, props.label, popover)
    }

    return module.exports
  }
})
