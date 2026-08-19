# dsh-plugin-skills-management

ntd 技能市场 for DeepSeek Harness：读取 ntd 的技能合集目录（默认 `~/.ntd/bundled/skills`，GitHub 开源技能仓库归档树），把全部技能注册到 dsh 的 SkillRegistry —— **模型直接通过 `skill` 工具按名调用** —— 并提供安装/删除/详情 HTTP API 与管理界面（市场浏览 + 已安装库双 tab）。

## 安装

```bash
dsh plugin --profile web add 'github:weibaohui/dsh-plugins#path:skills' -w
```

## 功能

- **Provider 注册**：向 `ctx.skills` 注册 `ntd-skills` provider。已安装库（rank 100）遮蔽市场同名技能（rank 500）；frontmatter 的 `disable-model-invocation` / `user-invocable` 控制双面调用策略；解析失败的 SKILL.md warn + skip。
- **市场浏览**：递归扫描市场目录（跳过 `.git`/`node_modules`），按来源（GitHub 仓库）分组，搜索/筛选/分页；技能详情看 SKILL.md 全文与文件清单，单文件预览（含路径逃逸防护）。
- **安装**：市场技能整目录复制进用户库 `$DSH_HOME/skills/<短名>/`；同名覆盖 = 更新（`overwrite`）。装完 `invalidate()`，`skill` 工具目录立即可见。
- **删除**：仅用户库可删；市场目录只读。
- **HTTP API**：`/skills-management/api` 下 `GET /`（市场+已安装）、`GET /detail?name=`、`GET /file?name=&path=`、`POST /install`、`DELETE /`。

## 与 ntd 的差异

跨执行器功能（来源 tab 切换 / compare / sync / version-update / 调用追踪 / zip 导入 / 市场 git 同步）不迁移：dsh 单执行器，同步被「市场 → 用户库安装」取代；调用可从 dsh 会话日志投影。执行器目录扫描（`~/.claude/skills` 等）由 dsh 自带的 skill-filesystem 覆盖，本插件不重复。

## Config（cordis.yml）

| key | 默认 | 说明 |
|---|---|---|
| `marketDirs` | `['~/.ntd/bundled/skills']` | 市场库目录列表（可指向任意技能合集 git 检出） |
| `installedDir` | `$DSH_HOME/skills` | 用户库目录 |
| `providerName` | `ntd-skills` | `ctx.skills` 注册名 |

## 开发

```bash
npm install
npm run check          # 语法检查两个半端
npm test               # 离线测试套件
npm run build:client   # 从 client/index.js 构建 client/bundle.js
```

## 依赖

运行时只依赖 `yaml`（frontmatter 解析）。零 `@deepseek-ai/dsh-*` 依赖——宿主半端经 `ctx.skills` / `ctx.webServer` 运行时服务访问 harness 能力。

## License

MIT
