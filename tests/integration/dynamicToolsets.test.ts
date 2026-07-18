import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { fingerprintTool } from "../../src/tools/toolsets/metadata.js";
import {
  DYNAMIC_MANAGEMENT_TOOL_NAME_SET,
  DYNAMIC_MANAGEMENT_TOOL_NAMES,
  PROTECTED_CORE_TOOL_NAMES,
  RAW_CODE_TOOL_NAMES,
  SAFE_PROFILE_EXCLUDE,
} from "../../src/tools/toolsets/profiles.js";
import baseline from "../fixtures/tool-contract-baseline.json" with { type: "json" };
import approvedMembership from "../fixtures/tool-profile-membership.json" with { type: "json" };
import { closeSessions, connectConfiguredClient, type ResourceClientSession } from "./helpers.js";

type SessionClient = ResourceClientSession["client"];
type ClientCallResult = Awaited<ReturnType<SessionClient["callTool"]>>;

interface ActiveToolsetPayload {
  ok: true;
  startup_profile: string;
  current_profile: string;
  active_tools: string[];
  active_count: number;
  metadata_bytes: number;
}

const DYNAMIC_CORE_ENV = {
  TDMCP_TOOL_PROFILE: "core",
  TDMCP_DYNAMIC_TOOLSETS: "on",
} as const;

// Independent legacy directory contract. Do not replace this with the production
// DIRECTORY_PROFILE_TOOL_NAMES constant: the union test must catch policy drift.
const LEGACY_DIRECTORY_TOOL_NAMES = [
  "get_td_info",
  "search_operators",
  "get_td_classes",
  "get_operator_workflow_guide",
  "find_td_nodes",
  "get_td_node_parameters",
  "get_td_node_flags",
  "get_td_topology",
  "create_td_node",
  "connect_nodes",
  "update_td_node_parameters",
  "validate_operator_chain",
  "list_recipes",
  "apply_recipe",
  "browse_library",
] as const;

const LEGACY_FULL_TOOL_NAMES = Object.keys(baseline.fingerprints).sort();
const EXPECTED_FULL_TOOL_NAMES = sortedUnique([
  ...LEGACY_FULL_TOOL_NAMES,
  ...DYNAMIC_MANAGEMENT_TOOL_NAMES,
]);
const EXPECTED_SAFE_TOOL_NAMES = sortedUnique([
  ...LEGACY_FULL_TOOL_NAMES.filter((name) => !SAFE_PROFILE_EXCLUDE.has(name)),
  ...DYNAMIC_MANAGEMENT_TOOL_NAMES,
]);
const EXPECTED_DIRECTORY_TOOL_NAMES = sortedUnique([
  ...LEGACY_DIRECTORY_TOOL_NAMES,
  ...PROTECTED_CORE_TOOL_NAMES,
]);
const PROTECTED_CORE_TOOL_NAME_SET: ReadonlySet<string> = new Set(PROTECTED_CORE_TOOL_NAMES);
const RAW_CODE_TOOL_NAME_SET: ReadonlySet<string> = new Set(RAW_CODE_TOOL_NAMES);
const OVER_COUNT_TOOL_NAMES = sortedUnique([
  ...approvedMembership.inspect,
  ...approvedMembership.build,
  ...approvedMembership.show,
  ...approvedMembership.library,
])
  .filter(
    (name) =>
      !PROTECTED_CORE_TOOL_NAME_SET.has(name) &&
      !SAFE_PROFILE_EXCLUDE.has(name) &&
      !RAW_CODE_TOOL_NAME_SET.has(name),
  )
  .slice(0, 120);

const sessions: ResourceClientSession[] = [];
let clientSequence = 0;

afterEach(async () => {
  await closeSessions(sessions);
});

function sortedUnique(names: readonly string[]): string[] {
  return [...new Set(names)].sort();
}

function sortedToolNames(tools: readonly Tool[]): string[] {
  return tools.map((tool) => tool.name).sort();
}

function metadataBytes(tools: readonly Tool[]): number {
  return Buffer.byteLength(JSON.stringify({ tools }), "utf8");
}

function textContent(result: ClientCallResult): string {
  return (result as CallToolResult).content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n");
}

function structuredContent(result: ClientCallResult): Record<string, unknown> {
  return (result as CallToolResult).structuredContent as Record<string, unknown>;
}

function expectManagementError(result: ClientCallResult, code: string): void {
  expect(result.isError).toBe(true);
  expect(structuredContent(result)).toMatchObject({ ok: false, code });
}

function isDestructive(tool: Tool): boolean {
  const readOnly = tool.annotations?.readOnlyHint ?? false;
  return readOnly ? false : (tool.annotations?.destructiveHint ?? true);
}

async function waitForNotifications(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function connect(env: NodeJS.ProcessEnv): Promise<ResourceClientSession> {
  clientSequence += 1;
  const session = await connectConfiguredClient(`dynamic-toolsets-${clientSequence}`, env);
  sessions.push(session);
  return session;
}

async function listTools(client: SessionClient): Promise<Tool[]> {
  return (await client.listTools()).tools;
}

async function getActive(client: SessionClient): Promise<ActiveToolsetPayload> {
  const result = await client.callTool({ name: "get_active_toolset", arguments: {} });
  expect(result.isError).not.toBe(true);
  expect(structuredContent(result)).toMatchObject({ ok: true });
  return result.structuredContent as unknown as ActiveToolsetPayload;
}

async function expectActiveMatches(client: SessionClient, tools: readonly Tool[]): Promise<void> {
  const active = await getActive(client);
  expect(active.active_tools).toEqual(sortedToolNames(tools));
  expect(active.active_count).toBe(tools.length);
  expect(active.metadata_bytes).toBe(metadataBytes(tools));
}

async function expectUnchangedList(client: SessionClient, before: readonly Tool[]): Promise<void> {
  expect(await listTools(client)).toEqual(before);
}

describe("integration: dynamic MCP toolsets", () => {
  it("starts with the exact protected core inside its metadata budget and rejects disabled calls", async () => {
    const { client } = await connect(DYNAMIC_CORE_ENV);

    const tools = await listTools(client);
    const bytes = metadataBytes(tools);
    expect(sortedToolNames(tools)).toEqual([...PROTECTED_CORE_TOOL_NAMES].sort());
    expect(tools).toHaveLength(17);
    expect(bytes).toBeLessThanOrEqual(65_536);
    expect(
      tools.every(
        (tool) =>
          tool.outputSchema !== undefined || !DYNAMIC_MANAGEMENT_TOOL_NAME_SET.has(tool.name),
      ),
    ).toBe(true);

    const managementTools = tools.filter((tool) => DYNAMIC_MANAGEMENT_TOOL_NAME_SET.has(tool.name));
    expect(sortedToolNames(managementTools)).toEqual([...DYNAMIC_MANAGEMENT_TOOL_NAMES].sort());
    for (const tool of managementTools) {
      expect(tool.outputSchema?.type).toBe("object");
    }

    const withoutManagement = tools.filter(
      (tool) => !DYNAMIC_MANAGEMENT_TOOL_NAME_SET.has(tool.name),
    );
    expect(bytes).toBeGreaterThan(metadataBytes(withoutManagement));
    await expectActiveMatches(client, tools);

    const disabled = await client.callTool({
      name: "create_audio_reactive",
      arguments: {},
    });
    expect(disabled.isError).toBe(true);
    expect(textContent(disabled)).toContain("Tool create_audio_reactive disabled");
    await expectUnchangedList(client, tools);
  });

  it("emits exactly one native list-change notification and preserves a legacy tool contract", async () => {
    const { client } = await connect(DYNAMIC_CORE_ENV);
    let notifications = 0;
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      notifications += 1;
    });

    const result = await client.callTool({
      name: "select_toolset",
      arguments: { tools: ["create_audio_reactive"], mode: "replace" },
    });
    expect(result.isError).not.toBe(true);
    expect(structuredContent(result)).toMatchObject({
      ok: true,
      current_profile: "custom",
      active_count: 18,
      client_refresh_required: true,
    });
    await waitForNotifications();
    expect(notifications).toBe(1);

    const tools = await listTools(client);
    const selected = tools.find((tool) => tool.name === "create_audio_reactive");
    expect(selected).toBeDefined();
    expect(fingerprintTool(selected)).toBe(baseline.fingerprints.create_audio_reactive);
    await expectActiveMatches(client, tools);
  });

  it("keeps state atomic for unknown and over-count selections", async () => {
    const { client } = await connect(DYNAMIC_CORE_ENV);
    let notifications = 0;
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      notifications += 1;
    });
    const before = await listTools(client);

    const unknown = await client.callTool({
      name: "select_toolset",
      arguments: { tools: ["definitely_not_a_tdmcp_tool"], mode: "replace" },
    });
    expectManagementError(unknown, "unknown_tool");
    await waitForNotifications();
    expect(notifications).toBe(0);
    await expectUnchangedList(client, before);

    expect(OVER_COUNT_TOOL_NAMES).toHaveLength(120);
    expect(OVER_COUNT_TOOL_NAMES.every((name) => !PROTECTED_CORE_TOOL_NAME_SET.has(name))).toBe(
      true,
    );
    expect(OVER_COUNT_TOOL_NAMES.every((name) => !SAFE_PROFILE_EXCLUDE.has(name))).toBe(true);
    const overCount = await client.callTool({
      name: "select_toolset",
      arguments: { tools: OVER_COUNT_TOOL_NAMES, mode: "replace" },
    });
    expectManagementError(overCount, "active_tool_limit_exceeded");
    expect(structuredContent(overCount)).toMatchObject({
      requested_count: 137,
      max_active: 120,
    });
    await waitForNotifications();
    expect(notifications).toBe(0);
    await expectUnchangedList(client, before);
    await expectActiveMatches(client, before);
  });

  it("keeps every ordinary preset within count, byte, and risk budgets", async () => {
    const { client } = await connect(DYNAMIC_CORE_ENV);
    const presets = ["core", "inspect", "build", "show", "library"] as const;

    for (const preset of presets) {
      const selected = await client.callTool({
        name: "select_toolset",
        arguments: { preset },
      });
      expect(selected.isError, preset).not.toBe(true);
      expect(structuredContent(selected), preset).toMatchObject({
        ok: true,
        current_profile: preset,
      });

      const tools = await listTools(client);
      const expectedNames = sortedUnique([
        ...approvedMembership[preset],
        ...DYNAMIC_MANAGEMENT_TOOL_NAMES,
      ]);
      expect(sortedToolNames(tools), preset).toEqual(expectedNames);
      expect(tools.length, preset).toBeLessThanOrEqual(120);
      expect(metadataBytes(tools), preset).toBeLessThanOrEqual(262_144);
      for (const tool of tools) {
        expect(RAW_CODE_TOOL_NAME_SET.has(tool.name), `${preset}: ${tool.name} is raw`).toBe(false);
        expect(isDestructive(tool), `${preset}: ${tool.name} is destructive`).toBe(false);
      }
      await expectActiveMatches(client, tools);
    }
  });

  it("keeps every independently approved static inspect tool read-only", async () => {
    const { client } = await connect({
      TDMCP_TOOL_PROFILE: "inspect",
      TDMCP_DYNAMIC_TOOLSETS: "off",
    });

    const tools = await listTools(client);
    expect(sortedToolNames(tools)).toEqual(approvedMembership.inspect);
    expect(tools.every((tool) => !DYNAMIC_MANAGEMENT_TOOL_NAME_SET.has(tool.name))).toBe(true);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
    }
  });

  it("activates the exact independent legacy-directory and protected-core union", async () => {
    const { client } = await connect(DYNAMIC_CORE_ENV);
    const selected = await client.callTool({
      name: "select_toolset",
      arguments: { preset: "directory" },
    });
    expect(selected.isError).not.toBe(true);

    const tools = await listTools(client);
    expect(sortedToolNames(tools)).toEqual(EXPECTED_DIRECTORY_TOOL_NAMES);
    expect(tools).toHaveLength(22);
    await expectActiveMatches(client, tools);
  });

  it("restores the exact 501-tool full startup surface after a compact transition", async () => {
    const { client } = await connect({
      TDMCP_TOOL_PROFILE: "full",
      TDMCP_DYNAMIC_TOOLSETS: "on",
    });
    let notifications = 0;
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      notifications += 1;
    });

    const startupTools = await listTools(client);
    expect(sortedToolNames(startupTools)).toEqual(EXPECTED_FULL_TOOL_NAMES);
    expect(startupTools).toHaveLength(501);
    await expectActiveMatches(client, startupTools);

    const compact = await client.callTool({
      name: "select_toolset",
      arguments: { preset: "core" },
    });
    expect(compact.isError).not.toBe(true);
    await waitForNotifications();
    expect(notifications).toBe(1);
    expect(sortedToolNames(await listTools(client))).toEqual([...PROTECTED_CORE_TOOL_NAMES].sort());

    const reset = await client.callTool({ name: "reset_toolset", arguments: {} });
    expect(reset.isError).not.toBe(true);
    expect(structuredContent(reset)).toMatchObject({
      ok: true,
      current_profile: "full",
      active_count: 501,
    });
    await waitForNotifications();
    expect(notifications).toBe(2);
    const restoredTools = await listTools(client);
    expect(sortedToolNames(restoredTools)).toEqual(EXPECTED_FULL_TOOL_NAMES);
    await expectActiveMatches(client, restoredTools);
  });

  it("restores the exact 462-tool safe startup surface despite ordinary budgets", async () => {
    const { client } = await connect({
      TDMCP_TOOL_PROFILE: "safe",
      TDMCP_DYNAMIC_TOOLSETS: "on",
    });
    let notifications = 0;
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      notifications += 1;
    });

    const startupTools = await listTools(client);
    expect(sortedToolNames(startupTools)).toEqual(EXPECTED_SAFE_TOOL_NAMES);
    expect(startupTools).toHaveLength(462);
    await expectActiveMatches(client, startupTools);

    const compact = await client.callTool({
      name: "select_toolset",
      arguments: { preset: "core" },
    });
    expect(compact.isError).not.toBe(true);
    await waitForNotifications();
    expect(notifications).toBe(1);

    const reset = await client.callTool({ name: "reset_toolset", arguments: {} });
    expect(reset.isError).not.toBe(true);
    expect(structuredContent(reset)).toMatchObject({
      ok: true,
      current_profile: "safe",
      active_count: 462,
    });
    await waitForNotifications();
    expect(notifications).toBe(2);
    const restoredTools = await listTools(client);
    expect(sortedToolNames(restoredTools)).toEqual(EXPECTED_SAFE_TOOL_NAMES);
    await expectActiveMatches(client, restoredTools);
  });

  it("keeps compact state unchanged for full, safe-budget, and raw-off failures", async () => {
    const { client } = await connect({
      ...DYNAMIC_CORE_ENV,
      TDMCP_RAW_PYTHON: "off",
    });
    let notifications = 0;
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      notifications += 1;
    });
    const before = await listTools(client);

    const full = await client.callTool({
      name: "select_toolset",
      arguments: { preset: "full" },
    });
    expect(full.isError).toBe(true);
    await waitForNotifications();
    expect(notifications).toBe(0);
    await expectUnchangedList(client, before);

    const safe = await client.callTool({
      name: "select_toolset",
      arguments: { preset: "safe" },
    });
    expectManagementError(safe, "active_tool_limit_exceeded");
    await waitForNotifications();
    expect(notifications).toBe(0);
    await expectUnchangedList(client, before);

    const raw = await client.callTool({
      name: "select_toolset",
      arguments: {
        tools: ["execute_python_script"],
        mode: "replace",
        include_risky: true,
      },
    });
    expectManagementError(raw, "raw_python_disabled");
    expect(structuredContent(raw)).toMatchObject({ raw_tools: ["execute_python_script"] });
    await waitForNotifications();
    expect(notifications).toBe(0);
    await expectUnchangedList(client, before);
    await expectActiveMatches(client, before);
  });
});
