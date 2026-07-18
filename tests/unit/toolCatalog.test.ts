import { McpServer, type RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeAll, describe, expect, it } from "vitest";
import { buildToolContext } from "../../src/server/context.js";
import { registerAllTools } from "../../src/tools/index.js";
import { normalizeDiscoveryText, ToolCatalog } from "../../src/tools/toolsets/catalog.js";
import { TOOL_DISCOVERY_OVERRIDES } from "../../src/tools/toolsets/overrides.js";
import { DYNAMIC_MANAGEMENT_TOOL_NAMES } from "../../src/tools/toolsets/profiles.js";
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

function fakeCaptureWithAnnotations(
  name: string,
  annotations: CapturedToolRegistration["annotations"],
): CapturedToolRegistration {
  return { ...fakeCapture(name), annotations };
}

let catalog: ToolCatalog;
let legacyCaptured: CapturedToolRegistration[];
let dynamicCaptured: CapturedToolRegistration[];

function captureRegisteredTools(dynamic: boolean): CapturedToolRegistration[] {
  const config = loadConfig({
    TDMCP_TOOL_PROFILE: "full",
    TDMCP_DYNAMIC_TOOLSETS: dynamic ? "on" : "off",
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
    dynamic,
    onRegistered: (entry) => captured.push(entry),
  });
  return captured;
}

beforeAll(() => {
  legacyCaptured = captureRegisteredTools(false);
  dynamicCaptured = captureRegisteredTools(true);
  catalog = new ToolCatalog(dynamicCaptured);
});

describe("normalizeDiscoveryText", () => {
  it("normalizes NFKC, case, underscores, hyphens, punctuation, and whitespace", () => {
    expect(normalizeDiscoveryText("  ＧＥＴ__ＴＤ---Node_ERRORS!!  ")).toBe("get td node errors");
  });
});

describe("ToolCatalog", () => {
  it("preserves the immutable 497 legacy surface and exact 501 dynamic extension", () => {
    const legacyNames = new Set(legacyCaptured.map((entry) => entry.name));
    const dynamicNames = new Set(dynamicCaptured.map((entry) => entry.name));
    expect(legacyNames.size).toBe(497);
    expect(dynamicNames.size).toBe(501);
    for (const name of DYNAMIC_MANAGEMENT_TOOL_NAMES) expect(legacyNames).not.toContain(name);
    expect([...dynamicNames].filter((name) => !legacyNames.has(name)).sort()).toEqual(
      [...DYNAMIC_MANAGEMENT_TOOL_NAMES].sort(),
    );
  });

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

    const score = precise.discover({ query: "node absent missing" }).candidates[0]?.score;
    expect(score).toBe(300);
    expect(precise.discover({ query: "node node absent missing" }).candidates[0]?.score).toBe(
      score,
    );
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
      score: 717,
    });

    const exactAlias = precise.discover({ query: "AUDIO REACTIVE VISUAL" });
    const exactAliasWithPreset = precise.discover({
      query: "AUDIO REACTIVE VISUAL",
      preset: "build",
    });
    expect(exactAlias.candidates[0]?.score).toBe(1000);
    expect(exactAliasWithPreset.candidates[0]?.score).toBe(1025);
  });

  it("allows prefixes only for tool-name tokens", () => {
    const titleAndSummary = new ToolCatalog([
      fakeCapture("get_td_node_errors", {
        title: "Elephant observer",
        description: "Elephant report.",
        readOnly: true,
      }),
    ]);
    expect(titleAndSummary.discover({ query: "ele" }).candidates).toEqual([]);

    const namePrefix = new ToolCatalog([fakeCapture("get_td_node_errors", { readOnly: true })]);
    expect(namePrefix.discover({ query: "erro" }).candidates[0]).toMatchObject({
      name: "get_td_node_errors",
      score: 600,
    });
  });

  it("applies conservative MCP defaults when annotations are absent", () => {
    const absent = new ToolCatalog([fakeCaptureWithAnnotations("get_td_node_errors", undefined)]);

    expect(absent.get("get_td_node_errors")).toMatchObject({
      readOnly: false,
      destructive: true,
      openWorld: true,
    });
    expect(absent.discover({ query: "get_td_node_errors" }).candidates).toEqual([]);
    expect(
      absent.discover({ query: "get_td_node_errors", risk: "any" }).candidates[0],
    ).toMatchObject({ name: "get_td_node_errors", risk: "destructive" });
  });

  it("treats read-only and additive partial annotations according to MCP defaults", () => {
    const partial = new ToolCatalog([
      fakeCaptureWithAnnotations("get_td_node_errors", { readOnlyHint: true }),
      fakeCaptureWithAnnotations("create_td_node", { destructiveHint: false }),
    ]);

    expect(partial.get("get_td_node_errors")).toMatchObject({
      readOnly: true,
      destructive: false,
      openWorld: true,
    });
    expect(partial.discover({ query: "get_td_node_errors" }).candidates[0]).toMatchObject({
      name: "get_td_node_errors",
      risk: "read_only",
    });
    expect(partial.get("create_td_node")).toMatchObject({
      readOnly: false,
      destructive: false,
      openWorld: true,
    });
    expect(partial.discover({ query: "create_td_node" }).candidates[0]).toMatchObject({
      name: "create_td_node",
      risk: "safe_mutation",
    });
  });

  it.each([
    "constructor",
    "toString",
    "__proto__",
  ])("rejects inherited metadata key %s with a stable missing-metadata error", (name) => {
    expect(() => new ToolCatalog([fakeCapture(name)])).toThrow(
      `Missing generated metadata for ${name}`,
    );
  });

  it("ignores inherited discovery overrides for real generated tool names", () => {
    const originalPrototype = Object.getPrototypeOf(TOOL_DISCOVERY_OVERRIDES);
    Object.setPrototypeOf(TOOL_DISCOVERY_OVERRIDES, {
      get_td_node_errors: { aliases: ["prototype elephant"], tags: ["prototype"] },
    });
    try {
      const inherited = new ToolCatalog([fakeCapture("get_td_node_errors", { readOnly: true })]);
      expect(inherited.discover({ query: "prototype elephant" }).candidates).toEqual([]);
    } finally {
      Object.setPrototypeOf(TOOL_DISCOVERY_OVERRIDES, originalPrototype);
    }
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
