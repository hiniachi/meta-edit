// Phase 2 で SPEC.md §4 から逐語コピーする。
// ここでは tool 名のみ確定させ、Phase 1 のスタブ動作を可能にする。

export const TOOL_NAMES = [
  "edit_refactor_only",
  "edit_test_only_change",
  "edit_boundary_condition",
  "edit_boolean_condition",
  "edit_state_transition",
  "edit_db_schema",
  "edit_data_migration",
  "edit_api_contract",
  "edit_serialization",
  "edit_error_handling",
  "edit_retry_timeout",
  "edit_concurrency",
  "edit_external_side_effect",
  "edit_cache_invalidation",
  "edit_permission_logic",
  "edit_dependency_config",
  "edit_policy_change",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  edit_refactor_only: "(stub) Refactor production code without changing observable behavior.",
  edit_test_only_change: "(stub) Modify test files only.",
  edit_boundary_condition: "(stub) Modify boundary or comparison conditions.",
  edit_boolean_condition: "(stub) Modify boolean expressions or compound conditions.",
  edit_state_transition: "(stub) Modify state machines or workflow transitions.",
  edit_db_schema: "(stub) Modify database schema, migrations, indexes, constraints.",
  edit_data_migration: "(stub) Modify production data via migration scripts or backfills.",
  edit_api_contract: "(stub) Modify API request/response shape.",
  edit_serialization: "(stub) Modify a serializer, parser, codec, or data format handler.",
  edit_error_handling: "(stub) Modify error/exception handling and failure paths.",
  edit_retry_timeout: "(stub) Modify retry, timeout, or backoff behavior.",
  edit_concurrency: "(stub) Modify concurrency primitives, locks, transactions.",
  edit_external_side_effect: "(stub) Modify code that triggers external side effects.",
  edit_cache_invalidation: "(stub) Modify cache keys, TTLs, or invalidation logic.",
  edit_permission_logic: "(stub) Modify permission, authorization, ownership, or tenancy checks.",
  edit_dependency_config: "(stub) Modify dependencies or runtime configuration.",
  edit_policy_change: "(stub) Modify meta-edit configuration, hooks, or tool descriptions.",
};
