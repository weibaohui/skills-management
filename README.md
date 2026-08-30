# dsh-plugin-skills-management

ntd 技能市场 for DeepSeek Harness：**一个页面管理本机所有技能**。

- **执行器来源**（移植 ntd 来源表）：扫描本机各 coding agent 的 skills 目录（`~/.claude/skills`、`~/.zcode/skills`、`~/.codex/skills`、`~/.agents/skills` 等 16 个），全部展示、可详情、可单文件预览；`agents` 为只读来源；任意执行器技能可一键复制进 DSH 用户库供 `skill` 工具调用。软链布局（各执行器目录 symlink 共享池）完整支持。
- **模型目录治理**（2026-08-29，2026-08-30 扩展）：市场库存（6600+ 条）只作可浏览/可安装的货架，**不再注入对话的技能目录**（装进 DSH 用户库才对模型可见）；已装技能可在详情页用"模型可调用"开关切换原生 frontmatter 键 `disable-model-invocation`（其余键保留），卡片带"已隐藏"标记与隐藏/恢复按钮；**开关同时覆盖 user-agents 根**（`~/.agents/skills`——dsh 内置把它全量扫进模型目录；同名冲突时优先改用户库，与 registry rank 一致），市场与只读源不受影响；市场 settings（含 access token）经宿主 settings 服务持久化到 `settings.yaml`，重启不再丢失。
：插件自己管理 ntd-resource 检出（ntd `git_sync` 同构）：首次 `git clone --depth 1`，更新 `fetch + reset --hard`（远程永远赢，本地误删误改自愈）；启动时后台静默同步 + 每日自动同步（可关）；gitcode 私有仓库支持 access token（只写不回读，状态文件 0600 权限，凭证不落 .git/config）。
- **市场浏览**：读取 ntd 技能合集目录（默认 `~/.ntd/bundled/skills`，GitHub 开源技能仓库归档树），来源卡片/浏览全部/来源钻入三视图，安装进用户库；⚙ 设置面板查看同步状态、立即同步、编辑 url/分支/token/自动同步。
- 已安装库注册到 dsh 的 SkillRegistry —— 模型直接通过 `skill` 工具按名调用。

## 安装

```bash
dsh plugin --profile web add 'github:weibaohui/dsh-plugins#path:skills' -w
```

## 功能

- **Provider 注册**：向 `ctx.skills` 注册 `ntd-skills` provider。已安装库（rank 100）遮蔽市场同名技能（rank 500）；frontmatter 的 `disable-model-invocation` / `user-invocable` 控制双面调用策略；解析失败的 SKILL.md warn + skip。执行器目录仅做管理展示，不自动进 provider。
- **执行器扫描**：`GET /executors` 按 ntd 的来源表逐源递归扫描（跳过 `.git`/`node_modules`，跟随 symlink 且有环路防护）。三种用法配合分层加载：全量（含 skills 数组）、`?mode=summary`（只要计数，首屏）、`?executor=<key>`（单来源完整列表，钻入时懒加载）；技能条目含 fileCount/totalSize；嵌套目录以相对路径为显示名。detail / file / DELETE / install 均支持 `executor=` 参数按源定位。
- **市场浏览**：递归扫描市场目录，按来源（GitHub 仓库）分组，搜索/筛选；详情看 SKILL.md 全文与文件清单。
- **安装**：市场技能整目录复制进用户库 `$DSH_HOME/skills/<短名>/`；执行器技能经 `POST /install {name, from:<executor>}` 复制进同一位置；同名覆盖 = 更新（`overwrite`）。装完 `invalidate()`，`skill` 工具目录立即可见。
- **删除**：`DELETE {name, executor}` 按源删除；缺省 executor 即 DSH 用户库；只读来源（`agents`）拒删，市场目录只读。
- **HTTP API**：`/skills-management/api` 下 `GET /`（市场+已安装）、`GET /executors`、`GET /detail?name=&executor=`、`GET /file?name=&path=&executor=`、`POST /install`、`DELETE /`、`GET /market/status`、`POST /market/sync`、`PUT /market/settings`。

## 与 ntd 的差异

执行器的发现/展示/删除/跨源复制已迁移（ntd `handlers/skills.rs` 同构）；跨执行器批量 sync 矩阵、version-update 对比、zip 导入导出、调用追踪、市场 git 同步不迁移：dsh 单执行器，「同步」被「从执行器/市场安装进用户库」取代；调用可从 dsh 会话日志投影。

## Config（cordis.yml）

| key | 默认 | 说明 |
|---|---|---|
| `marketDirs` | `['~/.ntd/bundled/skills']` | 市场库目录列表（可指向任意技能合集 git 检出） |
| `installedDir` | `$DSH_HOME/skills` | 用户库目录（即执行器表中的 `dsh` 源） |
| `providerName` | `ntd-skills` | `ctx.skills` 注册名 |
| `executorDirs` | `{}` | 覆盖某执行器来源的根目录，如 `{claudecode: '/path'}`；也便于测试 |
| `disabledExecutors` | `[]` | 关闭的执行器来源 key 列表 |
| `extraExecutors` | `[]` | 追加自定义来源：`[{key, label, dir, readOnly}]` |
| `marketRepoDir` | `~/.ntd/bundled` | 市场资源 git 检出根目录（同步目标）；运行期可在设置面板改（`PUT /market/settings {repoDir}`），市场扫描自动跟随，状态持久化于 `$DSH_HOME/skills-market-sync.json` |
| `marketSync` | 见下 | `{url, branch, gitBinary, autoSync, syncOnStartup, token}`；url 默认 `https://gitcode.com/weibaohui/ntd-resource.git`，运行期可经 `PUT /market/settings` 覆盖（持久化于 `<repoDir>/../.dsh-skills-market-sync.json`） |

## 开发

```bash
npm install
npm run check          # 语法检查两个半端
npm test               # 离线测试套件
npm run build:client   # 从 client/index.js 构建 client/bundle.js
```

## 依赖

运行时依赖 `yaml`（frontmatter 解析）与 `zod`（用户设置 schema）。零 `@deepseek-ai/dsh-*` 硬依赖——宿主半端经 `ctx.skills` / `ctx.webServer` / `ctx.inject(['settings'])` 运行时服务访问 harness 能力。

**设置存储**：市场同步的用户设置（url/分支/本地目录/token/自动同步）注册为宿主 `ctx.settings` 命名空间 `skills-management.market`（zod schema；cordis.yml 的 `marketSync`/`marketRepoDir` 作为 composition base 层，UI 修改写入用户层，本地 provider 持久化于 `$DSH_HOME/settings.yaml`）。settings 服务缺席的组合（如测试）自动回退到进程内覆盖表；同步记账（lastSyncAt/结果）仍在 `$DSH_HOME/skills-market-sync.json`，旧版设置一次性迁移。侧栏收起时入口仅显示图标（槽位 `wide` 属性），展开显示完整文字。

## License

MIT
