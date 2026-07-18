import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { createTdmcpServer } from "../../src/server/tdmcpServer.js";
import { startTransport, type TransportHandle } from "../../src/server/transportFactory.js";
import { PROTECTED_CORE_TOOL_NAMES } from "../../src/tools/toolsets/profiles.js";
import { loadConfig } from "../../src/utils/config.js";
import { silentLogger } from "../../src/utils/logger.js";

// Keep this distinct from every fixed port in httpTransport.test.ts so the
// suites remain parallel-safe under coverage workers.
const PORT = 39422;
const URL = new globalThis.URL(`http://127.0.0.1:${PORT}/mcp`);

type ClientCallResult = Awaited<ReturnType<Client["callTool"]>>;

function sortedToolNames(tools: readonly Tool[]): string[] {
  return tools.map((tool) => tool.name).sort();
}

function structuredContent(result: ClientCallResult): Record<string, unknown> {
  return (result as CallToolResult).structuredContent as Record<string, unknown>;
}

async function waitForNotifications(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("integration: dynamic toolsets over Streamable HTTP", () => {
  it("isolates active tools and list-change notifications by HTTP session", async () => {
    let handle: TransportHandle | undefined;
    let clientA: Client | undefined;
    let clientB: Client | undefined;
    let transportA: StreamableHTTPClientTransport | undefined;
    let transportB: StreamableHTTPClientTransport | undefined;

    try {
      const config = loadConfig({
        TDMCP_TRANSPORT: "http",
        TDMCP_HTTP_PORT: String(PORT),
        TDMCP_DYNAMIC_TOOLSETS: "on",
        TDMCP_TOOL_PROFILE: "core",
        TDMCP_EVENTS: "off",
      });
      handle = await startTransport(
        () => createTdmcpServer(config, { logger: silentLogger }),
        config,
        silentLogger,
      );

      clientA = new Client({ name: "tdmcp-http-toolsets-a", version: "0.0.0" });
      clientB = new Client({ name: "tdmcp-http-toolsets-b", version: "0.0.0" });
      transportA = new StreamableHTTPClientTransport(URL);
      transportB = new StreamableHTTPClientTransport(URL);

      await clientA.connect(transportA);
      await clientB.connect(transportB);

      expect({
        aNonempty: typeof transportA.sessionId === "string" && transportA.sessionId.length > 0,
        bNonempty: typeof transportB.sessionId === "string" && transportB.sessionId.length > 0,
        distinct: transportA.sessionId !== transportB.sessionId,
      }).toEqual({ aNonempty: true, bNonempty: true, distinct: true });

      const expectedCore = [...PROTECTED_CORE_TOOL_NAMES].sort();
      const initialA = await clientA.listTools();
      const initialB = await clientB.listTools();
      expect(initialA.tools).toHaveLength(17);
      expect(initialB.tools).toHaveLength(17);
      expect(sortedToolNames(initialA.tools)).toEqual(expectedCore);
      expect(sortedToolNames(initialB.tools)).toEqual(expectedCore);

      let notificationsA = 0;
      let notificationsB = 0;
      clientA.setNotificationHandler(ToolListChangedNotificationSchema, () => {
        notificationsA += 1;
      });
      clientB.setNotificationHandler(ToolListChangedNotificationSchema, () => {
        notificationsB += 1;
      });

      const selectedA = await clientA.callTool({
        name: "select_toolset",
        arguments: { preset: "build" },
      });
      expect(selectedA.isError).not.toBe(true);
      expect(structuredContent(selectedA)).toMatchObject({
        ok: true,
        current_profile: "build",
        active_count: 91,
      });
      await waitForNotifications();
      expect({ notificationsA, notificationsB }).toEqual({ notificationsA: 1, notificationsB: 0 });

      const selectedB = await clientB.callTool({
        name: "select_toolset",
        arguments: { preset: "show" },
      });
      expect(selectedB.isError).not.toBe(true);
      expect(structuredContent(selectedB)).toMatchObject({
        ok: true,
        current_profile: "show",
        active_count: 64,
      });
      await waitForNotifications();
      expect({ notificationsA, notificationsB }).toEqual({ notificationsA: 1, notificationsB: 1 });

      const buildList = await clientA.listTools();
      const showListBeforeReset = await clientB.listTools();
      const buildNames = sortedToolNames(buildList.tools);
      const showNames = sortedToolNames(showListBeforeReset.tools);
      expect(buildList.tools).toHaveLength(91);
      expect(showListBeforeReset.tools).toHaveLength(64);
      expect(buildNames).toContain("create_audio_reactive");
      expect(buildNames).not.toContain("create_setlist_runner");
      expect(showNames).toContain("create_setlist_runner");
      expect(showNames).not.toContain("create_audio_reactive");
      const showListBytesBeforeReset = Buffer.from(JSON.stringify(showListBeforeReset), "utf8");

      const resetA = await clientA.callTool({ name: "reset_toolset", arguments: {} });
      expect(resetA.isError).not.toBe(true);
      expect(structuredContent(resetA)).toMatchObject({
        ok: true,
        current_profile: "core",
        active_count: 17,
      });
      await waitForNotifications();
      expect({ notificationsA, notificationsB }).toEqual({ notificationsA: 2, notificationsB: 1 });

      const resetListA = await clientA.listTools();
      expect(resetListA.tools).toHaveLength(17);
      expect(sortedToolNames(resetListA.tools)).toEqual(expectedCore);

      const showListAfterReset = await clientB.listTools();
      expect(Buffer.from(JSON.stringify(showListAfterReset), "utf8")).toEqual(
        showListBytesBeforeReset,
      );

      const activeA = await clientA.callTool({ name: "get_active_toolset", arguments: {} });
      const activeB = await clientB.callTool({ name: "get_active_toolset", arguments: {} });
      expect(activeA.isError).not.toBe(true);
      expect(activeB.isError).not.toBe(true);
      expect(structuredContent(activeA)).toMatchObject({
        ok: true,
        current_profile: "core",
        active_count: 17,
      });
      expect(structuredContent(activeB)).toMatchObject({
        ok: true,
        current_profile: "show",
        active_count: 64,
      });
      expect({ notificationsA, notificationsB }).toEqual({ notificationsA: 2, notificationsB: 1 });
    } finally {
      await Promise.allSettled(
        [clientA, clientB].map((client) => (client ? client.close() : Promise.resolve())),
      );
      await handle?.close();
    }
  });
});
