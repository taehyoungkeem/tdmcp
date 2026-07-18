/**
 * `run_macro_script` — replay a `MacroRecord` JSON file by dispatching each
 * recorded entry through captured in-process tool contracts. Supports dryRun,
 * per-tool argsOverrides, and stopOnError; direct dispatch is limited to active,
 * input-valid, non-destructive, non-raw-code targets.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  readMacro,
  resolveMacroFile,
  resolveMacrosDir,
  summarizeResult,
} from "../../automation/macroSchema.js";
import { registerToolGroups } from "../registration.js";
import { runtimeToolRegistrarGroups } from "../registry.js";
import { errorResult, structuredResult } from "../result.js";
import { RAW_CODE_TOOL_NAMES } from "../toolsets/profiles.js";
import type { ToolContext, ToolRegistrar } from "../types.js";
import { registerMacroRecorder } from "./macroRecorder.js";

export const runMacroScriptSchema = z.object({
  macroPath: z.string().min(1),
  dryRun: z.boolean().default(false),
  allowRawPython: z.boolean().default(false),
  stopOnError: z.boolean().default(true),
  argsOverrides: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
});

export type RunMacroScriptArgs = z.infer<typeof runMacroScriptSchema>;

type Handler = (args: unknown) => Promise<CallToolResult> | CallToolResult;

interface InputContract {
  safeParse(value: unknown): { success: true; data: unknown } | { success: false; error: unknown };
}

interface MacroDispatchTarget {
  handler: Handler;
  inputSchema: InputContract;
  annotations?: ToolAnnotations;
  rawCode: boolean;
  isActive: () => boolean;
}

type HandlerMap = Map<string, MacroDispatchTarget>;

const cachedHandlers = new WeakMap<ToolContext, HandlerMap>();
const injectedHandlers = new WeakMap<ToolContext, HandlerMap>();
const SENTINEL_CTX: ToolContext = {} as ToolContext;

/** Test-only: inject a handler registry instead of building one from the tool registrars. */
export function __setHandlersForTests(
  handlers: Map<string, Handler> | undefined,
  ctx: ToolContext = SENTINEL_CTX,
): void {
  if (handlers === undefined) {
    injectedHandlers.delete(ctx);
  } else {
    injectedHandlers.set(ctx, normalizeInjectedHandlers(handlers, ctx));
  }
  cachedHandlers.delete(ctx);
}

function isInputContract(value: unknown): value is InputContract {
  return (
    value !== null &&
    typeof value === "object" &&
    "safeParse" in value &&
    typeof value.safeParse === "function"
  );
}

function toInputContract(inputSchema: unknown, acceptsAnything = false): InputContract {
  if (isInputContract(inputSchema)) return inputSchema;
  if (inputSchema !== null && typeof inputSchema === "object") {
    return z.object(inputSchema as z.ZodRawShape);
  }
  return acceptsAnything ? z.unknown() : z.object({});
}

function normalizeInjectedHandlers(handlers: Map<string, Handler>, ctx: ToolContext): HandlerMap {
  const normalized: HandlerMap = new Map();
  for (const [name, injected] of handlers) {
    const candidate = injected as unknown as Partial<MacroDispatchTarget>;
    const handler = typeof injected === "function" ? injected : candidate.handler;
    if (typeof handler !== "function") continue;
    normalized.set(name, {
      handler,
      inputSchema: toInputContract(candidate.inputSchema, true),
      annotations: candidate.annotations,
      rawCode: candidate.rawCode ?? isRawPythonTool(name),
      isActive: candidate.isActive ?? (() => isActiveInSession(ctx, name)),
    });
  }
  return normalized;
}

function isActiveInSession(ctx: ToolContext, name: string): boolean {
  if (ctx.dynamicToolsets !== true) return true;
  try {
    return ctx.toolsets?.getActive().active_tools.includes(name) === true;
  } catch {
    return false;
  }
}

async function getOrBuildToolHandlers(ctx: ToolContext): Promise<HandlerMap> {
  const injectedCtx = injectedHandlers.get(ctx) ?? injectedHandlers.get(SENTINEL_CTX);
  if (injectedCtx) return injectedCtx;
  const cached = cachedHandlers.get(ctx);
  if (cached) return cached;
  const map: HandlerMap = new Map();
  // Stub MCP server that captures the dispatch contract without exposing another MCP surface.
  const stub = {
    registerTool: (
      name: string,
      config: { inputSchema?: unknown; annotations?: ToolAnnotations },
      handler: Handler,
    ) => {
      map.set(name, {
        handler,
        inputSchema: toInputContract(config.inputSchema),
        annotations: config.annotations,
        rawCode: isRawPythonTool(name),
        isActive: () => isActiveInSession(ctx, name),
      });
      return undefined;
    },
  } as unknown as McpServer;
  registerToolGroups(stub, ctx, {
    groups: [
      ...runtimeToolRegistrarGroups,
      { group: "cli", registrars: [registerMacroRecorder, registerRunMacroScript] },
    ],
    dynamic: ctx.dynamicToolsets === true,
  });
  cachedHandlers.set(ctx, map);
  return map;
}

export function isRawPythonTool(tool: string): boolean {
  return (RAW_CODE_TOOL_NAMES as readonly string[]).includes(tool);
}

interface EntryReport {
  index: number;
  tool: string;
  ok: boolean;
  skipped?:
    | "raw-python-blocked"
    | "destructive-tool-blocked"
    | "inactive-tool"
    | "invalid-arguments"
    | "unknown-tool";
  summary?: string;
  ms?: number;
}

export async function runMacroScriptImpl(
  ctx: ToolContext,
  args: RunMacroScriptArgs,
): Promise<CallToolResult> {
  const dir = resolveMacrosDir();
  const file = resolveMacroFile(args.macroPath, dir);

  let record: Awaited<ReturnType<typeof readMacro>>;
  try {
    record = await readMacro(file);
  } catch (err) {
    if (err && typeof err === "object" && "issues" in err) {
      const issues = (err as { issues: Array<{ path: (string | number)[]; message: string }> })
        .issues;
      const summary = issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ");
      return errorResult(`invalid macro file: ${summary}`);
    }
    const msg = err instanceof Error ? err.message : String(err);
    return errorResult(`failed to load macro: ${msg}`);
  }

  const total = record.entries.length;

  if (args.dryRun) {
    const entries: EntryReport[] = record.entries.map((e, i) => ({
      index: i,
      tool: e.tool,
      ok: true,
    }));
    return structuredResult(`dry-run: ${total} entries planned for ${record.name}`, {
      status: "dry-run",
      name: record.name,
      total,
      ran: 0,
      ok: 0,
      failed: 0,
      skipped: 0,
      entries,
    });
  }

  const handlers = await getOrBuildToolHandlers(ctx);
  const overrides = args.argsOverrides ?? {};
  const report: EntryReport[] = [];
  let ran = 0;
  let okCount = 0;
  let failed = 0;
  let skipped = 0;
  let halted = false;

  const recordSkip = (index: number, tool: string, reason: NonNullable<EntryReport["skipped"]>) => {
    report.push({ index, tool, ok: false, skipped: reason });
    skipped++;
    if (args.stopOnError) {
      halted = true;
      return true;
    }
    return false;
  };

  for (let i = 0; i < record.entries.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: loop bounded by length.
    const entry = record.entries[i]!;

    if (isRawPythonTool(entry.tool)) {
      if (recordSkip(i, entry.tool, "raw-python-blocked")) break;
      continue;
    }

    const target = handlers.get(entry.tool);
    if (!target) {
      if (recordSkip(i, entry.tool, "unknown-tool")) break;
      continue;
    }

    if (target.rawCode) {
      if (recordSkip(i, entry.tool, "raw-python-blocked")) break;
      continue;
    }

    if (target.annotations?.destructiveHint === true) {
      if (recordSkip(i, entry.tool, "destructive-tool-blocked")) break;
      continue;
    }

    if (!target.isActive()) {
      if (recordSkip(i, entry.tool, "inactive-tool")) break;
      continue;
    }

    const override = overrides[entry.tool];
    const mergedArgs = override ? { ...entry.args, ...override } : entry.args;
    const parsed = target.inputSchema.safeParse(mergedArgs);
    if (!parsed.success) {
      if (recordSkip(i, entry.tool, "invalid-arguments")) break;
      continue;
    }

    const t0 = Date.now();
    try {
      const handler = target.handler;
      const res = await handler(parsed.data);
      const ms = Date.now() - t0;
      const isErr = res.isError === true;
      report.push({
        index: i,
        tool: entry.tool,
        ok: !isErr,
        summary: summarizeResult(res),
        ms,
      });
      ran++;
      if (isErr) {
        failed++;
        if (args.stopOnError) {
          halted = true;
          break;
        }
      } else {
        okCount++;
      }
    } catch (err) {
      const ms = Date.now() - t0;
      const msg = err instanceof Error ? err.message : String(err);
      report.push({
        index: i,
        tool: entry.tool,
        ok: false,
        summary: `error: ${msg}`.slice(0, 240),
        ms,
      });
      ran++;
      failed++;
      if (args.stopOnError) {
        halted = true;
        break;
      }
    }
  }

  const status = halted ? "halted" : "replayed";
  return structuredResult(
    `${status}: ${okCount}/${total} ok, ${failed} failed, ${skipped} skipped (${record.name})`,
    {
      status,
      name: record.name,
      total,
      ran,
      ok: okCount,
      failed,
      skipped,
      entries: report,
    },
  );
}

export const registerRunMacroScript: ToolRegistrar = (server, ctx) => {
  server.registerTool(
    "run_macro_script",
    {
      title: "Run macro script",
      description:
        "Replay a `MacroRecord` JSON file by dispatching each entry through the in-process tool handlers. Use `dryRun` to plan without invoking, `stopOnError` to halt on first failure, `argsOverrides` to shallow-merge per-tool arg replacements, and `allowRawPython` to opt-in to raw-Python entries (still subject to the server-side ctx gate). Redacted args from a recording may fail at the tool boundary; do not un-redact.",
      inputSchema: runMacroScriptSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    (args) => runMacroScriptImpl(ctx, args),
  );
};
