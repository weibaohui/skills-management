# @weibaohui/skills-management

[![DSH plugin](https://img.shields.io/badge/dsh-plugin-green)](https://github.com/topics/dsh-plugin)
[![npm version](https://img.shields.io/npm/v/@weibaohui/skills-management)](https://www.npmjs.com/package/@weibaohui/skills-management)

**技能市场插件**：一个页面管理本机所有 coding agent 的技能，还能浏览安装 6600+ 的 ntd 技能市场。

![技能市场：从本机技能浏览到 ntd 市场安装，卡片带 ≈token/字符 注入开销统计与排序](https://cdn.jsdelivr.net/gh/weibaohui/skills-management@main/docs/demo.gif)

## 核心功能

- **全来源扫描**：自动扫描本机各 coding agent 的技能目录，统一在一个页面查看、查看详情、单文件预览
- **约定式自动发现**：任何遵循 `~/.xxx/skills` 约定的技能目录（家目录下点前缀目录内含 `skills/` 子目录）都会被自动识别为执行器来源，key 与显示名由目录名派生（如 `.mobile-coder` → `mobile-coder` / Mobile Coder），新工具零配置接入；Windows 下对应 `%USERPROFILE%\.xxx\skills`（如 `C:\Users\Alice\.agent\skills`）。内置清单只保留规则覆盖不到的部分：dsh 安装库与 mimo/zhanlu 的 `~/.local/share/…` 显式路径。自动发现的来源在「执行器目录」设置面板中可改目录、可一键停用
- **一键收编**：任意执行器的技能可一键复制进 DSH 用户库，供模型的 `skill` 工具直接调用
- **回收站**：删除的技能移入回收站暂存（默认保留 30 天，可配置/关闭），可随时恢复到原位置（含目录名≠技能名的布局与软链技能）、彻底删除或一键清空；恢复时原位置被占用会拒绝并提示
- **一键迁至共享池**：详情弹窗可把任意可写来源的实体技能迁入 `~/.agents/skills` 共享池，原位置自动留链接（Windows 建 junction，免管理员权限），各来源照常可用；已是链接/已在池中/池内同名/只读来源都会被守卫拒绝，建链失败自动回滚
- **反向链接可视化**：Agents 池钻取视图里，每张技能卡片底部显示「数字 + 链接来源头像排」——一眼看出哪些执行器链了这个技能（悬停列出名称）
- **技能市场**：内置 ntd 技能合集（6600+ 条），按来源分组浏览、搜索筛选、详情预览、一键安装
- **注入开销统计**：每张技能卡片和详情显示「≈N token · M 字符」（按名称+描述全文、cl100k_base 词表估算，与 tiktokenizer 同词表同值），支持按 token/字符排序，一眼看出哪些技能最占上下文
- **模型可见性治理**：每个已装技能都有「模型可调用」开关，不想暴露给模型的技能一键隐藏/恢复
- **输入框 ＋ 技能**：composer 工具行新增「＋ 技能」按钮，弹出带搜索框的技能候选浮层（候选 = 宿主技能注册表，与 `/` 菜单同源；支持键盘 ↑/↓/Enter/Esc），选中即把 `/技能名` 写入草稿，发送时技能内容注入该条消息
- **市场自动同步**：市场仓库自动克隆与每日更新（可关），支持 GitCode 私有仓库 access token
- **稀疏检出**：ntd-resource 仓库同时携带专家/模板等子树，市场只检出 `skills` 子目录（git partial clone + sparse-checkout），省一半以上流量与磁盘；已有全量检出会在下次同步时原地转换
- **软链布局兼容**：各执行器目录间软链共享的技能不会重复展示

## 安装

```bash
dsh plugin --profile web add @weibaohui/skills-management -w
```

装完重启 `dsh web` 即生效。

## 使用

1. 打开 Web UI → **设置** → 左侧「技能市场」section 即完整管理页（可搭配 dsh-settings-ui 插件把设置窗口调大/全屏）
2. 「已安装」视图管理本机技能；「市场」视图浏览/搜索/安装 ntd 合集技能；「执行器」视图按来源钻入查看各 coding agent 的技能
3. 详情页可预览 SKILL.md 全文、安装到用户库、切换模型可调用开关
4. ⚙ 设置面板里可配置市场仓库地址、分支、access token 与自动同步

## 联系我 :飞书群

![link](https://foruda.gitee.com/images/1774880015525784725/4fd67005_77493.png "link")

## 版本兼容性

本插件与 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`@deepseek-ai/dsh`）的版本对应关系：

| 插件版本 | 适配 dsh 版本 | 备注 |
|---------|--------------|------|
| 0.9.0 | 0.2.0-rc.2 | 当前版本；详情弹窗一键「迁至共享池」（移入 `~/.agents/skills` 并在原位留链接，Windows 建 junction）；池技能卡片反向链接可视化（「链接 n 个」+ 来源头像排，点击弹出列表可多选批量删链接）；安装改为选择器（DSH 默认勾选、可勾选更多执行器、记住上次选择）；执行器数据合并刷新 + 定点失效；Avatar 渲染容错（版本错配不再白屏） |
| 0.8.0 | 0.1.7-rc.2 | 新增回收站：删除的技能移入 `~/.dsh/skills-management/trash/` 暂存（默认保留 30 天），可恢复原位置/彻底删除/清空；删除行为由永久删除改为暂存；软链技能移动链接本身 |
| 0.7.0 | 0.1.7-rc.2 | 执行器来源改为约定式自动发现：遵循 `~/.xxx/skills` 约定的目录零配置接入（Windows 为 `%USERPROFILE%\.xxx\skills`），key/显示名由目录名派生（`claudecode`→`claude`、`mobilecoder`→`mobile-coder`，按旧 key 存的停用/覆盖需重设一次）；内置清单只留 dsh/mimo/zhanlu；目录不存在即无行；自动来源可改目录、可停用 |
| 0.6.8 | 0.1.7-rc.2 | 修复详情弹窗白屏：0.1.7-rc.2 web 前端的 `MarkdownText` 将 `labels` 变为必填，未传时渲染到首个代码围栏即抛 TypeError，宿主错误边界卸载整个 settings.section |
| 0.6.7 | 0.1.7-rc.2 | 修复 schemastery 加载失败时 `Config` 导出 null 导致宿主 settings/describe 崩溃、整个客户端无法启动的问题（改导出 undefined，让降级真正成立）（#12 #13） |
| 0.6.6 | 0.1.7-rc.2 | 修复宿主将 volatile 字段物化为 {} 导致的设置毒化（saneConfigValues 清洗 + 移除 Config 兼容字符串字段） |
| 0.6.5 | 0.1.7-rc.2 | 适配 0.1.7 settings 模型（导出 volatile `Config`，`ctx.settings.update` 持久化），面板改动重启不再丢失 |
| 0.6.3 | 0.1.7-rc.2 | 已在 @deepseek-ai/dsh@0.1.7-rc.2 下验证运行 |

> **发版约定**：每次发布新版本时，请在上表追加一行，记录该插件版本实际验证所用的 `@deepseek-ai/dsh` 版本。`package.json` 的 `engines.dsh` 声明最低支持版本；本表记录实际验证版本，二者配合使用。
