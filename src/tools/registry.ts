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

// JSON schema for the 17 SQLite-derived tools: target_file + the 4 binding
// fields, NO `additional_files`. The MCP layer rejects unknown properties
// outright (additionalProperties: false) so a 17-tool call carrying the
// field never reaches the issuer.
const sqliteToolInputSchema = {
  type: "object",
  required: [
    "target_file",
    "rationale",
    "risk_level",
    "test_files",
    "before_sha256",
    "after_sha256",
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
    before_sha256: {
      type: "string",
      pattern: "^[0-9a-f]{64}$",
      description:
        "Lowercase hex sha256 (64 chars) of the current disk content of target_file. The MCP server reads disk and refuses if the digest does not match. For edit_create_file, pass sha256(\"\") and the file MUST NOT yet exist.",
    },
    after_sha256: {
      type: "string",
      pattern: "^[0-9a-f]{64}$",
      description:
        "Lowercase hex sha256 (64 chars) of the content the agent declares it will write. The deny-raw-edit hook compares this to the bytes the native Edit/Write call would land before allowing the write.",
    },
  },
  additionalProperties: false,
} as const;

// JSON schema for the 2 workflow tools (edit_docs_only, edit_create_file):
// adds the optional `additional_files` array (≤ MAX_ADDITIONAL_FILES).
const workflowToolInputSchema = {
  type: "object",
  required: [
    "target_file",
    "rationale",
    "risk_level",
    "test_files",
    "before_sha256",
    "after_sha256",
  ],
  properties: {
    ...sqliteToolInputSchema.properties,
    additional_files: {
      type: "array",
      maxItems: MAX_ADDITIONAL_FILES,
      description:
        "OPTIONAL. Additional files governed by this single declaration. Available only on the 2 workflow tools (edit_docs_only, edit_create_file). Each entry carries its own (file, before_sha256, after_sha256) tuple; the deny-raw-edit hook consumes entries in any order until the grant is exhausted or its TTL expires. Cardinality cap: " +
        String(MAX_ADDITIONAL_FILES) +
        ".",
      items: {
        type: "object",
        required: ["file", "before_sha256", "after_sha256"],
        properties: {
          file: {
            type: "string",
            description:
              "Repository-relative path. Same path-safety rules as target_file.",
          },
          before_sha256: {
            type: "string",
            pattern: "^[0-9a-f]{64}$",
            description:
              "sha256 of the current disk content. For edit_create_file entries, sha256(\"\").",
          },
          after_sha256: {
            type: "string",
            pattern: "^[0-9a-f]{64}$",
            description: "sha256 of the content to be written.",
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
