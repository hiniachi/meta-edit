import { z } from "zod";
import type { ToolName } from "./descriptions.js";

export const RiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const EditToolRequestSchema = z.object({
  target_file: z.string().min(1),
  patch: z.string().min(1),
  rationale: z.string(),
  risk_level: RiskLevelSchema,
  test_files: z.array(z.string()),
});

export type EditToolRequest = z.infer<typeof EditToolRequestSchema>;

export type EditToolResult = {
  applied: boolean;
  edit_id: string;
  warnings: string[];
};

export type ToolHandler = (
  toolName: ToolName,
  args: EditToolRequest,
) => Promise<EditToolResult>;

// Phase 1: スタブハンドラ。Phase 2 で検証、Phase 3 で適用とログを実装する。
export const stubHandler: ToolHandler = async (toolName, _args) => {
  return {
    applied: false,
    edit_id: "edit_00000000_0000",
    warnings: [`${toolName} is a stub (Phase 1)`],
  };
};
