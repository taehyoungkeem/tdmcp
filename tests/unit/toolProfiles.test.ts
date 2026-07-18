import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTdmcpServer } from "../../src/server/tdmcpServer.js";
import { serializedToolListBytes } from "../../src/tools/toolsets/metadata.js";
import {
  BUILD_EXTRA_TOOL_NAMES,
  BUILD_PROFILE_TOOL_NAMES,
  CORE_EXISTING_TOOL_NAMES,
  CORE_PROFILE_TOOL_NAMES,
  DIRECTORY_PROFILE_TOOL_NAMES,
  DYNAMIC_MANAGEMENT_TOOL_NAMES,
  INSPECT_EXTRA_TOOL_NAMES,
  INSPECT_PROFILE_TOOL_NAMES,
  LIBRARY_EXTRA_TOOL_NAMES,
  LIBRARY_PROFILE_TOOL_NAMES,
  PROTECTED_CORE_TOOL_NAMES,
  RAW_CODE_TOOL_NAMES,
  SAFE_PROFILE_EXCLUDE,
  SHOW_EXTRA_TOOL_NAMES,
  SHOW_PROFILE_TOOL_NAMES,
} from "../../src/tools/toolsets/profiles.js";
import { TOOL_METADATA } from "../../src/tools/toolsets/toolMetadata.generated.js";
import { loadConfig } from "../../src/utils/config.js";
import { silentLogger } from "../../src/utils/logger.js";
import approvedMembership from "../fixtures/tool-profile-membership.json" with { type: "json" };

const ORDINARY_PRESETS = ["core", "inspect", "build", "show", "library"] as const;
type OrdinaryPreset = (typeof ORDINARY_PRESETS)[number];

const STATIC_MEMBERSHIPS: Record<OrdinaryPreset, readonly string[]> = {
  core: CORE_PROFILE_TOOL_NAMES,
  inspect: INSPECT_PROFILE_TOOL_NAMES,
  build: BUILD_PROFILE_TOOL_NAMES,
  show: SHOW_PROFILE_TOOL_NAMES,
  library: LIBRARY_PROFILE_TOOL_NAMES,
};

const APPROVED_MEMBERSHIPS: Record<OrdinaryPreset, readonly string[]> = approvedMembership;
const RAW_CODE_NAME_SET: ReadonlySet<string> = new Set(RAW_CODE_TOOL_NAMES);

function asciiSort(names: readonly string[]): string[] {
  return [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

let client: Client | undefined;
let server: McpServer | undefined;
let assembledTools = new Map<string, Tool>();

beforeAll(async () => {
  server = createTdmcpServer(
    loadConfig({
      TDMCP_TOOL_PROFILE: "full",
      TDMCP_DYNAMIC_TOOLSETS: "off",
      TDMCP_RAW_PYTHON: "on",
      TDMCP_EVENTS: "off",
      TDMCP_RAG_ENABLED: "0",
      TDMCP_PROJECT_RAG_ENABLED: "0",
      TDMCP_RAG_APPLY_CARD: "off",
      TDMCP_LOG_LEVEL: "silent",
    }),
    { logger: silentLogger },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "tdmcp-tool-profiles-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const result = await client.listTools();
  assembledTools = new Map(result.tools.map((tool) => [tool.name, tool]));
});

afterAll(async () => {
  await Promise.allSettled([client?.close(), server?.close()]);
});

describe("curated tool profiles", () => {
  it("locks the 13 existing core names and exact protected 17-name order", () => {
    expect(CORE_EXISTING_TOOL_NAMES).toHaveLength(13);
    expect(PROTECTED_CORE_TOOL_NAMES).toHaveLength(17);
    expect(DIRECTORY_PROFILE_TOOL_NAMES).toHaveLength(16);
    expect(new Set(PROTECTED_CORE_TOOL_NAMES).size).toBe(17);
    expect(PROTECTED_CORE_TOOL_NAMES).toEqual([
      "get_td_info",
      "discover_tools",
      "select_toolset",
      "get_active_toolset",
      "reset_toolset",
      "search_operators",
      "get_td_classes",
      "get_operator_workflow_guide",
      "find_td_nodes",
      "get_td_node_parameters",
      "get_td_node_flags",
      "get_td_topology",
      "get_td_node_errors",
      "summarize_td_errors",
      "get_preview",
      "validate_operator_chain",
      "list_recipes",
    ]);
  });

  for (const preset of ORDINARY_PRESETS) {
    it(`${preset} exactly matches the independently reviewed sorted fixture`, () => {
      const actual = STATIC_MEMBERSHIPS[preset];
      expect(actual).toEqual(APPROVED_MEMBERSHIPS[preset]);
      expect(actual).toEqual(asciiSort(actual));
      expect(new Set(actual).size).toBe(actual.length);
    });
  }

  it("keeps every ordinary static and dynamic membership within count and byte budgets", () => {
    expect(BUILD_PROFILE_TOOL_NAMES.length).toBeLessThanOrEqual(116);
    for (const preset of ORDINARY_PRESETS) {
      const staticNames = STATIC_MEMBERSHIPS[preset];
      expect(staticNames.length, `${preset} static count`).toBeLessThanOrEqual(116);
      expect(serializedToolListBytes(staticNames), `${preset} static bytes`).toBeLessThanOrEqual(
        262_144,
      );
      const dynamicNames = new Set([...staticNames, ...DYNAMIC_MANAGEMENT_TOOL_NAMES]);
      expect(dynamicNames.size, `${preset} dynamic count`).toBeLessThanOrEqual(120);
    }
  });

  it("uses only generated tools plus the temporary management-name metadata exception", () => {
    const explicitNames = new Set([
      ...CORE_EXISTING_TOOL_NAMES,
      ...INSPECT_EXTRA_TOOL_NAMES,
      ...BUILD_EXTRA_TOOL_NAMES,
      ...SHOW_EXTRA_TOOL_NAMES,
      ...LIBRARY_EXTRA_TOOL_NAMES,
      ...PROTECTED_CORE_TOOL_NAMES,
    ]);
    const management = new Set<string>(DYNAMIC_MANAGEMENT_TOOL_NAMES);

    for (const name of explicitNames) {
      expect(
        TOOL_METADATA[name] !== undefined || management.has(name),
        `missing generated metadata for ${name}`,
      ).toBe(true);
    }
  });

  it.each([
    "build",
    "show",
    "library",
  ] as const)("%s excludes every legacy destructive and raw-code name", (preset) => {
    const names = STATIC_MEMBERSHIPS[preset];
    expect(names.filter((name) => SAFE_PROFILE_EXCLUDE.has(name))).toEqual([]);
    expect(names.filter((name) => RAW_CODE_NAME_SET.has(name))).toEqual([]);
  });

  it("assembles inspect entirely from read-only annotated tools", () => {
    for (const name of STATIC_MEMBERSHIPS.inspect) {
      const assembled = assembledTools.get(name);
      expect(assembled, `missing assembled inspect tool ${name}`).toBeDefined();
      expect(assembled?.annotations?.readOnlyHint, `${name} readOnlyHint`).toBe(true);
    }
  });

  it("assembles every ordinary preset without raw-code or destructive tools", () => {
    for (const preset of ORDINARY_PRESETS) {
      for (const name of STATIC_MEMBERSHIPS[preset]) {
        const assembled = assembledTools.get(name);
        expect(assembled, `missing assembled ${preset} tool ${name}`).toBeDefined();
        expect(RAW_CODE_NAME_SET.has(name), `${preset}:${name} raw code`).toBe(false);
        expect(assembled?.annotations?.destructiveHint, `${preset}:${name} destructive`).not.toBe(
          true,
        );
      }
    }
  });
});
