import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { structuredErrorResult, structuredResult } from "../result.js";
import {
  normalizeToolsetError,
  serializeToolsetErrorDetails,
  ToolsetError,
  toolsetErrorOutputSchema,
} from "../toolsets/errors.js";
import type { ToolContext, ToolRegistrar } from "../types.js";

export const selectableToolsetPresetSchema = z.enum([
  "core",
  "inspect",
  "build",
  "show",
  "library",
  "safe",
  "directory",
]);

export const toolProfileStateSchema = z.enum([
  "full",
  "safe",
  "directory",
  "core",
  "inspect",
  "build",
  "show",
  "library",
  "custom",
]);

export const selectToolsetSchema = z
  .object({
    preset: selectableToolsetPresetSchema.optional(),
    tools: z.array(z.string().trim().min(1)).min(1).max(120).optional(),
    mode: z.enum(["replace", "add"]).default("replace"),
    include_risky: z.boolean().default(false),
  })
  .strict();

export const toolsetTransitionOutputSchema = z
  .object({
    ok: z.literal(true),
    previous_profile: toolProfileStateSchema,
    current_profile: toolProfileStateSchema,
    active_count: z.number().int().nonnegative(),
    metadata_bytes: z.number().int().nonnegative(),
    added: z.array(z.string()),
    removed: z.array(z.string()),
    warnings: z.array(z.string()),
    client_refresh_required: z.literal(true),
  })
  .strict();

export const selectToolsetResultSchema = z.discriminatedUnion("ok", [
  toolsetTransitionOutputSchema,
  toolsetErrorOutputSchema,
]);

export const toolsetTransitionMcpOutputSchema = z.object({
  ok: z.boolean(),
  previous_profile: toolProfileStateSchema.optional(),
  current_profile: toolProfileStateSchema.optional(),
  active_count: z.number().int().nonnegative().optional(),
  metadata_bytes: z.number().int().nonnegative().optional(),
  added: z.array(z.string()).optional(),
  removed: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional(),
  client_refresh_required: z.boolean().optional(),
  code: z.string().optional(),
  close_matches: z.array(z.string()).optional(),
  risky_tools: z.array(z.string()).optional(),
  raw_tools: z.array(z.string()).optional(),
  requested_count: z.number().int().nonnegative().optional(),
  max_active: z.number().int().nonnegative().optional(),
  requested_bytes: z.number().int().nonnegative().optional(),
  metadata_budget_bytes: z.number().int().nonnegative().optional(),
  largest_contributors: z
    .array(z.object({ name: z.string(), bytes: z.number().int().nonnegative() }))
    .optional(),
  suggested_presets: z.array(z.string()).optional(),
  protected_tools: z.array(z.string()).optional(),
});

type SelectToolsetArgs = z.infer<typeof selectToolsetSchema>;

export function managementToolErrorResult(error: unknown, ctx: ToolContext): CallToolResult {
  const normalized = normalizeToolsetError(error, ctx.logger);
  return structuredErrorResult(normalized.message, {
    code: normalized.code,
    ...serializeToolsetErrorDetails(normalized),
  });
}

export function dynamicToolsetsDisabledResult(): CallToolResult {
  const error = new ToolsetError("dynamic_toolsets_disabled", "Dynamic toolsets are disabled.");
  return structuredErrorResult(error.message, { code: error.code });
}

export async function selectToolsetImpl(
  ctx: ToolContext,
  args: SelectToolsetArgs,
): Promise<CallToolResult> {
  if (!ctx.toolsets) return dynamicToolsetsDisabledResult();
  try {
    const output = await ctx.toolsets.select(args);
    return structuredResult(
      `Activated ${output.active_count} tools; refresh tools/list before the original call.`,
      output,
    );
  } catch (error) {
    return managementToolErrorResult(error, ctx);
  }
}

export const registerSelectToolset: ToolRegistrar = (server, ctx) => {
  server.registerTool(
    "select_toolset",
    {
      title: "Select toolset",
      description:
        "Activate exactly one preset or one explicit tools list for this session. Presets stay non-risky; explicit destructive or raw tools require explicit risky opt-in. A successful result sets client_refresh_required=true, so refresh tools/list because client visibility may be uncertain before calling the original tool. For a static fallback, set TDMCP_TOOL_PROFILE and restart the server.",
      inputSchema: selectToolsetSchema.shape,
      outputSchema: toolsetTransitionMcpOutputSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    (args) => selectToolsetImpl(ctx, args),
  );
};
