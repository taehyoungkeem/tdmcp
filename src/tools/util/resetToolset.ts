import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { structuredResult } from "../result.js";
import { toolsetErrorOutputSchema } from "../toolsets/errors.js";
import type { ToolContext, ToolRegistrar } from "../types.js";
import {
  dynamicToolsetsDisabledResult,
  managementToolErrorResult,
  toolsetTransitionMcpOutputSchema,
  toolsetTransitionOutputSchema,
} from "./selectToolset.js";

export const resetToolsetSchema = z.object({}).strict();

export const resetToolsetResultSchema = z.discriminatedUnion("ok", [
  toolsetTransitionOutputSchema,
  toolsetErrorOutputSchema,
]);

export async function resetToolsetImpl(ctx: ToolContext, _args: object): Promise<CallToolResult> {
  if (!ctx.toolsets) return dynamicToolsetsDisabledResult();
  try {
    const output = await ctx.toolsets.reset();
    return structuredResult(
      `Restored startup profile ${output.current_profile}; refresh tools/list before the original call.`,
      output,
    );
  } catch (error) {
    return managementToolErrorResult(error, ctx);
  }
}

export const registerResetToolset: ToolRegistrar = (server, ctx) => {
  server.registerTool(
    "reset_toolset",
    {
      title: "Reset toolset",
      description:
        "Restore this session's startup tool profile without restarting or deleting data. The result requires a tools/list refresh because client visibility may be uncertain before calling the original tool. If dynamic controls are unavailable, use the equivalent static profile and restart the server.",
      inputSchema: resetToolsetSchema.shape,
      outputSchema: toolsetTransitionMcpOutputSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    (args) => resetToolsetImpl(ctx, args),
  );
};
