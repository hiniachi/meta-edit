import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOL_DESCRIPTIONS, TOOL_NAMES, type ToolName } from "./descriptions.js";
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
// (prod/test), NO `additional_files`. The MCP layer rejects unknown
// properties outright (additionalProperties: false) so an impl-tool call
// carrying the field never reaches the issuer.
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
// target: "prod" call. edit_docs_only does NOT carry a target (the
// workflowToolInputSchema below omits it).
const implToolInputSchema = {
  type: "object",
  required: [
    "target_file",
    "rationale",
    "risk_level",
    "target",
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
    test_files: {
      type: "array",
      items: { type: "string" },
      description:
        "Paths of test files relevant to this edit. Forward declaration only — recorded in the audit log but NOT bound by this token. When target=\"prod\", must be non-empty for impl tools (excluding edit_cosmetic). When target=\"test\", must be empty (target_file IS the test file). Test edits land via a second invocation of the same tool with target=\"test\".",
    },
  },
  additionalProperties: false,
} as const;

// JSON schema for the 1 remaining workflow tool (edit_docs_only):
// adds the optional `additional_files` array (≤ MAX_ADDITIONAL_FILES).
// v0.3.1 dropped edit_create_file and edit_create_planning_artifact;
// empty file creation is now hook-level (no MCP declaration).
// v0.5.0: edit_docs_only does NOT carry the prod/test `target` field
// (documentation has its own surface); the impl-tool schema is the
// source for the other shared properties via destructuring, then
// `target` is excluded explicitly here.
const { target: _omittedTarget, ...workflowSharedProperties } =
  implToolInputSchema.properties;
const workflowToolInputSchema = {
  type: "object",
  required: [
    "target_file",
    "rationale",
    "risk_level",
    "test_files",
  ],
  properties: {
    ...workflowSharedProperties,
    additional_files: {
      type: "array",
      maxItems: MAX_ADDITIONAL_FILES,
      description:
        "OPTIONAL. Additional files governed by this single declaration. Available only on the 1 workflow tool (edit_docs_only). Each entry is the repository-relative path of a file the declaration covers; the deny-raw-edit hook consumes entries in any order until the grant is exhausted or its TTL expires. Cardinality cap: " +
        String(MAX_ADDITIONAL_FILES) +
        ".",
      items: {
        type: "object",
        required: ["file"],
        properties: {
          file: {
            type: "string",
            description:
              "Repository-relative path. Same path-safety rules as target_file. The file MUST exist on disk (edit_docs_only is modify-only). For new files, do an empty-content native Write first (free at the deny-raw-edit hook) and then declare the typed_edit against the now-empty file.",
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
        description: TOOL_DESCRIPTIONS[name],
        inputSchema: inputSchemaForTool(name),
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
