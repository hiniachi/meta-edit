import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOL_DESCRIPTIONS, TOOL_NAMES, type ToolName } from "./descriptions.js";
import {
  EditToolRequestSchema,
  makeStubHandler,
  type ToolHandler,
  type ValidationContext,
} from "./common.js";

const inputSchema = {
  type: "object",
  required: ["target_file", "rationale", "risk_level", "test_files", "changes"],
  properties: {
    target_file: {
      type: "string",
      description:
        "Repository-relative path to the primary file being edited. When changes touch multiple files, this is the principal file the edit is about.",
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
        "Paths of test files relevant to this edit. Required (non-empty) for all tools except edit_refactor_only, edit_test_only_change, and edit_docs_only. Must be empty for edit_test_only_change.",
    },
    changes: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      description:
        "One or more content-pair changes. The server reads each file from disk, asserts byte-for-byte equality with old_content (precondition), then atomically writes new_content. Modify-only — no create / delete / rename.",
      items: {
        type: "object",
        required: ["file", "old_content", "new_content"],
        properties: {
          file: {
            type: "string",
            description:
              "Repository-relative path of the file to modify. Must already exist on disk.",
          },
          old_content: {
            type: "string",
            description:
              "Exact current content of the file. The server compares byte-for-byte at apply time and rejects the call if disk content differs.",
          },
          new_content: {
            type: "string",
            description:
              "New content to write to the file. Atomically replaces the file on success.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
} as const;

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
        inputSchema,
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
