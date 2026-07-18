import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";
import { ToolsetError } from "../../src/tools/toolsets/errors.js";
import { TOOL_METADATA } from "../../src/tools/toolsets/toolMetadata.generated.js";
import type {
  ActiveToolsetOutput,
  DiscoverToolsInput,
  SelectToolsetInput,
  ToolsetController,
  ToolsetTransitionOutput,
} from "../../src/tools/toolsets/types.js";
import type { ToolContext } from "../../src/tools/types.js";
import {
  discoverToolsImpl,
  discoverToolsResultSchema,
  registerDiscoverTools,
} from "../../src/tools/util/discoverTools.js";
import {
  activeToolsetOutputSchema,
  getActiveToolsetImpl,
  getActiveToolsetResultSchema,
  registerGetActiveToolset,
} from "../../src/tools/util/getActiveToolset.js";
import {
  registerResetToolset,
  resetToolsetImpl,
  resetToolsetResultSchema,
} from "../../src/tools/util/resetToolset.js";
import {
  registerSelectToolset,
  selectToolsetImpl,
  selectToolsetResultSchema,
  toolsetTransitionOutputSchema,
} from "../../src/tools/util/selectToolset.js";

const MANAGEMENT_NAMES = [
  "discover_tools",
  "select_toolset",
  "get_active_toolset",
  "reset_toolset",
] as const;

const ERROR_PAYLOADS = [
  { ok: false, code: "dynamic_toolsets_disabled" },
  { ok: false, code: "invalid_selection" },
  { ok: false, code: "unknown_tool", close_matches: ["get_td_info"] },
  {
    ok: false,
    code: "risky_tool_requires_explicit_opt_in",
    risky_tools: ["delete_td_node"],
  },
  { ok: false, code: "raw_python_disabled", raw_tools: ["execute_python_script"] },
  {
    ok: false,
    code: "active_tool_limit_exceeded",
    requested_count: 121,
    max_active: 120,
    largest_contributors: [{ name: "get_td_info", bytes: 100 }],
    suggested_presets: ["core"],
  },
  {
    ok: false,
    code: "metadata_budget_exceeded",
    requested_bytes: 300_000,
    metadata_budget_bytes: 262_144,
    largest_contributors: [{ name: "get_td_info", bytes: 100 }],
    suggested_presets: ["core", "directory"],
  },
  { ok: false, code: "protected_core_tool", protected_tools: ["get_td_info"] },
  { ok: false, code: "toolset_transition_failed" },
] as const;

function transition(
  currentProfile: ToolsetTransitionOutput["current_profile"] = "custom",
): ToolsetTransitionOutput {
  return {
    ok: true,
    previous_profile: "full",
    current_profile: currentProfile,
    active_count: 17,
    metadata_bytes: 4096,
    added: ["get_td_info"],
    removed: [],
    warnings: [],
    client_refresh_required: true,
  };
}

function active(): ActiveToolsetOutput {
  return {
    ok: true,
    startup_profile: "full",
    current_profile: "custom",
    active_tools: ["discover_tools", "get_td_info"],
    active_count: 2,
    metadata_bytes: 2048,
    max_active: 120,
    metadata_budget_bytes: 262_144,
    dynamic_toolsets: true,
    protected_core: ["discover_tools", "get_td_info"],
  };
}

function controller(overrides: Partial<ToolsetController> = {}): ToolsetController {
  return {
    discover: (input: DiscoverToolsInput) => ({
      ok: true,
      query: input.query,
      normalized_query: input.query.trim().toLowerCase(),
      candidates: [
        {
          name: "get_td_info",
          summary: "Inspect TouchDesigner connection information.",
          group: "layer3",
          presets: ["core", "inspect"],
          risk: "read_only",
          score: 10,
          reason: "exact name match",
        },
      ],
    }),
    select: async (input: SelectToolsetInput) =>
      transition(input.preset ?? (input.tools ? "custom" : "core")),
    getActive: active,
    reset: async () => transition("full"),
    ...overrides,
  };
}

function logger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function context(toolsets: ToolsetController | undefined, testLogger = logger()): ToolContext {
  return { toolsets, logger: testLogger } as unknown as ToolContext;
}

function structured(result: CallToolResult): Record<string, unknown> {
  return result.structuredContent as Record<string, unknown>;
}

async function withRegisteredTools<T>(
  toolsets: ToolsetController,
  inspect: (client: Client) => Promise<T>,
): Promise<T> {
  const server = new McpServer({ name: "management-test", version: "0.0.0" });
  const ctx = context(toolsets);
  registerDiscoverTools(server, ctx);
  registerSelectToolset(server, ctx);
  registerGetActiveToolset(server, ctx);
  registerResetToolset(server, ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "management-test-client", version: "0.0.0" });
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return await inspect(client);
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
}

describe("dynamic toolset management MCP tools", () => {
  it("ships metadata for the 507 static tools plus four management tools", () => {
    expect(Object.keys(TOOL_METADATA)).toHaveLength(511);
    for (const name of MANAGEMENT_NAMES) expect(TOOL_METADATA).toHaveProperty(name);
  });

  it("advertises four root-object outputs, safe annotations, and actionable descriptions", async () => {
    await withRegisteredTools(controller(), async (client) => {
      const tools = (await client.listTools()).tools;
      expect(tools.map((tool) => tool.name).sort()).toEqual([...MANAGEMENT_NAMES].sort());

      for (const tool of tools) {
        expect(tool.description?.trim()).toBeTruthy();
        expect(tool.outputSchema?.type, `${tool.name} output must be a root object`).toBe("object");
        expect(tool.outputSchema?.properties).toHaveProperty("ok");
        expect(tool.annotations?.destructiveHint).toBe(false);
        expect(tool.annotations?.openWorldHint).toBe(false);
        expect(tool.annotations?.readOnlyHint).toBe(
          tool.name === "discover_tools" || tool.name === "get_active_toolset",
        );
      }

      const descriptions = tools.map((tool) => tool.description).join(" ");
      expect(descriptions).toMatch(/exactly one/i);
      expect(descriptions).toMatch(/explicit risky opt-in/i);
      expect(descriptions).toMatch(/refresh.*(?:may|uncertain)/i);
      expect(descriptions).toMatch(/static.*restart/i);

      const select = tools.find((tool) => tool.name === "select_toolset");
      const selectInput = JSON.stringify(select?.inputSchema);
      expect(selectInput).not.toContain('"full"');
      for (const preset of ["core", "inspect", "build", "show", "library", "safe", "directory"]) {
        expect(selectInput).toContain(`"${preset}"`);
      }
    });
  });

  it("returns strict structured success payloads for every operation", async () => {
    const ctx = context(controller());
    const discovered = await discoverToolsImpl(ctx, {
      query: " TD Info ",
      risk: "safe_mutation",
      limit: 10,
    });
    const selected = await selectToolsetImpl(ctx, {
      tools: ["get_td_info"],
      mode: "add",
      include_risky: false,
    });
    const inspected = await getActiveToolsetImpl(ctx, {});
    const reset = await resetToolsetImpl(ctx, {});

    expect(discoverToolsResultSchema.parse(structured(discovered))).toMatchObject({ ok: true });
    expect(selectToolsetResultSchema.parse(structured(selected))).toMatchObject({
      ok: true,
      current_profile: "custom",
    });
    expect(getActiveToolsetResultSchema.parse(structured(inspected))).toMatchObject({
      ok: true,
      current_profile: "custom",
    });
    expect(resetToolsetResultSchema.parse(structured(reset))).toMatchObject({
      ok: true,
      current_profile: "full",
    });
    expect(activeToolsetOutputSchema.parse(active())).toEqual(active());
    expect(toolsetTransitionOutputSchema.parse(transition())).toEqual(transition());
  });

  it("parses every success after an in-memory MCP round trip", async () => {
    await withRegisteredTools(controller(), async (client) => {
      const results = await Promise.all([
        client.callTool({ name: "discover_tools", arguments: { query: "TD info" } }),
        client.callTool({ name: "select_toolset", arguments: { tools: ["get_td_info"] } }),
        client.callTool({ name: "get_active_toolset", arguments: {} }),
        client.callTool({ name: "reset_toolset", arguments: {} }),
      ]);
      const schemas = [
        discoverToolsResultSchema,
        selectToolsetResultSchema,
        getActiveToolsetResultSchema,
        resetToolsetResultSchema,
      ];
      results.forEach((result, index) => {
        expect(schemas[index]?.parse(result.structuredContent)).toMatchObject({ ok: true });
      });
    });
  });

  it("parses every stable error through each strict result schema", () => {
    const schemas = [
      discoverToolsResultSchema,
      selectToolsetResultSchema,
      getActiveToolsetResultSchema,
      resetToolsetResultSchema,
    ];
    for (const schema of schemas) {
      for (const payload of ERROR_PAYLOADS) {
        expect(schema.parse(payload)).toEqual(payload);
        expect(schema.safeParse({ ...payload, leaked: "private" }).success).toBe(false);
      }
    }
  });

  it("parses every stable error after in-memory MCP round trips", async () => {
    for (const payload of ERROR_PAYLOADS) {
      const { code, ...details } = payload;
      const error = new ToolsetError(code, "private sentinel", details as never);
      const fail = () => {
        throw error;
      };
      const failing = controller({
        discover: fail,
        select: async () => fail(),
        getActive: fail,
        reset: async () => fail(),
      });
      await withRegisteredTools(failing, async (client) => {
        const results = await Promise.all([
          client.callTool({ name: "discover_tools", arguments: { query: "info" } }),
          client.callTool({ name: "select_toolset", arguments: { preset: "core" } }),
          client.callTool({ name: "get_active_toolset", arguments: {} }),
          client.callTool({ name: "reset_toolset", arguments: {} }),
        ]);
        const schemas = [
          discoverToolsResultSchema,
          selectToolsetResultSchema,
          getActiveToolsetResultSchema,
          resetToolsetResultSchema,
        ];
        results.forEach((result, index) => {
          expect(schemas[index]?.parse(result.structuredContent)).toEqual(payload);
          expect(JSON.stringify(result)).not.toContain("private sentinel");
        });
      });
    }
  });

  it("returns a stable disabled error without logging when the controller is absent", async () => {
    const testLogger = logger();
    const ctx = context(undefined, testLogger);
    const results = await Promise.all([
      discoverToolsImpl(ctx, { query: "info", risk: "safe_mutation", limit: 10 }),
      selectToolsetImpl(ctx, { preset: "core", mode: "replace", include_risky: false }),
      getActiveToolsetImpl(ctx, {}),
      resetToolsetImpl(ctx, {}),
    ]);

    for (const result of results) {
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({
        ok: false,
        code: "dynamic_toolsets_disabled",
      });
    }
    expect(testLogger.error).not.toHaveBeenCalled();
  });

  it("serializes known selection errors and does not treat them as unexpected", async () => {
    const testLogger = logger();
    const failing = controller({
      select: async () => {
        throw new ToolsetError("unknown_tool", "private missing path", {
          close_matches: ["get_td_info"],
        });
      },
    });

    const result = await selectToolsetImpl(context(failing, testLogger), {
      tools: ["missing"],
      mode: "replace",
      include_risky: false,
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      code: "unknown_tool",
      close_matches: ["get_td_info"],
    });
    expect(testLogger.error).not.toHaveBeenCalled();
  });

  it("awaits async mutations and normalizes unexpected failures without logging secrets", async () => {
    const testLogger = logger();
    const sentinel = new Error("sentinel secret /private/path stack");
    const failing = controller({
      discover: () => {
        throw sentinel;
      },
      select: async () => Promise.reject(sentinel),
      getActive: () => {
        throw sentinel;
      },
      reset: async () => Promise.reject(sentinel),
    });
    const ctx = context(failing, testLogger);

    const discovered = await discoverToolsImpl(ctx, {
      query: "info",
      risk: "safe_mutation",
      limit: 10,
    });
    const selected = await selectToolsetImpl(ctx, {
      preset: "core",
      mode: "replace",
      include_risky: false,
    });
    const inspected = await getActiveToolsetImpl(ctx, {});
    const reset = await resetToolsetImpl(ctx, {});

    for (const result of [discovered, selected, inspected, reset]) {
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({
        ok: false,
        code: "toolset_transition_failed",
      });
      expect(JSON.stringify(result)).not.toContain("sentinel");
      expect(JSON.stringify(result)).not.toContain("/private/path");
    }
    expect(testLogger.error).toHaveBeenCalledTimes(4);
    for (const call of testLogger.error.mock.calls) {
      expect(call).toEqual(["Toolset operation failed.", { code: "toolset_transition_failed" }]);
    }
    expect(JSON.stringify(testLogger.error.mock.calls)).not.toContain("sentinel");
    expect(JSON.stringify(testLogger.error.mock.calls)).not.toContain("/private/path");
  });
});
