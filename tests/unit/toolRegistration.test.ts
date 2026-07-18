import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { MacroRecorder } from "../../src/automation/macroSchema.js";
import { registerToolGroups } from "../../src/tools/registration.js";
import type { ToolRegistrarGroup } from "../../src/tools/toolsets/types.js";
import type { ToolContext, ToolRegistrar } from "../../src/tools/types.js";

function fakeHandle(): RegisteredTool {
  return {
    handler: vi.fn(),
    enabled: true,
    enable: vi.fn(),
    disable: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  } as unknown as RegisteredTool;
}

function fakeServer() {
  const handle = fakeHandle();
  const registerTool = vi.fn((_name: string, ..._rest: unknown[]) => handle);
  return {
    handle,
    registerTool,
    server: { registerTool } as unknown as McpServer,
  };
}

const ctx = {} as ToolContext;

describe("registerToolGroups", () => {
  it("captures named groups, forwards configs and handles, wraps handlers, and restores registerTool", () => {
    const { handle, registerTool: realRegister, server } = fakeServer();
    const originalRegisterAfterCompletion = server.registerTool;
    const originalHandler = vi.fn();
    const secondHandler = vi.fn();
    const readConfig = {
      title: "Read tool",
      description: "Reads a value",
      inputSchema: { value: z.string() },
      annotations: { readOnlyHint: true, destructiveHint: false },
    };
    const writeConfig = {
      title: "Write tool",
      description: "Writes a value",
      inputSchema: { value: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false },
    };
    let forwardedHandle: RegisteredTool | undefined;
    const readRegistrar: ToolRegistrar = (target) => {
      forwardedHandle = target.registerTool("read_tool", readConfig, originalHandler);
    };
    const writeRegistrar: ToolRegistrar = (target) => {
      target.registerTool("write_tool", writeConfig, secondHandler);
    };
    const groups: readonly ToolRegistrarGroup[] = [
      { group: "layer3", registrars: [readRegistrar] },
      { group: "layer1", registrars: [writeRegistrar] },
    ];
    const recorder = new MacroRecorder();
    const captured: Parameters<
      NonNullable<Parameters<typeof registerToolGroups>[2]["onRegistered"]>
    >[0][] = [];

    registerToolGroups(server, ctx, {
      groups,
      dynamic: true,
      macroRecorder: recorder,
      onRegistered: (entry) => captured.push(entry),
    });

    expect(captured.map((entry) => entry.name)).toEqual(["read_tool", "write_tool"]);
    expect(captured.map((entry) => entry.group)).toEqual(["layer3", "layer1"]);
    expect(captured[0]).toMatchObject({
      title: "Read tool",
      description: "Reads a value",
      annotations: readConfig.annotations,
      handle,
    });
    expect(realRegister).toHaveBeenCalledTimes(2);
    expect(realRegister.mock.calls[0]?.[1]).toBe(readConfig);
    expect(forwardedHandle).toBe(handle);
    const wrappedHandler = realRegister.mock.calls[0]?.at(-1);
    expect(wrappedHandler).not.toBe(originalHandler);
    expect(server.registerTool).toBe(originalRegisterAfterCompletion);
  });

  it("restores registerTool when a registrar throws", () => {
    const { server } = fakeServer();
    const originalRegisterAfterCompletion = server.registerTool;
    const throwingRegistrar: ToolRegistrar = () => {
      throw new Error("registrar failed");
    };

    expect(() =>
      registerToolGroups(server, ctx, {
        groups: [{ group: "util", registrars: [throwingRegistrar] }],
        dynamic: false,
      }),
    ).toThrow("registrar failed");
    expect(server.registerTool).toBe(originalRegisterAfterCompletion);
  });

  it.each([
    ["safe", "delete_td_node", "find_td_nodes"],
    ["directory", "create_audio_reactive", "find_td_nodes"],
    ["core", "create_audio_reactive", "get_td_info"],
    ["full", "discover_tools", "find_td_nodes"],
  ] as const)("filters %s exclusions before they reach the real registrar", (toolProfile, excluded, included) => {
    const { registerTool: realRegister, server } = fakeServer();
    const registrar: ToolRegistrar = (target) => {
      target.registerTool(excluded, {}, vi.fn());
      target.registerTool(included, {}, vi.fn());
    };

    registerToolGroups(server, { toolProfile } as ToolContext, {
      groups: [{ group: "util", registrars: [registrar] }],
      dynamic: false,
    });

    expect(realRegister.mock.calls.map((call) => call[0])).toEqual([included]);
  });

  it("captures every environment-eligible tool in dynamic mode", () => {
    const { registerTool: realRegister, server } = fakeServer();
    const registrar: ToolRegistrar = (target) => {
      target.registerTool("create_audio_reactive", {}, vi.fn());
      target.registerTool("delete_td_node", {}, vi.fn());
      target.registerTool("discover_tools", {}, vi.fn());
    };

    registerToolGroups(server, { toolProfile: "core" } as ToolContext, {
      groups: [{ group: "layer3", registrars: [registrar] }],
      dynamic: true,
    });

    expect(realRegister.mock.calls.map((call) => call[0])).toEqual([
      "create_audio_reactive",
      "delete_td_node",
      "discover_tools",
    ]);
  });
});
