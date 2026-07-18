import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import {
  normalizeToolsetError,
  serializeToolsetErrorDetails,
  ToolsetError,
  type ToolsetErrorCode,
} from "../../src/tools/toolsets/errors.js";
import { ToolsetManager } from "../../src/tools/toolsets/manager.js";
import { serializedToolListBytesFromEntries } from "../../src/tools/toolsets/metadata.js";
import {
  DYNAMIC_MANAGEMENT_TOOL_NAME_SET,
  DYNAMIC_MANAGEMENT_TOOL_NAMES,
  PROTECTED_CORE_TOOL_NAMES,
  SAFE_PROFILE_EXCLUDE,
} from "../../src/tools/toolsets/profiles.js";
import { TOOL_METADATA } from "../../src/tools/toolsets/toolMetadata.generated.js";
import type {
  CapturedToolRegistration,
  SelectToolsetInput,
} from "../../src/tools/toolsets/types.js";
import type { ToolProfile } from "../../src/utils/config.js";

const LARGE_LIMIT = 10_000;
const LARGE_BYTE_BUDGET = 10_000_000;
const ALL_DYNAMIC_NAMES = [
  ...new Set([...Object.keys(TOOL_METADATA), ...DYNAMIC_MANAGEMENT_TOOL_NAMES]),
].sort();

interface FakeHandleOptions {
  enabled?: boolean;
  failure?: unknown;
}

interface TestSessionOptions {
  names?: readonly string[];
  startupProfile?: ToolProfile;
  maxActive?: number;
  metadataBudgetBytes?: number;
  allowRawPython?: boolean;
  initiallyEnabled?: boolean;
  destructiveNames?: ReadonlySet<string>;
  failures?: ReadonlyMap<string, unknown>;
}

interface TestSession {
  manager: ToolsetManager;
  server: McpServer;
  notifier: ReturnType<typeof vi.fn>;
  handles: Map<string, RegisteredTool>;
  operations: string[];
}

function makeFakeHandle(
  name: string,
  server: McpServer,
  operations: string[],
  options: FakeHandleOptions = {},
): RegisteredTool {
  let remainingFailures = options.failure === undefined ? 0 : 1;
  const handle = {
    enabled: options.enabled ?? true,
    handler: vi.fn(),
    enable: () => handle.update({ enabled: true }),
    disable: () => handle.update({ enabled: false }),
    update: (updates: { enabled?: boolean }) => {
      if (updates.enabled !== undefined && updates.enabled !== handle.enabled) {
        operations.push(`${name}:${updates.enabled ? "enable" : "disable"}`);
        if (remainingFailures > 0) {
          remainingFailures -= 1;
          throw options.failure;
        }
        handle.enabled = updates.enabled;
      }
      server.sendToolListChanged();
    },
    remove: vi.fn(),
  };
  return handle as unknown as RegisteredTool;
}

function makeSession(options: TestSessionOptions = {}): TestSession {
  const notifier = vi.fn();
  const server = { sendToolListChanged: notifier } as unknown as McpServer;
  const operations: string[] = [];
  const handles = new Map<string, RegisteredTool>();
  const manager = new ToolsetManager({
    server,
    startupProfile: options.startupProfile ?? "core",
    maxActive: options.maxActive ?? LARGE_LIMIT,
    metadataBudgetBytes: options.metadataBudgetBytes ?? LARGE_BYTE_BUDGET,
    allowRawPython: options.allowRawPython ?? true,
  });

  for (const name of options.names ?? PROTECTED_CORE_TOOL_NAMES) {
    const handle = makeFakeHandle(name, server, operations, {
      enabled: options.initiallyEnabled ?? true,
      failure: options.failures?.get(name),
    });
    handles.set(name, handle);
    manager.capture({
      name,
      group: "util",
      description: `${name} public description.`,
      annotations: {
        readOnlyHint: !options.destructiveNames?.has(name),
        destructiveHint: options.destructiveNames?.has(name) ?? false,
        openWorldHint: false,
      },
      handle,
    });
  }
  return { manager, server, notifier, handles, operations };
}

function captureRegistration(name: string, handle: RegisteredTool): CapturedToolRegistration {
  return {
    name,
    group: "util",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    handle,
  };
}

function enabledSnapshot(handles: ReadonlyMap<string, RegisteredTool>): Record<string, boolean> {
  return Object.fromEntries(
    [...handles]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, handle]) => [name, handle.enabled]),
  );
}

function enabledNames(handles: ReadonlyMap<string, RegisteredTool>): string[] {
  return [...handles]
    .filter(([, handle]) => handle.enabled)
    .map(([name]) => name)
    .sort();
}

function metadataBytes(names: readonly string[]): number {
  return serializedToolListBytesFromEntries(
    [...names].sort().map((name) => TOOL_METADATA[name]?.bytes ?? 0),
  );
}

async function rejectedWith(
  operation: Promise<unknown>,
  code: ToolsetErrorCode,
): Promise<ToolsetError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(ToolsetError);
    expect(error).toMatchObject({ code });
    return error as ToolsetError;
  }
  throw new Error(`Expected ToolsetError ${code}.`);
}

function unsafeSelection(input: Record<string, unknown>): SelectToolsetInput {
  return input as SelectToolsetInput;
}

function expectedSafeStartupNames(): string[] {
  return ALL_DYNAMIC_NAMES.filter(
    (name) => DYNAMIC_MANAGEMENT_TOOL_NAME_SET.has(name) || !SAFE_PROFILE_EXCLUDE.has(name),
  );
}

describe("ToolsetManager capture and initialization", () => {
  it("rejects duplicate captured registrations", () => {
    const session = makeSession();
    const handle = session.handles.get("get_td_info");
    expect(handle).toBeDefined();

    expect(() =>
      session.manager.capture(captureRegistration("get_td_info", handle as RegisteredTool)),
    ).toThrow(/duplicate captured tool registration/i);
  });

  it("initializes core without a client notification", () => {
    const session = makeSession({
      names: ALL_DYNAMIC_NAMES,
      startupProfile: "core",
      initiallyEnabled: true,
    });
    const originalNotify = session.server.sendToolListChanged;

    session.manager.initialize();

    expect(enabledNames(session.handles)).toEqual([...PROTECTED_CORE_TOOL_NAMES].sort());
    expect(session.manager.getActive()).toEqual({
      ok: true,
      startup_profile: "core",
      current_profile: "core",
      active_tools: [...PROTECTED_CORE_TOOL_NAMES].sort(),
      active_count: 17,
      metadata_bytes: metadataBytes(PROTECTED_CORE_TOOL_NAMES),
      max_active: LARGE_LIMIT,
      metadata_budget_bytes: LARGE_BYTE_BUDGET,
      dynamic_toolsets: true,
      protected_core: [...PROTECTED_CORE_TOOL_NAMES].sort(),
    });
    expect(session.notifier).not.toHaveBeenCalled();
    expect(session.server.sendToolListChanged).toBe(originalNotify);
  });

  it("initializes exactly once", () => {
    const session = makeSession();
    session.manager.initialize();
    const before = enabledSnapshot(session.handles);

    expect(() => session.manager.initialize()).toThrow(/already initialized/i);
    expect(enabledSnapshot(session.handles)).toEqual(before);
    expect(session.notifier).not.toHaveBeenCalled();
  });

  it("allows zero-byte fallback only for management registrations", () => {
    const sentinelName = "/private/SENTINEL_METADATA_PATH/schema-handler-token";
    const session = makeSession({ names: [...PROTECTED_CORE_TOOL_NAMES, sentinelName] });
    const before = enabledSnapshot(session.handles);

    let failure: unknown;
    try {
      session.manager.initialize();
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ToolsetError);
    expect(failure).toMatchObject({ code: "toolset_transition_failed" });
    expect(JSON.stringify(failure)).not.toContain("SENTINEL_METADATA_PATH");
    expect(enabledSnapshot(session.handles)).toEqual(before);
    expect(session.notifier).not.toHaveBeenCalled();
  });
});

describe("ToolsetManager selection", () => {
  it("unions every selection with the protected 17-tool core", async () => {
    const optional = "create_audio_reactive";
    const session = makeSession({ names: [...PROTECTED_CORE_TOOL_NAMES, optional] });
    session.manager.initialize();
    session.operations.length = 0;

    const result = await session.manager.select({ tools: [optional] });

    const expected = [...PROTECTED_CORE_TOOL_NAMES, optional].sort();
    expect(enabledNames(session.handles)).toEqual(expected);
    expect(result).toMatchObject({
      ok: true,
      previous_profile: "core",
      current_profile: "custom",
      active_count: 18,
      added: [optional],
      removed: [],
      client_refresh_required: true,
    });
    expect(result.metadata_bytes).toBe(metadataBytes(expected));
  });

  it("rejects unknown names with close matches and no state change", async () => {
    const session = makeSession();
    session.manager.initialize();
    session.operations.length = 0;
    const before = enabledSnapshot(session.handles);
    const profileBefore = session.manager.getActive().current_profile;

    const error = await rejectedWith(
      session.manager.select({ tools: ["discover_toolz"] }),
      "unknown_tool",
    );

    expect(serializeToolsetErrorDetails(error)).toMatchObject({
      close_matches: expect.arrayContaining(["discover_tools"]),
    });
    expect(enabledSnapshot(session.handles)).toEqual(before);
    expect(session.manager.getActive().current_profile).toBe(profileBefore);
    expect(session.operations).toEqual([]);
    expect(session.notifier).not.toHaveBeenCalled();
  });

  it("delegates deterministic discovery to the session catalog", () => {
    const session = makeSession({
      names: [...PROTECTED_CORE_TOOL_NAMES, "create_audio_reactive"],
    });
    session.manager.initialize();

    expect(
      session.manager.discover({ query: "audio reactive visual" }).candidates[0],
    ).toMatchObject({ name: "create_audio_reactive" });
  });

  it("keeps lifecycle maps local to each manager session", async () => {
    const optional = "create_audio_reactive";
    const first = makeSession({ names: [...PROTECTED_CORE_TOOL_NAMES, optional] });
    const second = makeSession({ names: [...PROTECTED_CORE_TOOL_NAMES, optional] });
    first.manager.initialize();
    second.manager.initialize();
    const secondBefore = enabledSnapshot(second.handles);

    await first.manager.select({ tools: [optional] });

    expect(first.handles.get(optional)?.enabled).toBe(true);
    expect(enabledSnapshot(second.handles)).toEqual(secondBefore);
    expect(second.notifier).not.toHaveBeenCalled();
  });
});

describe("ToolsetManager validation and budgets", () => {
  it("validates the complete selection shape before lifecycle calls", async () => {
    const session = makeSession();
    session.manager.initialize();
    session.operations.length = 0;
    const before = enabledSnapshot(session.handles);

    for (const input of [
      {},
      { preset: "core", tools: ["get_td_info"] },
      { tools: [] },
      { preset: "core", include_risky: true },
    ]) {
      await rejectedWith(session.manager.select(unsafeSelection(input)), "invalid_selection");
    }

    expect(enabledSnapshot(session.handles)).toEqual(before);
    expect(session.operations).toEqual([]);
    expect(session.notifier).not.toHaveBeenCalled();
  });

  it("requires explicit tools plus include_risky for destructive/raw code", async () => {
    const presetRisk = "create_td_node";
    const explicitRisk = "delete_td_node";
    const session = makeSession({
      names: [...PROTECTED_CORE_TOOL_NAMES, presetRisk, explicitRisk],
      destructiveNames: new Set([presetRisk, explicitRisk]),
    });
    session.manager.initialize();
    session.operations.length = 0;
    const before = enabledSnapshot(session.handles);

    const presetError = await rejectedWith(
      session.manager.select({ preset: "build" }),
      "risky_tool_requires_explicit_opt_in",
    );
    const explicitError = await rejectedWith(
      session.manager.select({ tools: [explicitRisk] }),
      "risky_tool_requires_explicit_opt_in",
    );

    expect(serializeToolsetErrorDetails(presetError)).toEqual({ risky_tools: [presetRisk] });
    expect(serializeToolsetErrorDetails(explicitError)).toEqual({
      risky_tools: [explicitRisk],
    });
    expect(enabledSnapshot(session.handles)).toEqual(before);
    expect(session.operations).toEqual([]);
    expect(session.notifier).not.toHaveBeenCalled();

    await expect(
      session.manager.select({ tools: [explicitRisk], include_risky: true }),
    ).resolves.toMatchObject({ current_profile: "custom" });
    expect(session.handles.get(explicitRisk)?.enabled).toBe(true);
  });

  it("keeps raw code blocked when raw Python is off", async () => {
    const rawName = "execute_python_script";
    for (const names of [[...PROTECTED_CORE_TOOL_NAMES, rawName], [...PROTECTED_CORE_TOOL_NAMES]]) {
      const session = makeSession({
        names,
        allowRawPython: false,
        destructiveNames: new Set([rawName]),
      });
      session.manager.initialize();
      session.operations.length = 0;
      const before = enabledSnapshot(session.handles);

      const error = await rejectedWith(
        session.manager.select({ tools: [rawName], include_risky: true }),
        "raw_python_disabled",
      );

      expect(serializeToolsetErrorDetails(error)).toEqual({ raw_tools: [rawName] });
      expect(enabledSnapshot(session.handles)).toEqual(before);
      expect(session.operations).toEqual([]);
      expect(session.notifier).not.toHaveBeenCalled();
    }
  });

  it("rejects count and byte budgets with largest contributors", async () => {
    const optionalNames = ["create_audio_reactive", "create_glsl_shader"];
    const countSession = makeSession({
      names: [...PROTECTED_CORE_TOOL_NAMES, ...optionalNames],
      maxActive: 18,
    });
    countSession.manager.initialize();
    countSession.operations.length = 0;
    const countBefore = enabledSnapshot(countSession.handles);

    const countError = await rejectedWith(
      countSession.manager.select({ tools: optionalNames }),
      "active_tool_limit_exceeded",
    );
    const countDetails = serializeToolsetErrorDetails(countError);
    expect(countDetails).toMatchObject({
      requested_count: 19,
      max_active: 18,
      suggested_presets: expect.arrayContaining(["core"]),
    });
    expect(countDetails.largest_contributors).toEqual(
      [...(countDetails.largest_contributors ?? [])].sort(
        (left, right) => right.bytes - left.bytes || left.name.localeCompare(right.name),
      ),
    );
    expect(countDetails.largest_contributors).toHaveLength(10);
    expect(enabledSnapshot(countSession.handles)).toEqual(countBefore);
    expect(countSession.operations).toEqual([]);
    expect(countSession.notifier).not.toHaveBeenCalled();

    const coreBytes = metadataBytes(PROTECTED_CORE_TOOL_NAMES);
    const byteSession = makeSession({
      names: [...PROTECTED_CORE_TOOL_NAMES, optionalNames[0] as string],
      metadataBudgetBytes: coreBytes,
    });
    byteSession.manager.initialize();
    byteSession.operations.length = 0;
    const byteBefore = enabledSnapshot(byteSession.handles);

    const byteError = await rejectedWith(
      byteSession.manager.select({ tools: [optionalNames[0] as string] }),
      "metadata_budget_exceeded",
    );
    const byteDetails = serializeToolsetErrorDetails(byteError);
    expect(byteDetails).toMatchObject({
      requested_bytes: metadataBytes([...PROTECTED_CORE_TOOL_NAMES, optionalNames[0] as string]),
      metadata_budget_bytes: coreBytes,
      suggested_presets: expect.arrayContaining(["core"]),
    });
    expect(byteDetails.largest_contributors).toEqual(
      [...(byteDetails.largest_contributors ?? [])].sort(
        (left, right) => right.bytes - left.bytes || left.name.localeCompare(right.name),
      ),
    );
    expect(enabledSnapshot(byteSession.handles)).toEqual(byteBefore);
    expect(byteSession.operations).toEqual([]);
    expect(byteSession.notifier).not.toHaveBeenCalled();
  });
});

describe("ToolsetManager legacy startup compatibility", () => {
  it("keeps full startup/reset compatibility out of selection", async () => {
    const full = makeSession({
      names: ALL_DYNAMIC_NAMES,
      startupProfile: "full",
      maxActive: 120,
      metadataBudgetBytes: 262_144,
      initiallyEnabled: true,
    });
    full.manager.initialize();
    expect(full.manager.getActive()).toMatchObject({
      startup_profile: "full",
      current_profile: "full",
      active_count: 501,
    });
    expect(full.manager.getActive().active_tools).toEqual(ALL_DYNAMIC_NAMES);
    expect(full.notifier).not.toHaveBeenCalled();

    await full.manager.select({ preset: "core" });
    expect(full.manager.getActive()).toMatchObject({ current_profile: "core", active_count: 17 });
    const reset = await full.manager.reset();
    expect(reset).toMatchObject({ current_profile: "full", active_count: 501 });
    expect(full.manager.getActive().active_tools).toEqual(ALL_DYNAMIC_NAMES);
    expect(full.notifier).toHaveBeenCalledTimes(2);

    const compact = makeSession({
      names: ALL_DYNAMIC_NAMES,
      startupProfile: "core",
      maxActive: 120,
      metadataBudgetBytes: 262_144,
    });
    compact.manager.initialize();
    compact.operations.length = 0;
    const compactBefore = enabledSnapshot(compact.handles);

    await rejectedWith(
      compact.manager.select(unsafeSelection({ preset: "full" })),
      "invalid_selection",
    );

    expect(enabledSnapshot(compact.handles)).toEqual(compactBefore);
    expect(compact.operations).toEqual([]);
    expect(compact.notifier).not.toHaveBeenCalled();
  });

  it("preserves a safe startup/reset compatibility state", async () => {
    const expectedSafe = expectedSafeStartupNames();
    expect(expectedSafe).toHaveLength(462);
    const safe = makeSession({
      names: ALL_DYNAMIC_NAMES,
      startupProfile: "safe",
      maxActive: 120,
      metadataBudgetBytes: 262_144,
      initiallyEnabled: true,
    });

    safe.manager.initialize();

    expect(safe.manager.getActive()).toMatchObject({
      startup_profile: "safe",
      current_profile: "safe",
      active_count: 462,
    });
    expect(safe.manager.getActive().active_tools).toEqual(expectedSafe);
    expect(safe.notifier).not.toHaveBeenCalled();

    await safe.manager.select({ preset: "core" });
    await safe.manager.reset();
    expect(safe.manager.getActive()).toMatchObject({ current_profile: "safe", active_count: 462 });
    expect(safe.manager.getActive().active_tools).toEqual(expectedSafe);
    expect(safe.notifier).toHaveBeenCalledTimes(2);

    const compact = makeSession({
      names: ALL_DYNAMIC_NAMES,
      startupProfile: "core",
      maxActive: 120,
      metadataBudgetBytes: 262_144,
    });
    compact.manager.initialize();
    compact.operations.length = 0;
    const compactBefore = enabledSnapshot(compact.handles);

    await rejectedWith(compact.manager.select({ preset: "safe" }), "active_tool_limit_exceeded");
    expect(enabledSnapshot(compact.handles)).toEqual(compactBefore);
    expect(compact.operations).toEqual([]);
    expect(compact.notifier).not.toHaveBeenCalled();

    const byteBound = makeSession({
      names: ALL_DYNAMIC_NAMES,
      startupProfile: "core",
      maxActive: 501,
      metadataBudgetBytes: 262_144,
    });
    byteBound.manager.initialize();
    byteBound.operations.length = 0;
    const byteBefore = enabledSnapshot(byteBound.handles);
    await rejectedWith(byteBound.manager.select({ preset: "safe" }), "metadata_budget_exceeded");
    expect(enabledSnapshot(byteBound.handles)).toEqual(byteBefore);
    expect(byteBound.operations).toEqual([]);
    expect(byteBound.notifier).not.toHaveBeenCalled();
  });
});

describe("ToolsetManager atomic transitions", () => {
  it("applies replace and add modes", async () => {
    const audio = "create_audio_reactive";
    const glsl = "create_glsl_shader";
    const inspectOnly = "get_bridge_logs";
    const session = makeSession({
      names: [...PROTECTED_CORE_TOOL_NAMES, audio, glsl, inspectOnly],
    });
    session.manager.initialize();

    const preset = await session.manager.select({ preset: "build" });
    expect(preset.current_profile).toBe("build");
    expect(session.manager.getActive().active_tools).toEqual(
      [...PROTECTED_CORE_TOOL_NAMES, audio, glsl].sort(),
    );

    const explicit = await session.manager.select({ tools: [inspectOnly] });
    expect(explicit).toMatchObject({ previous_profile: "build", current_profile: "custom" });
    expect(session.manager.getActive().active_tools).toEqual(
      [...PROTECTED_CORE_TOOL_NAMES, inspectOnly].sort(),
    );

    const addExplicit = await session.manager.select({ tools: [audio], mode: "add" });
    expect(addExplicit.current_profile).toBe("custom");
    expect(session.manager.getActive().active_tools).toEqual(
      [...PROTECTED_CORE_TOOL_NAMES, inspectOnly, audio].sort(),
    );

    const addPreset = await session.manager.select({ preset: "build", mode: "add" });
    expect(addPreset.current_profile).toBe("custom");
    expect(session.manager.getActive().active_tools).toEqual(
      [...PROTECTED_CORE_TOOL_NAMES, inspectOnly, audio, glsl].sort(),
    );
  });

  it("rolls back every handle when one lifecycle update throws", async () => {
    const optionalNames = ["create_audio_reactive", "create_glsl_shader", "get_bridge_logs"];
    const sentinel = {
      token: "SENTINEL_TOKEN_DO_NOT_LEAK",
      path: "/private/sentinel/path",
      schema: "SENTINEL_SCHEMA_TEXT",
      handler: "SENTINEL_HANDLER_TEXT",
    };
    const session = makeSession({
      names: [...PROTECTED_CORE_TOOL_NAMES, ...optionalNames],
      initiallyEnabled: false,
      failures: new Map([[optionalNames[1] as string, sentinel]]),
    });
    session.manager.initialize();
    session.operations.length = 0;
    const before = enabledSnapshot(session.handles);
    const originalNotify = session.server.sendToolListChanged;

    const error = await rejectedWith(
      session.manager.select({ tools: optionalNames }),
      "toolset_transition_failed",
    );

    expect(enabledSnapshot(session.handles)).toEqual(before);
    expect(session.operations).toEqual([
      `${optionalNames[0]}:enable`,
      `${optionalNames[1]}:enable`,
      `${optionalNames[0]}:disable`,
    ]);
    expect(session.notifier).not.toHaveBeenCalled();
    expect(session.server.sendToolListChanged).toBe(originalNotify);
    expect(JSON.stringify({ message: error.message, details: error.details })).not.toContain(
      "SENTINEL",
    );
  });

  it("rolls back initialization without notifying when a lifecycle update throws", () => {
    const optionalNames = ["create_audio_reactive", "create_glsl_shader", "get_bridge_logs"];
    const session = makeSession({
      names: [...PROTECTED_CORE_TOOL_NAMES, ...optionalNames],
      initiallyEnabled: true,
      failures: new Map([[optionalNames[1] as string, new Error("SENTINEL_INIT_FAILURE")]]),
    });
    const before = enabledSnapshot(session.handles);
    const originalNotify = session.server.sendToolListChanged;

    expect(() => session.manager.initialize()).toThrowError(
      expect.objectContaining({ code: "toolset_transition_failed" }),
    );

    expect(enabledSnapshot(session.handles)).toEqual(before);
    expect(session.notifier).not.toHaveBeenCalled();
    expect(session.server.sendToolListChanged).toBe(originalNotify);
  });

  it("emits exactly one list-change notification", async () => {
    const optionalNames = ["create_audio_reactive", "create_glsl_shader", "get_bridge_logs"];
    const session = makeSession({
      names: [...PROTECTED_CORE_TOOL_NAMES, ...optionalNames],
      initiallyEnabled: false,
    });
    session.manager.initialize();
    session.operations.length = 0;
    const originalNotify = session.server.sendToolListChanged;

    await session.manager.select({ tools: optionalNames });

    expect(session.operations).toHaveLength(3);
    expect(session.notifier).toHaveBeenCalledTimes(1);
    expect(session.server.sendToolListChanged).toBe(originalNotify);
  });

  it("rolls back and redacts an unexpected final notifier failure", async () => {
    const optional = "create_audio_reactive";
    const sentinel = {
      path: "/private/SENTINEL_NOTIFY_PATH",
      schema: "SENTINEL_NOTIFY_SCHEMA",
      handler: "SENTINEL_NOTIFY_HANDLER",
      environment: "SENTINEL_NOTIFY_ENV",
    };
    const session = makeSession({
      names: [...PROTECTED_CORE_TOOL_NAMES, optional],
      initiallyEnabled: false,
    });
    session.manager.initialize();
    session.operations.length = 0;
    const before = enabledSnapshot(session.handles);
    const profileBefore = session.manager.getActive().current_profile;
    const originalNotify = session.server.sendToolListChanged;
    session.notifier.mockImplementationOnce(() => {
      throw sentinel;
    });

    const error = await rejectedWith(
      session.manager.select({ tools: [optional] }),
      "toolset_transition_failed",
    );

    expect(enabledSnapshot(session.handles)).toEqual(before);
    expect(session.manager.getActive().current_profile).toBe(profileBefore);
    expect(session.server.sendToolListChanged).toBe(originalNotify);
    expect(JSON.stringify({ message: error.message, details: error.details })).not.toContain(
      "SENTINEL_NOTIFY",
    );
  });

  it("serializes synchronous transitions in call-arrival order", async () => {
    const firstName = "create_audio_reactive";
    const secondName = "create_glsl_shader";
    const session = makeSession({
      names: [...PROTECTED_CORE_TOOL_NAMES, firstName, secondName],
      initiallyEnabled: false,
    });
    session.manager.initialize();
    session.operations.length = 0;

    const first = session.manager.select({ tools: [firstName] });
    const second = session.manager.select({ tools: [secondName] });
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(session.operations).toEqual([
      `${firstName}:enable`,
      `${firstName}:disable`,
      `${secondName}:enable`,
    ]);
    expect(firstResult).toMatchObject({
      previous_profile: "core",
      current_profile: "custom",
      added: [firstName],
    });
    expect(secondResult).toMatchObject({
      previous_profile: "custom",
      current_profile: "custom",
      added: [secondName],
      removed: [firstName],
    });
    expect(session.manager.getActive().active_tools).toEqual(
      [...PROTECTED_CORE_TOOL_NAMES, secondName].sort(),
    );
    expect(session.notifier).toHaveBeenCalledTimes(2);
  });

  it("resets exactly to the startup profile", async () => {
    const startupExtras = ["create_audio_reactive", "create_glsl_shader"];
    const replacement = "get_bridge_logs";
    const session = makeSession({
      names: [...PROTECTED_CORE_TOOL_NAMES, ...startupExtras, replacement],
      startupProfile: "build",
    });
    session.manager.initialize();
    const startupNames = session.manager.getActive().active_tools;
    expect(startupNames).toEqual([...PROTECTED_CORE_TOOL_NAMES, ...startupExtras].sort());

    await session.manager.select({ tools: [replacement] });
    const reset = await session.manager.reset();

    expect(reset.current_profile).toBe("build");
    expect(session.manager.getActive().active_tools).toEqual(startupNames);
    expect(enabledNames(session.handles)).toEqual(startupNames);
  });
});

describe("ToolsetError redaction", () => {
  it("allowlists code-specific details and redacts typed and unexpected sentinels", () => {
    const sentinels = {
      token: "SENTINEL_TOKEN_74f830",
      path: "/private/sentinel/credentials.json",
      schema: "SENTINEL_SCHEMA_WITH_COMPLETE_INPUT",
      handler: "SENTINEL_HANDLER_SOURCE_TEXT",
      environment: "SENTINEL_ENV_SECRET_VALUE",
    };
    const typedLogger = { error: vi.fn() };
    const typed = normalizeToolsetError(
      new ToolsetError("unknown_tool", Object.values(sentinels).join(" "), {
        close_matches: ["discover_tools", ...Object.values(sentinels)],
        token: sentinels.token,
        path: sentinels.path,
        schema: sentinels.schema,
        handler: sentinels.handler,
        environment: sentinels.environment,
      } as never),
      typedLogger,
    );
    const typedResult = {
      ok: false,
      code: typed.code,
      message: typed.message,
      ...serializeToolsetErrorDetails(typed),
    };

    expect(typedResult).toEqual({
      ok: false,
      code: "unknown_tool",
      message: "Toolset selection includes unknown tools.",
      close_matches: ["discover_tools"],
    });
    expect(typedLogger.error).not.toHaveBeenCalled();

    const unexpectedLogger = { error: vi.fn() };
    const unexpected = normalizeToolsetError({ ...sentinels, cause: sentinels }, unexpectedLogger);
    const unexpectedResult = {
      ok: false,
      code: unexpected.code,
      message: unexpected.message,
      ...serializeToolsetErrorDetails(unexpected),
    };

    expect(unexpectedResult).toEqual({
      ok: false,
      code: "toolset_transition_failed",
      message: "Toolset transition rolled back.",
    });
    expect(unexpectedLogger.error).toHaveBeenCalledWith("Toolset operation failed.", {
      code: "toolset_transition_failed",
    });

    const captured = JSON.stringify({
      typedResult,
      unexpectedResult,
      typedLogs: typedLogger.error.mock.calls,
      unexpectedLogs: unexpectedLogger.error.mock.calls,
    });
    for (const sentinel of Object.values(sentinels)) expect(captured).not.toContain(sentinel);
    expect(captured).not.toContain("stack");
    expect(captured).not.toContain("cause");
  });
});
