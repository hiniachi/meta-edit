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

// JSON schema for the 17 SQLite-derived tools: target_file + the standard
// declaration fields, NO `additional_files`. The MCP layer rejects unknown
// properties outright (additionalProperties: false) so a 17-tool call
// carrying the field never reaches the issuer.
//
// v0.2.1 thinning: client-supplied before_sha256 / after_sha256 fields are
// removed. The server reads disk and computes before_sha256 itself; there is
// no after_sha256 anywhere. Per Articles 3 (non-adversarial) and 4
// (descriptions read as a comfortable tool, not a hashing chore), the
// client-supplied digests added friction without proportional protective
// value.
const sqliteToolInputSchema = {
  type: "object",
  required: [
    "target_file",
    "rationale",
    "risk_level",
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
    test_files: {
      type: "array",
      items: { type: "string" },
      description:
        "Paths of test files relevant to this edit. Forward declaration only — recorded in the audit log but NOT bound by this token. Test edits are made via separate edit_test_only_change calls. Required (non-empty) for SQLite-derived production tools; must be empty for edit_test_only_change.",
    },
  },
  additionalProperties: false,
} as const;

// JSON schema for the 3 workflow tools (edit_docs_only, edit_create_file, edit_create_planning_artifact):
// adds the optional `additional_files` array (≤ MAX_ADDITIONAL_FILES).
const workflowToolInputSchema = {
  type: "object",
  required: [
    "target_file",
    "rationale",
    "risk_level",
    "test_files",
  ],
  properties: {
    ...sqliteToolInputSchema.properties,
    additional_files: {
      type: "array",
      maxItems: MAX_ADDITIONAL_FILES,
      description:
        "OPTIONAL. Additional files governed by this single declaration. Available only on the 3 workflow tools (edit_docs_only, edit_create_file, edit_create_planning_artifact). Each entry is the repository-relative path of a file the declaration covers; the deny-raw-edit hook consumes entries in any order until the grant is exhausted or its TTL expires. Cardinality cap: " +
        String(MAX_ADDITIONAL_FILES) +
        ".",
      items: {
        type: "object",
        required: ["file"],
        properties: {
          file: {
            type: "string",
            description:
              "Repository-relative path. Same path-safety rules as target_file. For edit_create_file the file MUST NOT exist on disk; for edit_docs_only it MUST exist.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
} as const;

function inputSchemaForTool(toolName: ToolName): typeof sqliteToolInputSchema | typeof workflowToolInputSchema {
  return TOOLS_ACCEPTING_ADDITIONAL_FILES.includes(toolName)
    ? workflowToolInputSchema
    : sqliteToolInputSchema;
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
