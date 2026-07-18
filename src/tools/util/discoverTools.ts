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

const presetSchema = z.enum(["core", "inspect", "build", "show", "library"]);
const groupSchema = z.enum([
  "layer1",
  "layer2",
  "layer3",
  "foundation",
  "library",
  "vault",
  "ai",
  "cli",
  "util",
]);
const riskSchema = z.enum(["read_only", "safe_mutation", "destructive", "raw_code"]);

export const discoverToolsSchema = z
  .object({
    query: z.string().trim().min(1),
    preset: presetSchema.optional(),
    risk: z.enum(["read_only", "safe_mutation", "any"]).default("safe_mutation"),
    limit: z.coerce.number().int().min(1).max(20).default(10),
  })
  .strict();

const discoverToolCandidateSchema = z
  .object({
    name: z.string(),
    summary: z.string(),
    group: groupSchema,
    presets: z.array(presetSchema),
    risk: riskSchema,
    score: z.number(),
    reason: z.string(),
  })
  .strict();

export const discoverToolsOutputSchema = z
  .object({
    ok: z.literal(true),
    query: z.string(),
    normalized_query: z.string(),
    candidates: z.array(discoverToolCandidateSchema),
  })
  .strict();

export const discoverToolsResultSchema = z.discriminatedUnion("ok", [
  discoverToolsOutputSchema,
  toolsetErrorOutputSchema,
]);

const discoverToolsMcpOutputSchema = z.object({
  ok: z.boolean(),
  query: z.string().optional(),
  normalized_query: z.string().optional(),
  candidates: z.array(discoverToolCandidateSchema).optional(),
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

type DiscoverToolsArgs = z.infer<typeof discoverToolsSchema>;

function toolsetErrorResult(error: unknown, ctx: ToolContext): CallToolResult {
  const normalized = normalizeToolsetError(error, ctx.logger);
  return structuredErrorResult(normalized.message, {
    code: normalized.code,
    ...serializeToolsetErrorDetails(normalized),
  });
}

function disabledResult(): CallToolResult {
  const error = new ToolsetError("dynamic_toolsets_disabled", "Dynamic toolsets are disabled.");
  return structuredErrorResult(error.message, { code: error.code });
}

export function discoverToolsImpl(ctx: ToolContext, args: DiscoverToolsArgs): CallToolResult {
  if (!ctx.toolsets) return disabledResult();
  try {
    const output = ctx.toolsets.discover(args);
    return structuredResult(
      `Found ${output.candidates.length} tool candidate(s) for "${output.query}".`,
      output,
    );
  } catch (error) {
    return toolsetErrorResult(error, ctx);
  }
}

export const registerDiscoverTools: ToolRegistrar = (server, ctx) => {
  server.registerTool(
    "discover_tools",
    {
      title: "Discover tools",
      description:
        "Search the session tool catalog before choosing exactly one preset or explicit tool list with select_toolset. Discovery is read-only and filters by risk; selecting risky tools requires explicit risky opt-in. After selection, refresh tools/list because client visibility may be uncertain. If dynamic controls are unavailable, use a static profile and restart the server.",
      inputSchema: discoverToolsSchema.shape,
      outputSchema: discoverToolsMcpOutputSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    (args) => discoverToolsImpl(ctx, args),
  );
};
