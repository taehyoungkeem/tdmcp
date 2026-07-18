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

type MacroRecord = Awaited<ReturnType<typeof readMacro>>;
type MacroEntry = MacroRecord["entries"][number];
type MacroOverrides = NonNullable<RunMacroScriptArgs["argsOverrides"]>;

interface ReplayState {
  report: EntryReport[];
  ran: number;
  okCount: number;
  failed: number;
  skipped: number;
  halted: boolean;
}

type LoadedMacro = { ok: true; record: MacroRecord } | { ok: false; result: CallToolResult };

type ResolvedDispatchTarget =
  | { ok: true; target: MacroDispatchTarget }
  | { ok: false; reason: NonNullable<EntryReport["skipped"]> };

interface EntryExecution {
  report: EntryReport;
  failed: boolean;
}

function macroLoadError(err: unknown): CallToolResult {
  if (err && typeof err === "object" && "issues" in err) {
    const issues = (err as { issues: Array<{ path: (string | number)[]; message: string }> })
      .issues;
    const summary = issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ");
    return errorResult(`invalid macro file: ${summary}`);
  }
  const msg = err instanceof Error ? err.message : String(err);
  return errorResult(`failed to load macro: ${msg}`);
}

async function loadMacroRecord(file: string): Promise<LoadedMacro> {
  try {
    return { ok: true, record: await readMacro(file) };
  } catch (err) {
    return { ok: false, result: macroLoadError(err) };
  }
}

function dryRunResult(record: MacroRecord): CallToolResult {
  const entries: EntryReport[] = record.entries.map((entry, index) => ({
    index,
    tool: entry.tool,
    ok: true,
  }));
  return structuredResult(`dry-run: ${entries.length} entries planned for ${record.name}`, {
    status: "dry-run",
    name: record.name,
    total: entries.length,
    ran: 0,
    ok: 0,
    failed: 0,
    skipped: 0,
    entries,
  });
}

function createReplayState(): ReplayState {
  return { report: [], ran: 0, okCount: 0, failed: 0, skipped: 0, halted: false };
}

function recordSkip(
  state: ReplayState,
  stopOnError: boolean,
  index: number,
  tool: string,
  reason: NonNullable<EntryReport["skipped"]>,
): boolean {
  state.report.push({ index, tool, ok: false, skipped: reason });
  state.skipped += 1;
  if (!stopOnError) return false;
  state.halted = true;
  return true;
}

function resolveDispatchTarget(handlers: HandlerMap, tool: string): ResolvedDispatchTarget {
  if (isRawPythonTool(tool)) return { ok: false, reason: "raw-python-blocked" };
  const target = handlers.get(tool);
  if (!target) return { ok: false, reason: "unknown-tool" };
  if (target.rawCode) return { ok: false, reason: "raw-python-blocked" };
  if (target.annotations?.destructiveHint === true) {
    return { ok: false, reason: "destructive-tool-blocked" };
  }
  if (!target.isActive()) return { ok: false, reason: "inactive-tool" };
  return { ok: true, target };
}

function parseEntryArgs(target: MacroDispatchTarget, entry: MacroEntry, overrides: MacroOverrides) {
  const override = overrides[entry.tool];
  const mergedArgs = override ? { ...entry.args, ...override } : entry.args;
  return target.inputSchema.safeParse(mergedArgs);
}

async function invokeMacroTarget(
  target: MacroDispatchTarget,
  parsedArgs: unknown,
  index: number,
  tool: string,
): Promise<EntryExecution> {
  const t0 = Date.now();
  try {
    const handler = target.handler;
    const result = await handler(parsedArgs);
    const ms = Date.now() - t0;
    const isError = result.isError === true;
    return {
      report: {
        index,
        tool,
        ok: !isError,
        summary: summarizeResult(result),
        ms,
      },
      failed: isError,
    };
  } catch (err) {
    const ms = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    return {
      report: {
        index,
        tool,
        ok: false,
        summary: `error: ${msg}`.slice(0, 240),
        ms,
      },
      failed: true,
    };
  }
}

function recordExecution(
  state: ReplayState,
  execution: EntryExecution,
  stopOnError: boolean,
): boolean {
  state.report.push(execution.report);
  state.ran += 1;
  if (!execution.failed) {
    state.okCount += 1;
    return false;
  }
  state.failed += 1;
  if (!stopOnError) return false;
  state.halted = true;
  return true;
}

async function replayEntry(
  state: ReplayState,
  handlers: HandlerMap,
  overrides: MacroOverrides,
  entry: MacroEntry,
  index: number,
  stopOnError: boolean,
): Promise<boolean> {
  const resolved = resolveDispatchTarget(handlers, entry.tool);
  if (!resolved.ok) {
    return recordSkip(state, stopOnError, index, entry.tool, resolved.reason);
  }

  const parsed = parseEntryArgs(resolved.target, entry, overrides);
  if (!parsed.success) {
    return recordSkip(state, stopOnError, index, entry.tool, "invalid-arguments");
  }

  const execution = await invokeMacroTarget(resolved.target, parsed.data, index, entry.tool);
  return recordExecution(state, execution, stopOnError);
}

async function replayMacroRecord(
  record: MacroRecord,
  handlers: HandlerMap,
  args: RunMacroScriptArgs,
): Promise<CallToolResult> {
  const state = createReplayState();
  const overrides = args.argsOverrides ?? {};
  for (let index = 0; index < record.entries.length; index += 1) {
    // biome-ignore lint/style/noNonNullAssertion: loop bounded by length.
    const entry = record.entries[index]!;
    if (await replayEntry(state, handlers, overrides, entry, index, args.stopOnError)) break;
  }

  const status = state.halted ? "halted" : "replayed";
  return structuredResult(
    `${status}: ${state.okCount}/${record.entries.length} ok, ${state.failed} failed, ${state.skipped} skipped (${record.name})`,
    {
      status,
      name: record.name,
      total: record.entries.length,
      ran: state.ran,
      ok: state.okCount,
      failed: state.failed,
      skipped: state.skipped,
      entries: state.report,
    },
  );
}

export async function runMacroScriptImpl(
  ctx: ToolContext,
  args: RunMacroScriptArgs,
): Promise<CallToolResult> {
  const dir = resolveMacrosDir();
  const file = resolveMacroFile(args.macroPath, dir);
  const loaded = await loadMacroRecord(file);
  if (!loaded.ok) return loaded.result;
  if (args.dryRun) return dryRunResult(loaded.record);
  const handlers = await getOrBuildToolHandlers(ctx);
  return replayMacroRecord(loaded.record, handlers, args);
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
