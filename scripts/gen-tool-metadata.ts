import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { createTdmcpServer } from "../src/server/tdmcpServer.js";
import { fingerprintTool } from "../src/tools/toolsets/metadata.js";
import { DYNAMIC_MANAGEMENT_TOOL_NAMES } from "../src/tools/toolsets/profiles.js";
import type { GeneratedToolMetadataEntry } from "../src/tools/toolsets/types.js";
import type { ToolContext } from "../src/tools/types.js";
import { utilRegistrars } from "../src/tools/util/index.js";
import { loadConfig } from "../src/utils/config.js";
import { silentLogger } from "../src/utils/logger.js";

type GeneratorMode = "--write" | "--check" | "--write-baseline";

const GENERATED_METADATA_PATH = fileURLToPath(
  new URL("../src/tools/toolsets/toolMetadata.generated.ts", import.meta.url),
);
const BASELINE_PATH = fileURLToPath(
  new URL("../tests/fixtures/tool-contract-baseline.json", import.meta.url),
);
const MIGRATION_PATH = fileURLToPath(
  new URL("../tests/fixtures/tool-contract-migration-pr142.json", import.meta.url),
);
const OPTIONAL_CONTRACT_PATH = fileURLToPath(
  new URL("../tests/fixtures/tool-contract-optional.json", import.meta.url),
);
const HISTORICAL_BASELINE_COUNT = 497;
const STATIC_TOOL_COUNT = 507;
const DYNAMIC_TOOL_COUNT = 511;
const OPTIONAL_STATIC_TOOL_COUNT = 508;
const OPTIONAL_DYNAMIC_TOOL_COUNT = 512;

function explicitGeneratorEnv(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    TDMCP_TOOL_PROFILE: overrides.TDMCP_TOOL_PROFILE ?? "full",
    TDMCP_DYNAMIC_TOOLSETS: overrides.TDMCP_DYNAMIC_TOOLSETS ?? "off",
    TDMCP_RAW_PYTHON: "on",
    TDMCP_EVENTS: "off",
    TDMCP_LOG_LEVEL: "silent",
    TDMCP_RAG_ENABLED: "0",
    TDMCP_PROJECT_RAG_ENABLED: "0",
    TDMCP_RAG_APPLY_CARD: overrides.TDMCP_RAG_APPLY_CARD ?? "off",
  };
}

async function collectFullTools(overrides: NodeJS.ProcessEnv): Promise<Tool[]> {
  const env = explicitGeneratorEnv(overrides);
  const config = loadConfig(env);
  const server = createTdmcpServer(config, { logger: silentLogger });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "tdmcp-metadata-generator", version: "0.0.0" });
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return (await client.listTools()).tools.sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
}

async function collectManagementTools(): Promise<Tool[]> {
  const server = new McpServer({ name: "tdmcp-metadata-management", version: "0.0.0" });
  const ctx = { dynamicToolsets: true } as ToolContext;
  for (const register of utilRegistrars) register(server, ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "tdmcp-metadata-generator", version: "0.0.0" });
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return (await client.listTools()).tools.sort((a, b) => compareAscii(a.name, b.name));
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
}

function mergeStaticAndManagementTools(
  staticTools: readonly Tool[],
  managementTools: readonly Tool[],
): Tool[] {
  const byName = new Map(staticTools.map((tool) => [tool.name, tool]));
  for (const tool of managementTools) {
    if (byName.has(tool.name)) throw new Error(`Duplicate dynamic management tool: ${tool.name}`);
    byName.set(tool.name, tool);
  }
  return [...byName.values()].sort((a, b) => compareAscii(a.name, b.name));
}

function assertSameToolContracts(
  expected: readonly Tool[],
  actual: readonly Tool[],
  label: string,
): void {
  const expectedEntries = expected.map((tool) => [tool.name, fingerprintTool(tool)]);
  const actualEntries = actual.map((tool) => [tool.name, fingerprintTool(tool)]);
  if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
    throw new Error(`${label} drifted from generated static-plus-management contracts.`);
  }
}

function metadataEntries(tools: readonly Tool[]): Record<string, GeneratedToolMetadataEntry> {
  return Object.fromEntries(
    tools.map((tool) => [
      tool.name,
      {
        bytes: Buffer.byteLength(JSON.stringify(tool), "utf8"),
        fingerprint: fingerprintTool(tool),
      },
    ]),
  );
}

function renderMetadataEntries(tools: readonly Tool[]): string {
  return Object.entries(metadataEntries(tools))
    .map(([name, entry]) => {
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
        throw new Error(`Tool name cannot be rendered as a TypeScript identifier: ${name}`);
      }
      return `  ${name}: {
    bytes: ${entry.bytes},
    fingerprint: "${entry.fingerprint}",
  },`;
    })
    .join("\n");
}

function renderMetadataModule(tools: readonly Tool[], optionalTools: readonly Tool[]): string {
  const entries = renderMetadataEntries(tools);
  const optionalEntries = renderMetadataEntries(optionalTools);
  return `/**
 * Generated by scripts/gen-tool-metadata.ts.
 * Regenerate with \`npm run tools:metadata:gen\`; verify with \`npm run tools:metadata:check\`.
 */

import type { GeneratedToolMetadataEntry } from "./types.js";

export const TOOL_METADATA: Record<string, GeneratedToolMetadataEntry> = {
${entries}
};

/** Opt-in tools that are absent from the default static and dynamic surfaces. */
export const OPTIONAL_TOOL_METADATA: Record<string, GeneratedToolMetadataEntry> = {
${optionalEntries}
};
`;
}

function renderBaseline(tools: readonly Tool[]): string {
  if (tools.length !== HISTORICAL_BASELINE_COUNT) {
    throw new Error(
      `Refusing to write historical baseline: expected ${HISTORICAL_BASELINE_COUNT} tools, received ${tools.length}.`,
    );
  }
  return `${JSON.stringify(
    {
      count: HISTORICAL_BASELINE_COUNT,
      fingerprints: Object.fromEntries(tools.map((tool) => [tool.name, fingerprintTool(tool)])),
    },
    null,
    2,
  )}\n`;
}

interface ToolContractBaseline {
  count: number;
  fingerprints: Record<string, string>;
}

interface ToolContractMigration {
  source: string;
  base_count: number;
  static_count: number;
  added_fingerprints: Record<string, string>;
  changed_fingerprints: Record<string, string>;
}

interface OptionalToolContract {
  source: string;
  count: number;
  fingerprints: Record<string, string>;
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function readLegacyBaseline(): ToolContractBaseline {
  if (!existsSync(BASELINE_PATH)) {
    throw new Error(`Missing immutable legacy baseline: ${BASELINE_PATH}`);
  }
  const parsed = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Partial<ToolContractBaseline>;
  if (
    parsed.count !== HISTORICAL_BASELINE_COUNT ||
    !parsed.fingerprints ||
    typeof parsed.fingerprints !== "object" ||
    Object.keys(parsed.fingerprints).length !== HISTORICAL_BASELINE_COUNT
  ) {
    throw new Error("Immutable legacy baseline has an invalid shape or count.");
  }
  return parsed as ToolContractBaseline;
}

function readApprovedMigration(): ToolContractMigration {
  if (!existsSync(MIGRATION_PATH)) {
    throw new Error(`Missing approved tool-contract migration: ${MIGRATION_PATH}`);
  }
  const parsed = JSON.parse(readFileSync(MIGRATION_PATH, "utf8")) as Partial<ToolContractMigration>;
  if (
    typeof parsed.source !== "string" ||
    !/^[0-9a-f]{40}$/.test(parsed.source) ||
    parsed.base_count !== HISTORICAL_BASELINE_COUNT ||
    parsed.static_count !== STATIC_TOOL_COUNT ||
    !parsed.added_fingerprints ||
    typeof parsed.added_fingerprints !== "object" ||
    !parsed.changed_fingerprints ||
    typeof parsed.changed_fingerprints !== "object"
  ) {
    throw new Error("Approved tool-contract migration has an invalid shape or count.");
  }
  return parsed as ToolContractMigration;
}

function readOptionalContract(): OptionalToolContract {
  if (!existsSync(OPTIONAL_CONTRACT_PATH)) {
    throw new Error(`Missing opt-in tool contract: ${OPTIONAL_CONTRACT_PATH}`);
  }
  const parsed = JSON.parse(
    readFileSync(OPTIONAL_CONTRACT_PATH, "utf8"),
  ) as Partial<OptionalToolContract>;
  if (
    typeof parsed.source !== "string" ||
    !/^[0-9a-f]{40}$/.test(parsed.source) ||
    parsed.count !== 1 ||
    !parsed.fingerprints ||
    typeof parsed.fingerprints !== "object" ||
    Object.keys(parsed.fingerprints).length !== parsed.count
  ) {
    throw new Error("Opt-in tool contract has an invalid shape or count.");
  }
  return parsed as OptionalToolContract;
}

function assertOptionalToolContracts(
  staticTools: readonly Tool[],
  optionalStaticTools: readonly Tool[],
  contract: OptionalToolContract,
): Tool[] {
  if (optionalStaticTools.length !== OPTIONAL_STATIC_TOOL_COUNT) {
    throw new Error(
      `Opt-in static tool count drift: expected ${OPTIONAL_STATIC_TOOL_COUNT}, received ${optionalStaticTools.length}.`,
    );
  }
  const staticByName = new Map(staticTools.map((tool) => [tool.name, tool]));
  const optionalByName = new Map(optionalStaticTools.map((tool) => [tool.name, tool]));
  for (const [name, staticTool] of staticByName) {
    const optionalTool = optionalByName.get(name);
    if (!optionalTool || fingerprintTool(optionalTool) !== fingerprintTool(staticTool)) {
      throw new Error(`Opt-in mode changed a default tool contract: ${name}`);
    }
  }

  const optionalOnly = optionalStaticTools
    .filter((tool) => !staticByName.has(tool.name))
    .sort((left, right) => compareAscii(left.name, right.name));
  const expectedNames = Object.keys(contract.fingerprints).sort(compareAscii);
  if (JSON.stringify(optionalOnly.map((tool) => tool.name)) !== JSON.stringify(expectedNames)) {
    throw new Error("Opt-in tool names drifted from the approved migration.");
  }
  for (const tool of optionalOnly) {
    if (fingerprintTool(tool) !== contract.fingerprints[tool.name]) {
      throw new Error(`Opt-in tool fingerprint drift: ${tool.name}`);
    }
  }
  return optionalOnly;
}

function assertToolContracts(
  staticTools: readonly Tool[],
  dynamic: readonly Tool[],
  baseline: ToolContractBaseline,
  migration: ToolContractMigration,
): void {
  if (staticTools.length !== STATIC_TOOL_COUNT) {
    throw new Error(
      `Static tool count drift: expected ${STATIC_TOOL_COUNT}, received ${staticTools.length}.`,
    );
  }
  if (dynamic.length !== DYNAMIC_TOOL_COUNT) {
    throw new Error(
      `Dynamic tool count drift: expected ${DYNAMIC_TOOL_COUNT}, received ${dynamic.length}.`,
    );
  }

  const staticByName = new Map(staticTools.map((tool) => [tool.name, tool]));
  const dynamicByName = new Map(dynamic.map((tool) => [tool.name, tool]));
  const baselineNames = Object.keys(baseline.fingerprints).sort(compareAscii);
  const addedNames = Object.keys(migration.added_fingerprints).sort(compareAscii);
  const changedNames = Object.keys(migration.changed_fingerprints).sort(compareAscii);
  const expectedStaticNames = [...baselineNames, ...addedNames].sort(compareAscii);
  const staticNames = [...staticByName.keys()].sort(compareAscii);
  if (JSON.stringify(staticNames) !== JSON.stringify(expectedStaticNames)) {
    throw new Error(
      "Static tool names drifted from the historical baseline and approved migration.",
    );
  }
  if (addedNames.some((name) => baseline.fingerprints[name] !== undefined)) {
    throw new Error("Approved added tools overlap the historical baseline.");
  }
  if (changedNames.some((name) => baseline.fingerprints[name] === undefined)) {
    throw new Error("Approved changed tools must exist in the historical baseline.");
  }

  for (const name of baselineNames) {
    const expected = migration.changed_fingerprints[name] ?? baseline.fingerprints[name];
    const staticTool = staticByName.get(name);
    const dynamicTool = dynamicByName.get(name);
    if (!staticTool || fingerprintTool(staticTool) !== expected) {
      throw new Error(`Static tool fingerprint drift: ${name}`);
    }
    if (!dynamicTool || fingerprintTool(dynamicTool) !== expected) {
      throw new Error(`Dynamic static-tool fingerprint drift: ${name}`);
    }
  }

  for (const name of addedNames) {
    const expected = migration.added_fingerprints[name];
    const staticTool = staticByName.get(name);
    const dynamicTool = dynamicByName.get(name);
    if (!staticTool || fingerprintTool(staticTool) !== expected) {
      throw new Error(`Approved added-tool fingerprint drift: ${name}`);
    }
    if (!dynamicTool || fingerprintTool(dynamicTool) !== expected) {
      throw new Error(`Dynamic added-tool fingerprint drift: ${name}`);
    }
  }

  const dynamicOnly = [...dynamicByName.keys()]
    .filter((name) => !staticByName.has(name))
    .sort(compareAscii);
  const expectedDynamicOnly = [...DYNAMIC_MANAGEMENT_TOOL_NAMES].sort(compareAscii);
  if (JSON.stringify(dynamicOnly) !== JSON.stringify(expectedDynamicOnly)) {
    throw new Error(
      `Unexpected dynamic-only tools: expected ${expectedDynamicOnly.join(", ")}, received ${dynamicOnly.join(", ")}.`,
    );
  }
}

function parseMode(args: readonly string[]): GeneratorMode | undefined {
  if (args.length !== 1) return undefined;
  const [mode] = args;
  if (mode === "--write" || mode === "--check" || mode === "--write-baseline") {
    return mode;
  }
  return undefined;
}

async function run(args: readonly string[]): Promise<number> {
  const mode = parseMode(args);
  if (!mode) {
    console.error("Usage: tsx scripts/gen-tool-metadata.ts (--write|--check|--write-baseline)");
    return 2;
  }

  if (mode === "--write-baseline" && existsSync(BASELINE_PATH)) {
    console.error(`Refusing to replace existing legacy baseline: ${BASELINE_PATH}`);
    return 1;
  }

  try {
    const staticTools = await collectFullTools({
      TDMCP_TOOL_PROFILE: "full",
      TDMCP_DYNAMIC_TOOLSETS: "off",
    });
    if (mode === "--write-baseline") {
      writeFileSync(BASELINE_PATH, renderBaseline(staticTools), { encoding: "utf8", flag: "wx" });
      console.log(`historical baseline entries: ${staticTools.length}`);
      return 0;
    }

    const migration = readApprovedMigration();
    const optionalStaticTools = await collectFullTools({
      TDMCP_TOOL_PROFILE: "full",
      TDMCP_DYNAMIC_TOOLSETS: "off",
      TDMCP_RAG_APPLY_CARD: "1",
    });
    const optionalTools = assertOptionalToolContracts(
      staticTools,
      optionalStaticTools,
      readOptionalContract(),
    );
    const managementTools = await collectManagementTools();
    const dynamic = mergeStaticAndManagementTools(staticTools, managementTools);
    const optionalDynamic = mergeStaticAndManagementTools(optionalStaticTools, managementTools);
    if (optionalDynamic.length !== OPTIONAL_DYNAMIC_TOOL_COUNT) {
      throw new Error(
        `Opt-in dynamic tool count drift: expected ${OPTIONAL_DYNAMIC_TOOL_COUNT}, received ${optionalDynamic.length}.`,
      );
    }
    assertToolContracts(staticTools, dynamic, readLegacyBaseline(), migration);
    if (mode === "--write") {
      writeFileSync(GENERATED_METADATA_PATH, renderMetadataModule(dynamic, optionalTools), "utf8");
      console.log(
        `generated metadata entries: ${dynamic.length} default + ${optionalTools.length} opt-in`,
      );
      return 0;
    }

    const expected = renderMetadataModule(dynamic, optionalTools);
    const current = existsSync(GENERATED_METADATA_PATH)
      ? readFileSync(GENERATED_METADATA_PATH, "utf8")
      : undefined;
    if (current !== expected) {
      console.error("Tool metadata is stale. Run `npm run tools:metadata:gen`.");
      return 1;
    }
    const runtimeDynamic = await collectFullTools({
      TDMCP_TOOL_PROFILE: "full",
      TDMCP_DYNAMIC_TOOLSETS: "on",
    });
    assertSameToolContracts(dynamic, runtimeDynamic, "Dynamic runtime tool surface");
    const runtimeOptionalDynamic = await collectFullTools({
      TDMCP_TOOL_PROFILE: "full",
      TDMCP_DYNAMIC_TOOLSETS: "on",
      TDMCP_RAG_APPLY_CARD: "1",
    });
    assertSameToolContracts(
      optionalDynamic,
      runtimeOptionalDynamic,
      "Opt-in dynamic runtime tool surface",
    );
    console.log("tool metadata is current");
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
