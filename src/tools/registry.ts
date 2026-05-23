import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  TOOL_DESCRIPTIONS,
  TOOL_NAMES,
  TOOL_TITLES,
  type ToolName,
} from "./descriptions.js";
import {
  EditToolRequestSchema,
  MAX_ADDITIONAL_FILES,
  TOOLS_ACCEPTING_ADDITIONAL_FILES,
  makeStubHandler,
  type ToolHandler,
  type ValidationContext,
} from "./common.js";

// JSON schema for the 16 impl tools (15 SQLite-derived + edit_cosmetic):
// target_file + the standard declaration fields + required `target`
// (prod/test) + required `provenance`, NO `additional_files`. The MCP
// layer rejects unknown properties outright (additionalProperties: false)
// so an impl-tool call carrying the field never reaches the issuer.
//
// v0.2.1 thinning: client-supplied before_sha256 / after_sha256 fields are
// removed. The server reads disk and computes before_sha256 itself; there is
// no after_sha256 anywhere. Per Articles 3 (non-adversarial) and 4
// (descriptions read as a comfortable tool, not a hashing chore), the
// client-supplied digests added friction without proportional protective
// value.
//
// v0.5.0: `target` ("prod" | "test") is required on every impl tool.
// edit_test_only_change was removed; test edits go through the kind-
// specific impl tool with target: "test", paired with the original
// target: "prod" call. The 5 workflow-axis kinds (v0.6.0) do NOT carry
// a target (the workflowToolInputSchema below omits it).
//
// v0.6.0: every tool requires a `provenance` field naming the epistemic
// source of the edit. The (kind, provenance) cell matrices in
// docs/SPEC.md §3.3 then decide whether the declaration lands cleanly,
// lands with an audit warning, or is rejected.
const implToolInputSchema = {
  type: "object",
  required: [
    "target_file",
    "rationale",
    "risk_level",
    "target",
    "provenance",
    "execution_state",
    "test_files",
  ],
  properties: {
    target_file: {
      type: "string",
      description:
        "Repository-relative path to the file being edited. The MCP server validates path safety, that the path is inside the repo (post-realpath), and that it is not in a protected directory. The native Edit/Write call that follows must target this same file.",
    },
    rationale: {
      type: "string",
      description: "1-3 sentence rationale for the edit (non-empty).",
    },
    risk_level: {
      type: "string",
      enum: ["low", "medium", "high", "critical"],
      description: "Self-declared risk level. Recorded for audit only.",
    },
    target: {
      type: "string",
      enum: ["prod", "test"],
      description:
        "Required. Declare whether this edit lands in production code (\"prod\") or test code (\"test\"). One declaration covers exactly one target. To pair an implementation change with its tests, issue two declarations of the same tool: one with target=\"prod\" (test_files forward-declares the test files), then one with target=\"test\" (target_file IS the test file, test_files MUST be empty). Both may land in the same commit. The server does not pattern-match paths against test-directory conventions — the target declaration is your statement of intent.",
    },
    provenance: {
      type: "string",
      enum: [
        "user_confirmed",
        "accepted_artifact",
        "direct_observation",
        "inference",
        "speculation",
      ],
      description:
        "Required (v0.6.0). The epistemic source of this edit: user_confirmed (the user explicitly stated it this session), accepted_artifact (based on an accepted spec / ADR / test / API; rationale should cite §..., ADR-..., RFC-..., issues/..., or a URL), direct_observation (observed from execution / logs / just-read code; the prose should make the observation source visible), inference (reasoned from observation; the prose must frame it as an inference — \"Based on X, it appears that...\", \"Likely...\"), speculation (an unverified hypothesis; the prose must open with strong hedging — \"**Unverified**: ...\", \"**Hypothesis**: ...\", \"TODO: verify — ...\"). The reader sees the prose, not this field — the load-bearing obligation is that the prose itself carries the hedging language. See docs/SPEC.md §3.3 for the (kind, provenance) acceptance matrices.",
    },
    execution_state: {
      type: "string",
      enum: ["normal", "repeating_failure", "recovery"],
      description:
        "Required (v0.7.0). The state of your work loop: normal " +
        "(ordinary work, the default), repeating_failure (you have noticed " +
        "you are repeating the same class of failure — declare it on an " +
        "edit_observation/edit_proposal that records the failure), recovery " +
        "(you isolated a single hypothesis and are diagnosing deliberately). " +
        "See docs/SPEC.md §3.4.",
    },
    test_files: {
      type: "array",
      items: { type: "string" },
      description:
        "Paths of test files relevant to this edit. Forward declaration only — recorded in the audit log but NOT bound by this token. When target=\"prod\", must be non-empty for impl tools (excluding edit_cosmetic). When target=\"test\", must be empty (target_file IS the test file). Test edits land via a second invocation of the same tool with target=\"test\".",
    },
  },
  additionalProperties: false,
} as const;

// JSON schema for the 5 workflow-axis kinds (v0.6.0): edit_progress,
// edit_observation, edit_proposal, edit_decision, edit_explanation.
// Adds the optional `additional_files` array (≤ MAX_ADDITIONAL_FILES).
// Acceptance of `additional_files` is decided cell-wise by (kind,
// provenance) in validateRequest per docs/SPEC.md §3.3.2.
// v0.3.1 dropped edit_create_file and edit_create_planning_artifact;
// empty file creation is now hook-level (no MCP declaration).
// v0.6.0 retired the v0.5.x edit_docs_only and replaced it with this
// 5-kind workflow axis. Workflow kinds do NOT carry the prod/test
// `target` field (workflow content has its own surface); the impl-tool
// schema is the source for the other shared properties via
// destructuring, then `target` is excluded explicitly here.
const { target: _omittedTarget, ...workflowSharedProperties } =
  implToolInputSchema.properties;
const workflowToolInputSchema = {
  type: "object",
  required: [
    "target_file",
    "rationale",
    "risk_level",
    "provenance",
    "execution_state",
    "test_files",
  ],
  properties: {
    ...workflowSharedProperties,
    additional_files: {
      type: "array",
      maxItems: MAX_ADDITIONAL_FILES,
      description:
        "OPTIONAL. Additional files governed by this single declaration. Available only on the 5 workflow-axis kinds (edit_progress / edit_observation / edit_proposal / edit_decision / edit_explanation). Acceptance is decided cell-wise by (kind, provenance) per docs/SPEC.md §3.3.2 — edit_progress rejects every cell; edit_observation rejects user_confirmed and warns the rest; edit_proposal accepts accepted_artifact / speculation and warns the rest; edit_decision and edit_explanation accept their typical cells. Each entry is the repository-relative path of a file the declaration covers; the deny-raw-edit hook consumes entries in any order until the grant is exhausted or its TTL expires. Cardinality cap: " +
        String(MAX_ADDITIONAL_FILES) +
        ".",
      items: {
        type: "object",
        required: ["file"],
        properties: {
          file: {
            type: "string",
            description:
              "Repository-relative path. Same path-safety rules as target_file. Modify-mode against an existing file is the typical pattern; for new files, do an empty-content native Write first (free at the deny-raw-edit hook) and then declare the typed_edit against the now-empty file.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
} as const;

function inputSchemaForTool(toolName: ToolName): typeof implToolInputSchema | typeof workflowToolInputSchema {
  return TOOLS_ACCEPTING_ADDITIONAL_FILES.includes(toolName)
    ? workflowToolInputSchema
    : implToolInputSchema;
}

export type RegisterToolsOptions = {
  context: ValidationContext;
  handler?: ToolHandler;
};

export function registerTools(server: Server, options: RegisterToolsOptions): void {
  const handler = options.handler ?? makeStubHandler(options.context);

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: TOOL_NAMES.map((name) => ({
        name,
        title: TOOL_TITLES[name],
        description: TOOL_DESCRIPTIONS[name],
        inputSchema: inputSchemaForTool(name),
        annotations: {
          title: TOOL_TITLES[name],
        },
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name as ToolName;
    if (!TOOL_NAMES.includes(toolName)) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
      };
    }

    const parsed = EditToolRequestSchema.safeParse(request.params.arguments);
    if (!parsed.success) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Invalid arguments for ${toolName}: ${parsed.error.message}`,
          },
        ],
      };
    }

    const result = await handler(toolName, parsed.data);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  });
}
