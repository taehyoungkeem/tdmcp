import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { writeMacro } from "../../src/automation/macroSchema.js";
import {
  __setHandlersForTests,
  isRawPythonTool,
  type RunMacroScriptArgs,
  runMacroScriptImpl,
} from "../../src/tools/cli/runMacroScript.js";
import type { ToolContext } from "../../src/tools/types.js";

type Handler = (args: unknown) => Promise<CallToolResult> | CallToolResult;

interface InjectedTarget {
  handler: Handler;
  inputSchema: z.ZodType;
  annotations: { destructiveHint?: boolean };
  rawCode: boolean;
  isActive?: () => boolean;
}

function injectTargets(targets: Map<string, InjectedTarget>, ctx: ToolContext = baseCtx): void {
  __setHandlersForTests(targets as unknown as Map<string, Handler>, ctx);
}

function safeTarget(
  handler: Handler,
  overrides: Partial<Omit<InjectedTarget, "handler">> = {},
): InjectedTarget {
  return {
    handler,
    inputSchema: z.object({}),
    annotations: { destructiveHint: false },
    rawCode: false,
    ...overrides,
  };
}

const baseCtx = {} as ToolContext;

function makeArgs(over: Partial<RunMacroScriptArgs>): RunMacroScriptArgs {
  return {
    macroPath: over.macroPath ?? "missing",
    dryRun: over.dryRun ?? false,
    allowRawPython: over.allowRawPython ?? false,
    stopOnError: over.stopOnError ?? true,
    argsOverrides: over.argsOverrides,
  };
}

async function writeRecord(
  file: string,
  entries: Array<{ tool: string; args?: Record<string, unknown> }>,
) {
  await writeMacro(file, {
    schema_version: 1,
    name: "test",
    created_at: new Date().toISOString(),
    tdmcp_version: "0.0.0",
    entries: entries.map((e, i) => ({ tool: e.tool, args: e.args ?? {}, ts: 1_000 + i })),
  });
}

let tmp: string;
let prevDir: string | undefined;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "tdmcp-runmacro-"));
  prevDir = process.env.TDMCP_MACROS_DIR;
  process.env.TDMCP_MACROS_DIR = tmp;
});

afterEach(() => {
  __setHandlersForTests(undefined);
  __setHandlersForTests(undefined, baseCtx);
  if (prevDir === undefined) delete process.env.TDMCP_MACROS_DIR;
  else process.env.TDMCP_MACROS_DIR = prevDir;
});

describe("runMacroScriptImpl", () => {
  it("returns errorResult on schema-invalid macro", async () => {
    const file = join(tmp, "bad.json");
    await writeFile(file, JSON.stringify({ name: "x", entries: [] }), "utf8");
    const r = await runMacroScriptImpl(baseCtx, makeArgs({ macroPath: file }));
    expect(r.isError).toBe(true);
    const c = r.content?.[0];
    expect(c && "text" in c ? c.text : "").toContain("invalid macro file:");
  });

  it("dryRun lists entries and never invokes handlers", async () => {
    const file = join(tmp, "plan.json");
    await writeRecord(file, [{ tool: "find_td_nodes" }, { tool: "create_td_node" }]);
    const spy = vi.fn();
    __setHandlersForTests(new Map<string, Handler>([["find_td_nodes", spy]]));
    const r = await runMacroScriptImpl(baseCtx, makeArgs({ macroPath: file, dryRun: true }));
    expect(r.isError).toBeFalsy();
    expect(spy).not.toHaveBeenCalled();
    const sc = r.structuredContent as {
      status: string;
      ran: number;
      total: number;
      entries: Array<{ index: number; tool: string }>;
    };
    expect(sc.status).toBe("dry-run");
    expect(sc.ran).toBe(0);
    expect(sc.total).toBe(2);
    expect(sc.entries.map((e) => e.tool)).toEqual(["find_td_nodes", "create_td_node"]);
  });

  it("marks unknown tool entries as skipped and continues with stopOnError=false", async () => {
    const file = join(tmp, "unk.json");
    await writeRecord(file, [{ tool: "nope_tool" }, { tool: "known_tool" }]);
    const known = vi.fn(
      async () => ({ content: [{ type: "text", text: "ok" }] }) as CallToolResult,
    );
    __setHandlersForTests(new Map<string, Handler>([["known_tool", known]]));
    const r = await runMacroScriptImpl(baseCtx, makeArgs({ macroPath: file, stopOnError: false }));
    const sc = r.structuredContent as {
      status: string;
      skipped: number;
      ok: number;
      entries: Array<{ skipped?: string; ok: boolean }>;
    };
    expect(sc.status).toBe("replayed");
    expect(sc.skipped).toBe(1);
    expect(sc.ok).toBe(1);
    expect(sc.entries[0]?.skipped).toBe("unknown-tool");
    expect(known).toHaveBeenCalledOnce();
  });

  it("keeps a captured safe target inactive until the same session activates it", async () => {
    const file = join(tmp, "active-safe.json");
    await writeRecord(file, [{ tool: "create_audio_reactive", args: { level: 2 } }]);
    let active = false;
    const handler = vi.fn(
      async () => ({ content: [{ type: "text", text: "ran" }] }) as CallToolResult,
    );
    const ctx = {
      dynamicToolsets: true,
      toolsets: {
        getActive: () => ({
          active_tools: active ? ["create_audio_reactive"] : [],
        }),
      },
    } as unknown as ToolContext;
    injectTargets(
      new Map([
        [
          "create_audio_reactive",
          safeTarget(handler, {
            inputSchema: z.object({ level: z.number() }),
          }),
        ],
      ]),
      ctx,
    );

    const inactive = await runMacroScriptImpl(
      ctx,
      makeArgs({ macroPath: file, stopOnError: false }),
    );
    const inactiveContent = inactive.structuredContent as {
      ran: number;
      skipped: number;
      entries: Array<{ skipped?: string }>;
    };
    expect(inactiveContent.entries[0]?.skipped).toBe("inactive-tool");
    expect(inactiveContent.ran).toBe(0);
    expect(inactiveContent.skipped).toBe(1);
    expect(handler).not.toHaveBeenCalled();

    active = true;
    const activated = await runMacroScriptImpl(
      ctx,
      makeArgs({ macroPath: file, stopOnError: false }),
    );
    const activatedContent = activated.structuredContent as { ok: number; skipped: number };
    expect(activatedContent.ok).toBe(1);
    expect(activatedContent.skipped).toBe(0);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("rejects invalid captured input without calling the handler or changing state", async () => {
    const file = join(tmp, "invalid-input.json");
    await writeRecord(file, [{ tool: "safe_mutation", args: { amount: -1 } }]);
    let state = 0;
    const handler = vi.fn(async () => {
      state++;
      return { content: [{ type: "text", text: "mutated" }] } as CallToolResult;
    });
    injectTargets(
      new Map([
        [
          "safe_mutation",
          safeTarget(handler, {
            inputSchema: z.object({ amount: z.number().int().positive() }),
          }),
        ],
      ]),
    );

    const result = await runMacroScriptImpl(
      baseCtx,
      makeArgs({ macroPath: file, stopOnError: false }),
    );
    const structured = result.structuredContent as {
      ran: number;
      skipped: number;
      entries: Array<{ skipped?: string }>;
    };
    expect(structured.entries[0]?.skipped).toBe("invalid-arguments");
    expect(structured.ran).toBe(0);
    expect(structured.skipped).toBe(1);
    expect(handler).not.toHaveBeenCalled();
    expect(state).toBe(0);
  });

  it("passes only parsed captured input to an active safe handler", async () => {
    const file = join(tmp, "parsed-input.json");
    await writeRecord(file, [{ tool: "safe_mutation", args: { amount: "2", ignored: "drop-me" } }]);
    const handler = vi.fn(
      async () => ({ content: [{ type: "text", text: "mutated" }] }) as CallToolResult,
    );
    injectTargets(
      new Map([
        [
          "safe_mutation",
          safeTarget(handler, {
            inputSchema: z.object({ amount: z.coerce.number().int().positive() }),
          }),
        ],
      ]),
    );

    const result = await runMacroScriptImpl(baseCtx, makeArgs({ macroPath: file }));
    const structured = result.structuredContent as { ok: number; skipped: number };
    expect(structured.ok).toBe(1);
    expect(structured.skipped).toBe(0);
    expect(handler).toHaveBeenCalledWith({ amount: 2 });
  });

  it("invokes a captured non-arrow handler without a receiver", async () => {
    const file = join(tmp, "handler-receiver.json");
    await writeRecord(file, [{ tool: "receiver_probe", args: {} }]);
    let observedThis: unknown = "not-called";
    function handler(this: unknown): CallToolResult {
      observedThis = this;
      return { content: [{ type: "text", text: "ok" }] };
    }
    injectTargets(new Map([["receiver_probe", safeTarget(handler)]]));

    const result = await runMacroScriptImpl(baseCtx, makeArgs({ macroPath: file }));

    expect((result.structuredContent as { ok: number }).ok).toBe(1);
    expect(observedThis).toBeUndefined();
  });

  it("refuses raw-Python entries when ctx.allowRawPython === false", async () => {
    const file = join(tmp, "py.json");
    await writeRecord(file, [{ tool: "execute_python_script", args: { script: "x" } }]);
    const spy = vi.fn();
    __setHandlersForTests(new Map<string, Handler>([["execute_python_script", spy]]));
    const ctx = { allowRawPython: false } as ToolContext;
    const r = await runMacroScriptImpl(ctx, makeArgs({ macroPath: file, stopOnError: false }));
    expect(spy).not.toHaveBeenCalled();
    const sc = r.structuredContent as { entries: Array<{ skipped?: string }>; skipped: number };
    expect(sc.entries[0]?.skipped).toBe("raw-python-blocked");
    expect(sc.skipped).toBe(1);
  });

  it("requires per-replay opt-in for author_script_operator", async () => {
    const file = join(tmp, "author-script.json");
    await writeRecord(file, [{ tool: "author_script_operator", args: { callbacks: {} } }]);
    const spy = vi.fn();
    __setHandlersForTests(new Map<string, Handler>([["author_script_operator", spy]]));

    const result = await runMacroScriptImpl(
      { allowRawPython: true } as ToolContext,
      makeArgs({ macroPath: file, stopOnError: false }),
    );

    expect(spy).not.toHaveBeenCalled();
    const structured = result.structuredContent as {
      entries: Array<{ skipped?: string }>;
      skipped: number;
    };
    expect(structured.entries[0]?.skipped).toBe("raw-python-blocked");
    expect(structured.skipped).toBe(1);
  });

  it.each([
    { contextAllows: false, macroOptsIn: false },
    { contextAllows: false, macroOptsIn: true },
    { contextAllows: true, macroOptsIn: false },
    { contextAllows: true, macroOptsIn: true },
  ])("always rejects every captured raw-code target (ctx=$contextAllows, macro=$macroOptsIn)", async ({
    contextAllows,
    macroOptsIn,
  }) => {
    const rawTools = [
      "execute_python_script",
      "exec_node_method",
      "create_python_script",
      "author_script_operator",
    ] as const;
    const file = join(tmp, `raw-${contextAllows}-${macroOptsIn}.json`);
    await writeRecord(
      file,
      rawTools.map((tool) => ({ tool, args: { script: "x" } })),
    );
    const spies = rawTools.map(() => vi.fn());
    const ctx = { allowRawPython: contextAllows } as ToolContext;
    injectTargets(
      new Map(
        rawTools.map((tool, index) => [
          tool,
          safeTarget(spies[index] as Handler, {
            annotations: { destructiveHint: true },
            rawCode: true,
          }),
        ]),
      ),
      ctx,
    );

    const result = await runMacroScriptImpl(
      ctx,
      makeArgs({ macroPath: file, allowRawPython: macroOptsIn, stopOnError: false }),
    );
    const structured = result.structuredContent as {
      ran: number;
      skipped: number;
      entries: Array<{ skipped?: string }>;
    };
    expect(structured.entries.map((entry) => entry.skipped)).toEqual(
      rawTools.map(() => "raw-python-blocked"),
    );
    expect(structured.ran).toBe(0);
    expect(structured.skipped).toBe(rawTools.length);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("rejects delete_td_node and any other captured destructive target even when active", async () => {
    const destructiveTools = ["delete_td_node", "manage_component", "future_destructive_tool"];
    const file = join(tmp, "destructive.json");
    await writeRecord(
      file,
      destructiveTools.map((tool) => ({ tool, args: {} })),
    );
    const spies = destructiveTools.map(() => vi.fn());
    injectTargets(
      new Map(
        destructiveTools.map((tool, index) => [
          tool,
          safeTarget(spies[index] as Handler, {
            annotations: { destructiveHint: true },
            isActive: () => true,
          }),
        ]),
      ),
    );

    const result = await runMacroScriptImpl(
      baseCtx,
      makeArgs({ macroPath: file, allowRawPython: true, stopOnError: false }),
    );
    const structured = result.structuredContent as {
      ran: number;
      skipped: number;
      entries: Array<{ skipped?: string }>;
    };
    expect(structured.entries.map((entry) => entry.skipped)).toEqual(
      destructiveTools.map(() => "destructive-tool-blocked"),
    );
    expect(structured.ran).toBe(0);
    expect(structured.skipped).toBe(destructiveTools.length);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("happy path: dispatches in order, ms numeric", async () => {
    const file = join(tmp, "ok.json");
    await writeRecord(file, [{ tool: "a" }, { tool: "b" }, { tool: "c" }]);
    const calls: string[] = [];
    const mkH =
      (n: string): Handler =>
      async () => {
        calls.push(n);
        return { content: [{ type: "text", text: n }] };
      };
    __setHandlersForTests(
      new Map<string, Handler>([
        ["a", mkH("a")],
        ["b", mkH("b")],
        ["c", mkH("c")],
      ]),
    );
    const r = await runMacroScriptImpl(baseCtx, makeArgs({ macroPath: file }));
    const sc = r.structuredContent as {
      ok: number;
      failed: number;
      entries: Array<{ tool: string; ms?: number }>;
    };
    expect(sc.ok).toBe(3);
    expect(sc.failed).toBe(0);
    expect(calls).toEqual(["a", "b", "c"]);
    expect(typeof sc.entries[0]?.ms).toBe("number");
  });

  it("stopOnError=true halts after first isError", async () => {
    const file = join(tmp, "halt.json");
    await writeRecord(file, [{ tool: "a" }, { tool: "b" }, { tool: "c" }]);
    const cSpy = vi.fn();
    __setHandlersForTests(
      new Map<string, Handler>([
        ["a", async () => ({ content: [{ type: "text", text: "ok" }] })],
        ["b", async () => ({ isError: true, content: [{ type: "text", text: "bad" }] })],
        ["c", cSpy],
      ]),
    );
    const r = await runMacroScriptImpl(baseCtx, makeArgs({ macroPath: file, stopOnError: true }));
    const sc = r.structuredContent as { status: string; failed: number; ran: number };
    expect(sc.status).toBe("halted");
    expect(sc.failed).toBe(1);
    expect(sc.ran).toBe(2);
    expect(cSpy).not.toHaveBeenCalled();
  });

  it("argsOverrides shallow-merges over entry args (override wins)", async () => {
    const file = join(tmp, "ov.json");
    await writeRecord(file, [{ tool: "t", args: { a: 1, b: 2 } }]);
    let seen: Record<string, unknown> | undefined;
    __setHandlersForTests(
      new Map<string, Handler>([
        [
          "t",
          async (args: unknown) => {
            seen = args as Record<string, unknown>;
            return { content: [{ type: "text", text: "ok" }] };
          },
        ],
      ]),
    );
    await runMacroScriptImpl(
      baseCtx,
      makeArgs({ macroPath: file, argsOverrides: { t: { b: 99, c: 3 } } }),
    );
    expect(seen).toEqual({ a: 1, b: 99, c: 3 });
  });

  it("resolveMacroFile parity: bare name resolves against TDMCP_MACROS_DIR", async () => {
    await writeRecord(join(tmp, "foo.json"), [{ tool: "x" }]);
    __setHandlersForTests(
      new Map<string, Handler>([["x", async () => ({ content: [{ type: "text", text: "ok" }] })]]),
    );
    const r = await runMacroScriptImpl(baseCtx, makeArgs({ macroPath: "foo" }));
    const sc = r.structuredContent as { ok: number };
    expect(sc.ok).toBe(1);
  });

  it("isRawPythonTool covers documented names", () => {
    expect(isRawPythonTool("execute_python_script")).toBe(true);
    expect(isRawPythonTool("create_python_script")).toBe(true);
    expect(isRawPythonTool("exec_node_method")).toBe(true);
    expect(isRawPythonTool("author_script_operator")).toBe(true);
    expect(isRawPythonTool("find_td_nodes")).toBe(false);
  });
});
