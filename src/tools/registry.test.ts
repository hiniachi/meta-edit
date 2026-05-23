import { afterEach, beforeEach, describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  TOOL_NAMES,
  TOOL_DESCRIPTIONS,
  TOOL_TITLES,
  TOOLS_REQUIRING_TEST_FILES,
} from "./descriptions.js";
import { registerTools, type RegisterToolsOptions } from "./registry.js";
import type { EditToolRequest, EditToolResult } from "./common.js";
import type { ToolName } from "./descriptions.js";
import { makeTmpRoot, cleanTmpRoot } from "../test-helpers.js";

describe("twenty-one tools", () => {
  it("registers exactly twenty-one tool names", () => {
    // v0.3.1: edit_create_file and edit_create_planning_artifact were
    // dropped. Empty file creation is now free at the deny-raw-edit
    // hook level; content fills go through the appropriate type-specific
    // tool's modify path.
    // v0.5.0: edit_test_only_change was removed (test edits go through
    // impl tools with target: "test"), and edit_refactor_only was
    // narrowed and renamed to edit_cosmetic.
    // v0.6.0: edit_docs_only was split along a workflow axis into five
    // new kinds — edit_progress, edit_observation, edit_proposal,
    // edit_decision, edit_explanation. Surface count: 15 SQLite-derived
    // impl tools + edit_cosmetic + 5 workflow tools = 21.
    expect<number>(TOOL_NAMES.length).toBe(21);
    expect(new Set(TOOL_NAMES).size).toBe(21);
  });

  it("has a non-empty description for each tool", () => {
    for (const name of TOOL_NAMES) {
      const desc = TOOL_DESCRIPTIONS[name];
      expect(typeof desc).toBe("string");
      expect(desc.length).toBeGreaterThan(0);
    }
  });

  it("has a human-readable title for each tool that keeps the exact tool name visible", () => {
    for (const name of TOOL_NAMES) {
      expect(TOOL_TITLES[name]).toContain(name);
      expect(TOOL_TITLES[name].length).toBeGreaterThan(name.length);
    }
  });

  it("registers each of the five workflow-axis kinds with a verbatim signature opening", () => {
    expect(TOOL_NAMES).toContain("edit_progress" as ToolName);
    expect(TOOL_DESCRIPTIONS.edit_progress).toContain(
      "Record what was actually done, tried, or observed",
    );
    expect(TOOL_NAMES).toContain("edit_observation" as ToolName);
    expect(TOOL_DESCRIPTIONS.edit_observation).toContain(
      "Record an observation, surprise, finding, or gotcha",
    );
    expect(TOOL_NAMES).toContain("edit_proposal" as ToolName);
    expect(TOOL_DESCRIPTIONS.edit_proposal).toContain(
      "Raise a proposal, question, or open issue",
    );
    expect(TOOL_NAMES).toContain("edit_decision" as ToolName);
    expect(TOOL_DESCRIPTIONS.edit_decision).toContain(
      "Record a decision that has already been made",
    );
    expect(TOOL_NAMES).toContain("edit_explanation" as ToolName);
    expect(TOOL_DESCRIPTIONS.edit_explanation).toContain(
      "Explain or document known facts for a reader",
    );
  });

  it("does NOT register edit_docs_only (v0.6.0 removal)", () => {
    expect(TOOL_NAMES).not.toContain("edit_docs_only" as never);
  });

  it("does NOT register edit_create_file or edit_create_planning_artifact (v0.3.1 removal)", () => {
    expect(TOOL_NAMES).not.toContain("edit_create_file" as never);
    expect(TOOL_NAMES).not.toContain("edit_create_planning_artifact" as never);
  });

  it("treats edit_cosmetic and the 5 workflow kinds as test-files-optional", () => {
    expect(TOOLS_REQUIRING_TEST_FILES).not.toContain("edit_cosmetic");
    for (const w of [
      "edit_progress",
      "edit_observation",
      "edit_proposal",
      "edit_decision",
      "edit_explanation",
    ] as const) {
      expect(TOOLS_REQUIRING_TEST_FILES).not.toContain(w);
    }
  });

  it("does NOT register edit_refactor_only or edit_test_only_change (v0.5.0 removal)", () => {
    expect(TOOL_NAMES).not.toContain("edit_refactor_only" as never);
    expect(TOOL_NAMES).not.toContain("edit_test_only_change" as never);
  });

  it("typed-edit-onboarding Skill catalog mentions every TOOL_NAMES entry (drift guard)", () => {
    // Codex review (v0.3.1 MED #6): the Skill ships a one-line
    // catalog of every tool as first-touch onboarding. If a tool is
    // renamed or added in TOOL_NAMES without updating the Skill, the
    // agent's first-tool choice would be misled. Pin the parity by
    // asserting the Skill markdown contains every tool name.
    const skillPath = path.resolve(
      import.meta.dir,
      "..",
      "..",
      "skills",
      "typed-edit-onboarding",
      "SKILL.md",
    );
    const skill = fs.readFileSync(skillPath, "utf8");
    for (const name of TOOL_NAMES) {
      expect(skill).toContain(name);
    }
  });

  it("TOOLS_REQUIRING_TEST_FILES contains no tools that are in the explicit exempt set", () => {
    const exempt: ToolName[] = [
      "edit_cosmetic",
      "edit_progress",
      "edit_observation",
      "edit_proposal",
      "edit_decision",
      "edit_explanation",
    ];
    for (const name of exempt) {
      expect(TOOLS_REQUIRING_TEST_FILES).not.toContain(name);
    }
  });

  it("every tool in TOOL_NAMES is either in TOOLS_REQUIRING_TEST_FILES or in the explicit exempt set", () => {
    const exempt = new Set<ToolName>([
      "edit_cosmetic",
      "edit_progress",
      "edit_observation",
      "edit_proposal",
      "edit_decision",
      "edit_explanation",
    ]);
    for (const name of TOOL_NAMES) {
      const required = TOOLS_REQUIRING_TEST_FILES.includes(name);
      const exempted = exempt.has(name);
      expect(required || exempted).toBe(true);
    }
  });

  it("all tools in the explicit exempt set are present in TOOL_NAMES", () => {
    const exempt: ToolName[] = [
      "edit_cosmetic",
      "edit_progress",
      "edit_observation",
      "edit_proposal",
      "edit_decision",
      "edit_explanation",
    ];
    for (const name of exempt) {
      expect(TOOL_NAMES).toContain(name);
    }
  });

  it("TOOL_NAMES length equals TOOLS_REQUIRING_TEST_FILES length plus exempt set size", () => {
    expect<number>(TOOL_NAMES.length).toBe(TOOLS_REQUIRING_TEST_FILES.length + 6);
  });

  it("includes the universal General principles block verbatim in every description", () => {
    // Per the v0.1.2 policy change: every edit_* tool description must
    // carry the same three-line block so the agent reads the same text
    // at every tool call (cf. docs/SPEC.md §4 trailing block on each
    // tool). Assert byte-for-byte equality of the block — substring-
    // only checks would let drift in spacing, ordering, or bullet
    // wording slip through.
    const principlesBlock =
      "General principles (apply to every edit):\n" +
      "- Keep the code simple. Prefer three similar lines over a premature abstraction.\n" +
      "- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.";
    for (const name of TOOL_NAMES) {
      const desc = TOOL_DESCRIPTIONS[name];
      expect(desc).toContain(principlesBlock);
    }
  });
});

// =====================================================================
// registerTools — ListToolsRequest handler paths
// =====================================================================

describe("registerTools — ListToolsRequest handler", () => {
  it("every tool's input schema requires execution_state", async () => {
    const server = new Server(
      { name: "test", version: "0.0.0" },
      { capabilities: { tools: {} } },
    );
    registerTools(server, {
      context: { repoRoot: process.cwd() },
      handler: async () => ({
        token: "",
        expires_at: "",
        edit_id: "edit_20260523_0001",
        warnings: [],
      }),
    });
    const listHandler = (server as unknown as {
      _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
    })._requestHandlers.get("tools/list");
    if (!listHandler) throw new Error("tools/list handler not registered");
    const result = (await listHandler({
      method: "tools/list",
      params: {},
    })) as { tools: Array<{ inputSchema: { required: string[] } }> };
    for (const tool of result.tools) {
      expect(tool.inputSchema.required).toContain("execution_state");
    }
  });

  it("returns titles so clients can display the specific edit kind in collapsed tool rows", async () => {
    const server = new Server(
      { name: "test", version: "0.0.0" },
      { capabilities: { tools: {} } },
    );
    registerTools(server, {
      context: { repoRoot: process.cwd() },
      handler: async (): Promise<EditToolResult> => ({
        token: "",
        expires_at: "",
        edit_id: "edit_20260522_0001",
        warnings: [],
      }),
    });

    const handler = (server as unknown as { _requestHandlers: Map<string, (req: unknown) => Promise<unknown>> })._requestHandlers.get("tools/list");
    if (!handler) throw new Error("ListToolsRequest handler not registered");
    const result = await handler({ method: "tools/list", params: {} }) as {
      tools: Array<{
        name: ToolName;
        title?: string;
        annotations?: { title?: string };
      }>;
    };

    expect(result.tools.length).toBe(TOOL_NAMES.length);
    for (const tool of result.tools) {
      expect(tool.title).toBe(TOOL_TITLES[tool.name]);
      expect(tool.annotations?.title).toBe(TOOL_TITLES[tool.name]);
    }
  });
});

// =====================================================================
// registerTools — CallToolRequest handler paths
// =====================================================================

describe("registerTools — CallToolRequest handler", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = makeTmpRoot("registry");
    fs.mkdirSync(path.join(tmpRoot, ".git"));
  });

  afterEach(() => {
    cleanTmpRoot(tmpRoot);
  });

  function makeServerWithMockHandler(): {
    server: Server;
    calls: Array<{ tool: ToolName; args: EditToolRequest }>;
  } {
    const calls: Array<{ tool: ToolName; args: EditToolRequest }> = [];
    const server = new Server(
      { name: "test", version: "0.0.0" },
      { capabilities: { tools: {} } },
    );
    const mockHandler = async (
      tool: ToolName,
      args: EditToolRequest,
    ): Promise<EditToolResult> => {
      calls.push({ tool, args });
      return {
        token: "met_20260505_test000000",
        expires_at: "2026-05-05T00:00:00Z",
        edit_id: "edit_20260505_0001",
        warnings: [],
      };
    };
    registerTools(server, {
      context: { repoRoot: tmpRoot },
      handler: mockHandler,
    });
    return { server, calls };
  }

  it("returns isError=true for unknown tool name", async () => {
    const { server } = makeServerWithMockHandler();
    const handler = (server as unknown as { _requestHandlers: Map<string, (req: unknown) => Promise<unknown>> })._requestHandlers.get("tools/call");
    if (!handler) throw new Error("CallToolRequest handler not registered");
    const result = await handler({
      method: "tools/call",
      params: { name: "not_a_real_tool", arguments: {} },
    }) as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Unknown tool");
  });

  it("returns isError=true for invalid arguments (missing required fields)", async () => {
    const { server } = makeServerWithMockHandler();
    const handler = (server as unknown as { _requestHandlers: Map<string, (req: unknown) => Promise<unknown>> })._requestHandlers.get("tools/call");
    if (!handler) throw new Error("CallToolRequest handler not registered");
    const result = await handler({
      method: "tools/call",
      params: { name: "edit_boundary_condition", arguments: {} },
    }) as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Invalid arguments");
  });

  it("dispatches valid request to the handler and returns JSON result", async () => {
    const { server, calls } = makeServerWithMockHandler();
    const handler = (server as unknown as { _requestHandlers: Map<string, (req: unknown) => Promise<unknown>> })._requestHandlers.get("tools/call");
    if (!handler) throw new Error("CallToolRequest handler not registered");
    const result = await handler({
      method: "tools/call",
      params: {
        name: "edit_boundary_condition",
        arguments: {
          target_file: "src/foo.ts",
          rationale: "test",
          risk_level: "medium",
          target: "prod",
          provenance: "direct_observation",
          execution_state: "normal",
          test_files: ["tests/foo.test.ts"],
        },
      },
    }) as { content: Array<{ text: string }> };
    expect(calls.length).toBe(1);
    expect(calls[0]!.tool).toBe("edit_boundary_condition");
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.token).toBe("met_20260505_test000000");
  });
});
