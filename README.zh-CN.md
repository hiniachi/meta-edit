# meta-edit

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/hiniachi/meta-edit/actions/workflows/ci.yml/badge.svg)](https://github.com/hiniachi/meta-edit/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/hiniachi/meta-edit?style=social)](https://github.com/hiniachi/meta-edit/stargazers)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/hiniachi)

**语言:** [English](./README.md) · [日本語](./README.ja.md) · **简体中文**

> 一个 MCP 服务器,把编码代理唯一的 `Edit` 工具,替换为 **十八个按种类划分的编辑工具**。每种编辑必须伴随的测试义务,直接写在工具自身的描述里。

更完整的概念阐述,以及文件编辑之外的应用,见[项目页](https://hiniachi.github.io/meta-edit/)。

## 核心想法

`CLAUDE.md`、Skill、系统提示、贴在评论里的审查清单——这些都属于「模型也许会再读到」的文本。随着对话推进,它们逐渐滑出注意力。等到 `Edit` 真正被调用的那一刻,这些指令基本上已经过期。

只有一种表面不一样。代理即将调用的那个工具的 **schema 与描述**,会在每次调用之前被重新加载。这是动作发生时,指令唯一保证摆在模型眼前的位置。

`meta-edit` 把义务放到那里。但单一通用的 `Edit` 太粗了——你没办法在它上面写「把 `<` 改成 `<=` 时要补一个边界测试」,而又不会错误地连改错字也一并适用。所以拆。把 `Edit` 按「变更的种类」拆成十八个。代理在编辑之前必须先选种类。**选种类这一动作本身,就是思考那一步。**

设计灵感来自 [SQLite 的测试策略](https://sqlite.org/testing.html)——边界值、MC/DC 条件覆盖、异常路径测试、按变更逐项核对清单——把 C 库级别的质量纪律翻译到应用层的编辑类别。

## 十八个工具

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
```

每个工具的描述都写明:何时使用、何时不该使用、必须伴随哪些测试、什么时候停下来询问用户。

## 观察到的现象

当请求的改动没有种类能干净匹配时,代理不会硬塞进最近的工具,而是**停下来询问**。我们在上下文使用率约 80% 的会话里观察到了这一点——这正是 `CLAUDE.md` 类指令通常已经失去约束力的区段。当时催生第十八个工具 `edit_docs_only` 的完整对话记录,见[项目页](https://hiniachi.github.io/meta-edit/#proof)。

## 安装

### Claude Code 插件市场

本仓库本身就是一个单插件 marketplace。

```sh
/plugin marketplace add hiniachi/meta-edit
/plugin install meta-edit@meta-edit
```

这样会自动注册 MCP 服务器(十八个 `edit_*` 工具)和两个安全 hook(`deny-raw-edit`、`deny-bash-write-bypass`)。插件运行 `dist/` 下的预构建 JavaScript,**唯一的运行时要求是 Node 20+**——无需 Bun,无需 `npm install`,无需构建步骤。

发布新版本后,刷新本地 marketplace 克隆:

```sh
git -C ~/.claude/plugins/marketplaces/meta-edit pull origin main
rm -rf ~/.claude/plugins/cache/meta-edit
/plugin install meta-edit@meta-edit
/reload-plugins
```

### npm

```sh
npm install -g @hiniachi/meta-edit
meta-edit install-hooks --scope user
```

把服务器写入 MCP 配置:

```json
{
  "mcpServers": {
    "meta-edit": { "command": "meta-edit", "args": ["serve"] }
  }
}
```

### opencode

```sh
npm install -g @hiniachi/meta-edit
meta-edit install-opencode --scope user
```

把 MCP 服务器与 `@hiniachi/meta-edit/opencode` 插件写入 `opencode.json`。参考片段:[`examples/.opencode/opencode.json`](./examples/.opencode/opencode.json)。与 Claude Code 路径共享相同的十八个工具描述、审计日志和 grant 流程。

## 参考

| | |
| --- | --- |
| 完整规范(十八个描述、声明 + 令牌绑定、协议) | [`docs/SPEC.md`](./docs/SPEC.md) |
| 编辑日志 schema(`issued` / `consumed` / `rejected`) | [`docs/SPEC.md` §6](./docs/SPEC.md) |
| 观察到的失败模式(v0.2 之后的待办) | [`OBSERVED-FAILURES.md`](./OBSERVED-FAILURES.md) |
| CI 示例(在 PR 上跑 `meta-edit summary`) | [`examples/.github/workflows/meta-edit-summary.yml`](./examples/.github/workflows/meta-edit-summary.yml) |
| CLI 帮助 | `meta-edit --help` |

状态:`0.3.1` 预发布。Node 20 LTS+、POSIX shell。Bun 仅用于开发。

## 支持

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black&style=for-the-badge)](https://buymeacoffee.com/hiniachi)

## 许可证

MIT。详见 [`LICENSE`](./LICENSE)。
