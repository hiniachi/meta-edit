# meta-edit

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/hiniachi/meta-edit/actions/workflows/ci.yml/badge.svg)](https://github.com/hiniachi/meta-edit/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/hiniachi/meta-edit?style=social)](https://github.com/hiniachi/meta-edit/stargazers)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/hiniachi)

**语言:** [English](./README.md) · [日本語](./README.ja.md) · **简体中文**

> 一个 MCP 服务器，将编程 AI 代理的通用文件编辑工具替换为 **十七个按编辑种类划分的专用工具**，并把每种编辑必须满足的测试义务直接写进工具说明里。

完整规范见 [`docs/SPEC.md`](./docs/SPEC.md)。这是一项赌注式实践：**仅靠工具设计**（而不是检测或验证）就足以改变 AI 的编辑行为。

## 当前状态

预发布 `0.1.0`。核心功能端到端可用：

- 17 个 `edit_*` MCP 工具（说明文逐字复制自 [`SPEC.md` §4](./docs/SPEC.md)）
- 参数校验：拒绝越界补丁、新建/删除/重命名、traversal 别名、通过符号链接绕过保护路径、大小写别名、git 扩展头、超过 1 MiB 或含 NUL 字节
- 补丁原子写入：`O_CREAT | O_EXCL | O_NOFOLLOW` 临时文件 + fsync + rename，每次 pathname 系统调用前重新规范化父目录
- 所有调用都追加到 `.meta-edit/state/edits.jsonl`（成功/失败都记）
- 两个 PreToolUse Hook (`deny-raw-edit`, `deny-bash-write-bypass`) 以最佳努力方式封堵 raw edit 和 bash 写入旁路
- CLI: `serve`, `log`, `summary`, `install-hooks`, `uninstall-hooks`

尚未发布到 npm，也未在 Claude Code 插件市场上架。

## 十七个工具

```
edit_refactor_only            edit_test_only_change
edit_boundary_condition       edit_boolean_condition
edit_state_transition         edit_db_schema
edit_data_migration           edit_api_contract
edit_serialization            edit_error_handling
edit_retry_timeout            edit_concurrency
edit_external_side_effect     edit_cache_invalidation
edit_permission_logic         edit_dependency_config
edit_policy_change
```

每个工具说明都明确指出：

- 何时使用；
- 何时不能使用；
- 必须伴随的测试有哪些；
- 何时必须停下来询问用户。

## 安装

### 方式 A：Claude Code Plugin marketplace

发布后：

```sh
/plugin install meta-edit
```

会自动注册 MCP 服务器以及两个安全 Hook（`deny-raw-edit` 与 `deny-bash-write-bypass`）。

### 方式 B：npm 包

```sh
npm install -g @hiniachi/meta-edit
# 启用安全 Hook
meta-edit install-hooks --scope user
```

或仅在某个项目中使用：

```sh
npm install --save-dev @hiniachi/meta-edit
meta-edit install-hooks --scope project
```

在 Claude Code 的 MCP 配置中加入：

```json
{
  "mcpServers": {
    "meta-edit": { "command": "meta-edit", "args": ["serve"] }
  }
}
```

## 运行环境

源代码以 TypeScript 形式发布到 npm，可在下列环境无修改运行：

- Bun 1.x（开发与 CI 使用，推荐）
- Node 20 LTS（`node` 运行 `dist/` 构建产物，`bun` 直接运行源代码）

## 命令

```
meta-edit serve              启动 MCP stdio 服务器
meta-edit log [filters]      打印 edits.jsonl 中的编辑记录
meta-edit summary            汇总编辑日志的统计
meta-edit install-hooks      把 Claude Code Hook 写入 settings.json
meta-edit uninstall-hooks    从 settings.json 中移除 Hook
```

## 支持作者

如果 `meta-edit` 帮你节省了时间或避免了一次糟糕的编辑，欢迎请作者喝杯咖啡：

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black&style=for-the-badge)](https://buymeacoffee.com/hiniachi)

您的支持将用于：

- 根据观察到的 AI 失败模式增加新的 `edit_*` 类型；
- 实现 v0.2 计划中的轻量 diff 分类器（详见 [`SPEC.md` §11](./docs/SPEC.md)）；
- 加强与 Claude Code Plugin 的集成。

## 许可证

MIT。详见 [`LICENSE`](./LICENSE)。
