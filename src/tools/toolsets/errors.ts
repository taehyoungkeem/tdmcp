import { z } from "zod";
import { DYNAMIC_MANAGEMENT_TOOL_NAME_SET } from "./profiles.js";
import { TOOL_METADATA } from "./toolMetadata.generated.js";
import type { SelectableToolsetPreset } from "./types.js";

export const TOOLSET_ERROR_CODES = [
  "dynamic_toolsets_disabled",
  "invalid_selection",
  "unknown_tool",
  "risky_tool_requires_explicit_opt_in",
  "raw_python_disabled",
  "active_tool_limit_exceeded",
  "metadata_budget_exceeded",
  "protected_core_tool",
  "toolset_transition_failed",
] as const;

export type ToolsetErrorCode = (typeof TOOLSET_ERROR_CODES)[number];

export interface MetadataContributor {
  name: string;
  bytes: number;
}

export type ToolsetErrorDetails =
  | { code: "dynamic_toolsets_disabled" }
  | { code: "invalid_selection" }
  | { code: "unknown_tool"; close_matches: string[] }
  | { code: "risky_tool_requires_explicit_opt_in"; risky_tools: string[] }
  | { code: "raw_python_disabled"; raw_tools: string[] }
  | {
      code: "active_tool_limit_exceeded";
      requested_count: number;
      max_active: number;
      largest_contributors: MetadataContributor[];
      suggested_presets: SelectableToolsetPreset[];
    }
  | {
      code: "metadata_budget_exceeded";
      requested_bytes: number;
      metadata_budget_bytes: number;
      largest_contributors: MetadataContributor[];
      suggested_presets: SelectableToolsetPreset[];
    }
  | { code: "protected_core_tool"; protected_tools: string[] }
  | { code: "toolset_transition_failed" };

type DetailsFor<C extends ToolsetErrorCode> = C extends ToolsetErrorCode
  ? Omit<Extract<ToolsetErrorDetails, { code: C }>, "code">
  : never;

export interface SerializedToolsetErrorDetails {
  close_matches?: string[];
  risky_tools?: string[];
  raw_tools?: string[];
  requested_count?: number;
  max_active?: number;
  requested_bytes?: number;
  metadata_budget_bytes?: number;
  largest_contributors?: MetadataContributor[];
  suggested_presets?: SelectableToolsetPreset[];
  protected_tools?: string[];
}

const PUBLIC_MESSAGES: Record<ToolsetErrorCode, string> = {
  dynamic_toolsets_disabled: "Dynamic toolsets are disabled.",
  invalid_selection: "Toolset selection is invalid.",
  unknown_tool: "Toolset selection includes unknown tools.",
  risky_tool_requires_explicit_opt_in: "Risky tools require explicit opt-in.",
  raw_python_disabled: "Raw Python tools are disabled.",
  active_tool_limit_exceeded: "Requested toolset exceeds the active tool limit.",
  metadata_budget_exceeded: "Requested toolset exceeds the metadata budget.",
  protected_core_tool: "Protected core tools cannot be disabled.",
  toolset_transition_failed: "Toolset transition rolled back.",
};

const SELECTABLE_PRESET_SET: ReadonlySet<string> = new Set([
  "core",
  "inspect",
  "build",
  "show",
  "library",
  "safe",
  "directory",
]);

function isPublicToolName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (Object.hasOwn(TOOL_METADATA, value) || DYNAMIC_MANAGEMENT_TOOL_NAME_SET.has(value))
  );
}

function safeToolNames(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const item of value) {
    if (!isPublicToolName(item) || names.includes(item)) continue;
    names.push(item);
    if (names.length === limit) break;
  }
  return names;
}

function safeInteger(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function safeContributors(value: unknown): MetadataContributor[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item): MetadataContributor[] => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      if (!isPublicToolName(record.name)) return [];
      return [{ name: record.name, bytes: safeInteger(record.bytes) }];
    })
    .sort((left, right) => right.bytes - left.bytes || left.name.localeCompare(right.name))
    .slice(0, 10);
}

function safePresets(value: unknown): SelectableToolsetPreset[] {
  if (!Array.isArray(value)) return [];
  const presets: SelectableToolsetPreset[] = [];
  for (const item of value) {
    if (
      typeof item !== "string" ||
      !SELECTABLE_PRESET_SET.has(item) ||
      presets.includes(item as SelectableToolsetPreset)
    ) {
      continue;
    }
    presets.push(item as SelectableToolsetPreset);
  }
  return presets;
}

function sanitizedDetails(code: ToolsetErrorCode, details: unknown): ToolsetErrorDetails {
  const record = details && typeof details === "object" ? (details as Record<string, unknown>) : {};
  switch (code) {
    case "unknown_tool":
      return { code, close_matches: safeToolNames(record.close_matches, 5) };
    case "risky_tool_requires_explicit_opt_in":
      return {
        code,
        risky_tools: safeToolNames(record.risky_tools, Number.MAX_SAFE_INTEGER).sort(),
      };
    case "raw_python_disabled":
      return { code, raw_tools: safeToolNames(record.raw_tools, Number.MAX_SAFE_INTEGER).sort() };
    case "active_tool_limit_exceeded":
      return {
        code,
        requested_count: safeInteger(record.requested_count),
        max_active: safeInteger(record.max_active),
        largest_contributors: safeContributors(record.largest_contributors),
        suggested_presets: safePresets(record.suggested_presets),
      };
    case "metadata_budget_exceeded":
      return {
        code,
        requested_bytes: safeInteger(record.requested_bytes),
        metadata_budget_bytes: safeInteger(record.metadata_budget_bytes),
        largest_contributors: safeContributors(record.largest_contributors),
        suggested_presets: safePresets(record.suggested_presets),
      };
    case "protected_core_tool":
      return {
        code,
        protected_tools: safeToolNames(record.protected_tools, Number.MAX_SAFE_INTEGER).sort(),
      };
    default:
      return { code };
  }
}

export class ToolsetError<C extends ToolsetErrorCode = ToolsetErrorCode> extends Error {
  readonly details: DetailsFor<C>;

  constructor(
    readonly code: C,
    _message: string,
    details: DetailsFor<C> = {} as DetailsFor<C>,
  ) {
    super(PUBLIC_MESSAGES[code]);
    this.name = "ToolsetError";
    const { code: _code, ...safeDetails } = sanitizedDetails(code, details);
    this.details = safeDetails as DetailsFor<C>;
  }
}

export function serializeToolsetErrorDetails(error: ToolsetError): SerializedToolsetErrorDetails {
  const { code: _code, ...details } = sanitizedDetails(error.code, error.details);
  return details;
}

export interface ToolsetErrorLogger {
  error(message: string, details?: { code: ToolsetErrorCode }): unknown;
}

export function normalizeToolsetError(error: unknown, logger?: ToolsetErrorLogger): ToolsetError {
  if (error instanceof ToolsetError) return error;
  try {
    logger?.error("Toolset operation failed.", { code: "toolset_transition_failed" });
  } catch {
    // Logging must never replace the fixed public error or expose the thrown value.
  }
  return new ToolsetError("toolset_transition_failed", PUBLIC_MESSAGES.toolset_transition_failed);
}

const contributorSchema = z
  .object({ name: z.string(), bytes: z.number().int().nonnegative() })
  .strict();
const suggestedPresetSchema = z.enum([
  "core",
  "inspect",
  "build",
  "show",
  "library",
  "safe",
  "directory",
]);

export const toolsetErrorOutputSchema = z.discriminatedUnion("code", [
  z.object({ ok: z.literal(false), code: z.literal("dynamic_toolsets_disabled") }).strict(),
  z.object({ ok: z.literal(false), code: z.literal("invalid_selection") }).strict(),
  z
    .object({
      ok: z.literal(false),
      code: z.literal("unknown_tool"),
      close_matches: z.array(z.string()).max(5),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      code: z.literal("risky_tool_requires_explicit_opt_in"),
      risky_tools: z.array(z.string()),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      code: z.literal("raw_python_disabled"),
      raw_tools: z.array(z.string()),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      code: z.literal("active_tool_limit_exceeded"),
      requested_count: z.number().int().nonnegative(),
      max_active: z.number().int().nonnegative(),
      largest_contributors: z.array(contributorSchema).max(10),
      suggested_presets: z.array(suggestedPresetSchema),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      code: z.literal("metadata_budget_exceeded"),
      requested_bytes: z.number().int().nonnegative(),
      metadata_budget_bytes: z.number().int().nonnegative(),
      largest_contributors: z.array(contributorSchema).max(10),
      suggested_presets: z.array(suggestedPresetSchema),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      code: z.literal("protected_core_tool"),
      protected_tools: z.array(z.string()),
    })
    .strict(),
  z.object({ ok: z.literal(false), code: z.literal("toolset_transition_failed") }).strict(),
]);
