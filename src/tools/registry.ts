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
  required: ["target_file", "patch", "rationale", "risk_level", "test_files"],
  properties: {
    target_file: {
      type: "string",
      description: "Repository-relative path to the file being edited.",
    },
    patch: {
      type: "string",
      description: "Unified diff to apply. Must be a modify-only patch.",
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
        "Paths of test files relevant to this edit. Required for all tools except edit_refactor_only and edit_test_only_change.",
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
