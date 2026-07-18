import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { structuredResult } from "../result.js";
import { toolsetErrorOutputSchema } from "../toolsets/errors.js";
import type { ToolContext, ToolRegistrar } from "../types.js";
import {
  dynamicToolsetsDisabledResult,
  managementToolErrorResult,
  toolProfileStateSchema,
} from "./selectToolset.js";

const startupProfileSchema = z.enum([
  "full",
  "safe",
  "directory",
  "core",
  "inspect",
  "build",
  "show",
  "library",
]);

export const getActiveToolsetSchema = z.object({}).strict();

export const activeToolsetOutputSchema = z
  .object({
    ok: z.literal(true),
    startup_profile: startupProfileSchema,
    current_profile: toolProfileStateSchema,
    active_tools: z.array(z.string()),
    active_count: z.number().int().nonnegative(),
    metadata_bytes: z.number().int().nonnegative(),
    max_active: z.number().int().nonnegative(),
    metadata_budget_bytes: z.number().int().nonnegative(),
    dynamic_toolsets: z.boolean(),
    protected_core: z.array(z.string()),
  })
  .strict();

export const getActiveToolsetResultSchema = z.discriminatedUnion("ok", [
  activeToolsetOutputSchema,
  toolsetErrorOutputSchema,
]);

const activeToolsetMcpOutputSchema = z.object({
  ok: z.boolean(),
  startup_profile: startupProfileSchema.optional(),
  current_profile: toolProfileStateSchema.optional(),
  active_tools: z.array(z.string()).optional(),
  active_count: z.number().int().nonnegative().optional(),
  metadata_bytes: z.number().int().nonnegative().optional(),
  max_active: z.number().int().nonnegative().optional(),
  metadata_budget_bytes: z.number().int().nonnegative().optional(),
  dynamic_toolsets: z.boolean().optional(),
  protected_core: z.array(z.string()).optional(),
  code: z.string().optional(),
});

export function getActiveToolsetImpl(ctx: ToolContext, _args: object): CallToolResult {
  if (!ctx.toolsets) return dynamicToolsetsDisabledResult();
  try {
    const output = ctx.toolsets.getActive();
    return structuredResult(`${output.active_count} tools are active in this session.`, output);
  } catch (error) {
    return managementToolErrorResult(error, ctx);
  }
}

export const registerGetActiveToolset: ToolRegistrar = (server, ctx) => {
  server.registerTool(
    "get_active_toolset",
    {
      title: "Get active toolset",
      description:
        "Inspect the current session tool profile, exact active names, budgets, and protected core without changing tools. If a prior selection requires refresh, tools/list may remain uncertain until the client refreshes. When dynamic controls are disabled, choose a static profile and restart the server.",
      inputSchema: getActiveToolsetSchema.shape,
      outputSchema: activeToolsetMcpOutputSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    (args) => getActiveToolsetImpl(ctx, args),
  );
};
