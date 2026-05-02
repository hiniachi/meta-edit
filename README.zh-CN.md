# meta-edit

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/hiniachi/meta-edit/actions/workflows/ci.yml/badge.svg)](https://github.com/hiniachi/meta-edit/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/hiniachi/meta-edit?style=social)](https://github.com/hiniachi/meta-edit/stargazers)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/hiniachi)

**语言:** [English](./README.md) · [日本語](./README.ja.md) · **简体中文**

> 一个 MCP 服务器，把编程 AI 代理的通用文件编辑工具替换成 **十九个按编辑类别拆分的专用工具**，并把每类编辑必须满足的测试义务直接写进工具说明里。

## 为什么要做"带类型的编辑"

`CLAUDE.md` 里写下的指令会随着对话轮次的增加慢慢被遗忘。Skill 只在 AI 自己决定调用时才会生效。两者都依赖"模型 *也许* 会再读一遍"的文本，在真正动作的那一刻并没有结构性的强制力。

工具定义不会被遗忘。AI 即将调用的工具，其 schema 与说明文都会在每一次调用时被加载。`meta-edit` 把单一的 `Edit` 原语拆成十九个按类别区分的工具，让每个工具的说明文自身承载"什么时候用""什么时候不能用""必须伴随哪些测试""什么时候停下来询问用户"。不需要再指望 AI"还记得要补一个边界值测试"。

这个项目押的是这样一个判断：**改变 AI 编辑行为的，是工具表面的形状本身**——而不是检测或事后验证。设计灵感来自 [SQLite 的测试策略](https://sqlite.org/testing.html)（边界值、MC/DC 条件覆盖、异常路径测试、按变更逐项核对清单），把 C 库级别的质量纪律翻译成应用层的编辑类别。完整规范见 [`docs/SPEC.md`](./docs/SPEC.md)（Part I 宪法 + Part II 派生规范），v0.2 之后的检测待办清单见 [`OBSERVED-FAILURES.md`](./OBSERVED-FAILURES.md)。

状态：`0.2.0` 预发布版。v0.2 把机制重塑为 **声明 + 令牌绑定**（参见 `SPEC.md` Article 5）：MCP 服务器只校验声明并发放短期令牌；真正的写入由 Claude Code 内置的 `Edit` / `Write` 在 `deny-raw-edit` 钩子的绑定校验门下完成。本仓库自身就是一个单插件的 Claude Code marketplace，同时也以 npm 包 `@hiniachi/meta-edit` 的形式分发（npm 尚未发布）。

## 十九个工具

```
edit_refactor_only            edit_test_only_change
edit_boundary_condition       edit_boolean_condition
edit_state_transition         edit_db_schema
edit_data_migration           edit_api_contract
edit_serialization            edit_error_handling
edit_retry_timeout            edit_concurrency
edit_external_side_effect     edit_cache_invalidation
edit_permission_logic         edit_dependency_config
edit_policy_change            edit_docs_only
edit_create_file
```

每个工具的说明都明确给出了下面四点：

- 何时使用；
- 何时不能使用；
- 必须伴随哪些测试；
- 什么时候必须停下来询问用户。

## 观察到的现象：AI 真的会停下来询问

`meta-edit` 第一次自我应用到自己的仓库时，对话上下文已经用掉约 80%，需要往 `OBSERVED-FAILURES.md` 追加一段记录。当时只有十七个工具，没有任何一个能严格覆盖"纯文档编辑"。AI 没有强行套用现有工具，而是停了下来：

> OBSERVED-FAILURES.md 是文档文件，与十七个 `edit_*` 工具中的任何一个都无法严格匹配（这些说明文都假定目标是"生产代码"／"测试文件"／"策略 / 治理"）。CLAUDE.md §9 写的是"找不到合适的 `edit_*` 工具时停下来询问"。有两个选项：(a) 借用 `edit_refactor_only`——它的 MUST-NOT 列表（运算符变更／守卫子句／返回值结构）对于纯散文都自然不触发，且"不改变可观察行为"的意图在文档场景下也成立；(b) `/plugin disable meta-edit` 之后用原生 `Edit`。请问你倾向哪一个？

这件事里有三点值得注意：

1. "停下来询问"的指示在 **上下文已用 80%** 时仍然被遵守——也正是 `CLAUDE.md` 那种文本指令通常会失效的时间点。
2. AI 用自己的语言定位了规范的缺口（"十七个工具未覆盖文档文件"）。
3. AI 顺势起草出了后来成为第十八个工具 `edit_docs_only` 的 v0.2 草案。

每次调用都会被读取的"工具型指示"在这一刻胜过了只在会话开始时被读一次的"文本型指示"。（这份 README 本身也是后来通过 `edit_docs_only` 重写的。）

## 安装

### 方式 A：Claude Code Plugin marketplace

本仓库本身就是一个单插件的 marketplace。先把 marketplace 添加一次，再安装 meta-edit 插件：

```sh
/plugin marketplace add hiniachi/meta-edit
/plugin install meta-edit@meta-edit
```

这样 MCP 服务器（19 个 `edit_*` 工具）和两个安全 Hook（`deny-raw-edit` 与 `deny-bash-write-bypass`）会一起被自动注册。插件运行的是仓库 `dist/` 目录中预先打包好的 JavaScript（通过 `node` 启动），**唯一的运行时要求是 Node 20+**。无需 Bun，无需 `npm install`，使用者侧也不需要任何构建步骤。

### 方式 B：npm 包

```sh
npm install -g @hiniachi/meta-edit
# 启用安全 Hook
meta-edit install-hooks --scope user
```

或者只在某个项目里使用：

```sh
npm install --save-dev @hiniachi/meta-edit
meta-edit install-hooks --scope project
```

把服务器加入 Claude Code 的 MCP 配置：

```json
{
  "mcpServers": {
    "meta-edit": { "command": "meta-edit", "args": ["serve"] }
  }
}
```

## 运行环境

- **Node 20 LTS 或更新版本**（使用者侧）。插件与 npm bin 都以 `node` 运行随包发布的 `dist/cli.js`。
- POSIX 兼容的 shell 环境（`deny-bash-write-bypass` Hook 需要）。当前不支持 Windows。
- Bun 仅用于开发与 CI（`bun run build` / `bun test`）；使用者无需安装。

## 命令

```
meta-edit serve                                            启动 MCP stdio 服务器
meta-edit log [--tool NAME] [--risk LEVEL] [--since DATE]  打印 edits.jsonl 中的编辑记录
meta-edit summary [--since DATE]                           汇总编辑日志的统计
meta-edit install-hooks --scope user|project               把 Claude Code Hook 写入 settings.json
meta-edit uninstall-hooks --scope user|project             从 settings.json 中移除 Hook
```

### 示例

```sh
# 查看 4 月以来对计费代码做过的边界值类编辑：
meta-edit log --tool edit_boundary_condition --since 2026-04-01

# 仅查看 high 与 critical 风险的编辑：
meta-edit log --risk high
meta-edit log --risk critical

# 最近 7 天的汇总（日期支持 YYYY-MM-DD 或任意 ISO 8601 格式）：
meta-edit summary --since 2026-04-23

# 为当前项目安装 Hook（写入 .claude/settings.json）：
meta-edit install-hooks --scope project

# 为整个用户环境安装 Hook（写入 ~/.claude/settings.json）：
meta-edit install-hooks --scope user
```

## 编辑日志

每一次 typed_edit 调用都会向 `.meta-edit/state/edits.jsonl` 追加最多两行 JSONL。schema 见 [`SPEC.md` §6](./docs/SPEC.md)：

1. **`issued`** — MCP 服务器接受声明并发放令牌时写入：

   ```json
   {"edit_id":"edit_20260502_0001","ts":"2026-05-02T19:00:00+09:00","phase":"issued","kind":"edit_boundary_condition","target_file":"src/billing/charge.ts","rationale":"Allow exact-balance charges by changing < to <=","risk_level":"high","test_files":["tests/billing/charge.test.ts"],"binding":[{"file":"src/billing/charge.ts","before_sha256":"…","after_sha256":"…"}],"token":"met_20260502_a3f9b2…"}
   ```

2. **`consumed`** — `deny-raw-edit` 钩子授权对应的内置 Edit / Write 写入时写入（PreToolUse、写入执行前）：

   ```json
   {"edit_id":"edit_20260502_0001","ts":"2026-05-02T19:00:11+09:00","phase":"consumed","consuming_tool":"Edit"}
   ```

校验拒绝以 `phase: "rejected"` 单条记录写入，并附带非空的 `audit_error`。补丁本身**不会**被存储——如需原始内容请以 VCS 历史为准。只有 `issued` 而没有 `consumed` 兄弟记录，意味着声明被放弃或令牌已过期。

## CI 集成

参考工作流位于 [`examples/.github/workflows/meta-edit-summary.yml`](./examples/.github/workflows/meta-edit-summary.yml)：每次 PR 时运行一次 `meta-edit summary`，并把结果作为构建产物上传。直接复制到自己仓库的 `.github/workflows/` 目录即可使用。

## 支持作者

如果 `meta-edit` 帮你节省了时间，或者避免了一次糟糕的编辑，欢迎请作者喝一杯咖啡：

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black&style=for-the-badge)](https://buymeacoffee.com/hiniachi)

赞助会用于：

- 根据观察到的 AI 失败模式新增 `edit_*` 类别；
- 若仅靠工具说明文证明不够，作为兜底实现轻量 diff 分类器（详见 [`SPEC.md` Article 2](./docs/SPEC.md)）；
- 强化与 Claude Code Plugin 的集成。

## 许可证

MIT。详见 [`LICENSE`](./LICENSE)。
