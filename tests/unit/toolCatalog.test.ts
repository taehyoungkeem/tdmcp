import { McpServer, type RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeAll, describe, expect, it } from "vitest";
import { buildToolContext } from "../../src/server/context.js";
import { registerAllTools } from "../../src/tools/index.js";
import { normalizeDiscoveryText, ToolCatalog } from "../../src/tools/toolsets/catalog.js";
import type {
  CapturedToolRegistration,
  ToolGroup,
  ToolRisk,
} from "../../src/tools/toolsets/types.js";
import { loadConfig } from "../../src/utils/config.js";
import { silentLogger } from "../../src/utils/logger.js";
import approvedMembership from "../fixtures/tool-profile-membership.json" with { type: "json" };

const ORDINARY_PRESETS = ["core", "inspect", "build", "show", "library"] as const;

function fakeCapture(
  name: string,
  options: {
    group?: ToolGroup;
    title?: string;
    description?: string;
    readOnly?: boolean;
    destructive?: boolean;
    openWorld?: boolean;
  } = {},
): CapturedToolRegistration {
  return {
    name,
    group: options.group ?? "util",
    title: options.title,
    description: options.description,
    annotations: {
      readOnlyHint: options.readOnly ?? false,
      destructiveHint: options.destructive ?? false,
      openWorldHint: options.openWorld ?? false,
    },
    handle: {} as RegisteredTool,
  };
}

let catalog: ToolCatalog;

beforeAll(() => {
  const config = loadConfig({
    TDMCP_TOOL_PROFILE: "full",
    TDMCP_DYNAMIC_TOOLSETS: "on",
    TDMCP_RAW_PYTHON: "on",
    TDMCP_EVENTS: "off",
    TDMCP_RAG_ENABLED: "0",
    TDMCP_PROJECT_RAG_ENABLED: "0",
    TDMCP_RAG_APPLY_CARD: "off",
    TDMCP_LOG_LEVEL: "silent",
  });
  const server = new McpServer({ name: "tdmcp-tool-catalog-test", version: "0.0.0" });
  const ctx = buildToolContext(config, { logger: silentLogger });
  ctx.server = server;
  const captured: CapturedToolRegistration[] = [];
  registerAllTools(server, ctx, {
    dynamic: true,
    onRegistered: (entry) => captured.push(entry),
  });
  expect(captured).toHaveLength(497);
  catalog = new ToolCatalog(captured);
});

describe("normalizeDiscoveryText", () => {
  it("normalizes NFKC, case, underscores, hyphens, punctuation, and whitespace", () => {
    expect(normalizeDiscoveryText("  ＧＥＴ__ＴＤ---Node_ERRORS!!  ")).toBe("get td node errors");
  });
});

describe("ToolCatalog", () => {
  it("uses the exact independently reviewed names for every ordinary preset", () => {
    for (const preset of ORDINARY_PRESETS) {
      expect(catalog.namesForPreset(preset)).toEqual(approvedMembership[preset]);
    }
  });

  it("ranks the approved Korean audio-reactive alias first", () => {
    expect(catalog.discover({ query: "오디오 반응형 비주얼", limit: 5 }).candidates[0]?.name).toBe(
      "create_audio_reactive",
    );
  });

  it("ranks the approved English GLSL query first", () => {
    expect(catalog.discover({ query: "GLSL shader", limit: 5 }).candidates[0]?.name).toBe(
      "create_glsl_shader",
    );
  });

  it("filters raw Python by default and admits it only for risk any", () => {
    expect(
      catalog.discover({ query: "python 실행", limit: 20 }).candidates.map((item) => item.name),
    ).not.toContain("execute_python_script");
    expect(
      catalog
        .discover({ query: "python 실행", risk: "any", limit: 20 })
        .candidates.map((item) => item.name),
    ).toContain("execute_python_script");
  });

  it("gives normalized exact names 1000 and suppresses lower lexical categories", () => {
    const precise = new ToolCatalog([
      fakeCapture("get_td_node_errors", {
        title: "Node error inspector",
        description: "Node error summary. Additional details.",
        readOnly: true,
      }),
    ]);

    const result = precise.discover({ query: "ＧＥＴ__ＴＤ-Node_ERRORS" });
    expect(result.normalized_query).toBe("get td node errors");
    expect(result.candidates[0]).toMatchObject({ name: "get_td_node_errors", score: 1000 });
    expect(result.candidates[0]?.summary).toBe("Node error summary.");
  });

  it("rounds query-token coverage and contributes each lexical category once", () => {
    const precise = new ToolCatalog([
      fakeCapture("get_td_node_errors", {
        title: "Node error inspector",
        description: "Node error summary.",
        readOnly: true,
      }),
    ]);

    expect(precise.discover({ query: "node absent missing" }).candidates[0]?.score).toBe(300);
  });

  it("combines alias and tag coverage under one 350-point ceiling", () => {
    const precise = new ToolCatalog([fakeCapture("create_audio_reactive")]);

    expect(precise.discover({ query: "audio build absent" }).candidates[0]?.score).toBe(433);
  });

  it("uses name-token prefixes and adds preset affinity after lexical scoring", () => {
    const precise = new ToolCatalog([
      fakeCapture("create_audio_glsl_uniforms"),
      fakeCapture("create_audio_reactive"),
    ]);

    const prefixResult = precise.discover({ query: "create audio react", risk: "any" });
    expect(prefixResult.candidates[0]).toMatchObject({
      name: "create_audio_reactive",
      score: 833,
    });

    const exactAlias = precise.discover({ query: "AUDIO REACTIVE VISUAL" });
    const exactAliasWithPreset = precise.discover({
      query: "AUDIO REACTIVE VISUAL",
      preset: "build",
    });
    expect(exactAlias.candidates[0]?.score).toBe(1000);
    expect(exactAliasWithPreset.candidates[0]?.score).toBe(1025);
  });

  it("orders equal scores by ascending ASCII tool name", () => {
    const tied = new ToolCatalog([
      fakeCapture("get_td_node_flags", { readOnly: true }),
      fakeCapture("get_td_node_errors", { readOnly: true }),
    ]);

    expect(tied.discover({ query: "get td node" }).candidates.map((item) => item.name)).toEqual([
      "get_td_node_errors",
      "get_td_node_flags",
    ]);
  });

  it("classifies risk in raw, destructive, read-only, safe-mutation priority order", () => {
    const cases: ReadonlyArray<[string, ToolRisk]> = [
      ["execute_python_script", "raw_code"],
      ["delete_td_node", "destructive"],
      ["find_td_nodes", "read_only"],
      ["create_td_node", "safe_mutation"],
    ];

    for (const [name, risk] of cases) {
      expect(catalog.discover({ query: name, risk: "any" }).candidates[0]).toMatchObject({
        name,
        risk,
      });
    }
  });

  it("allows only read-only entries under the read-only filter", () => {
    const result = catalog.discover({ query: "create_td_node", risk: "read_only", limit: 20 });
    expect(result.candidates.map((item) => item.name)).not.toContain("create_td_node");
    expect(result.candidates.every((item) => item.risk === "read_only")).toBe(true);
  });

  it("clamps discovery limits to 1 and 20", () => {
    expect(catalog.discover({ query: "create", risk: "any", limit: 0 }).candidates).toHaveLength(1);
    expect(catalog.discover({ query: "create", risk: "any", limit: 99 }).candidates).toHaveLength(
      20,
    );
  });

  it("rejects a query that is empty after normalization", () => {
    expect(() => catalog.discover({ query: " ＿---!!! " })).toThrow(/non-empty/i);
  });

  it("suggests the closest normalized prefix with a local five-result ceiling", () => {
    const suggestions = catalog.suggest("create_audio_reactiv", 20);
    expect(suggestions[0]).toBe("create_audio_reactive");
    expect(suggestions).toHaveLength(5);
  });
});
