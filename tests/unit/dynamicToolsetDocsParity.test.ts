import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  DIRECTORY_PROFILE_TOOL_NAMES,
  DYNAMIC_MANAGEMENT_TOOL_NAMES,
  PROTECTED_CORE_TOOL_NAMES,
} from "../../src/tools/toolsets/profiles.js";
import { TOOL_METADATA } from "../../src/tools/toolsets/toolMetadata.generated.js";
import { ConfigSchema, ToolProfileSchema } from "../../src/utils/config.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (path: string): string => readFileSync(join(root, path), "utf8");

const profileChoices = [...ToolProfileSchema.options];
const defaults = ConfigSchema.parse({});
const dynamicCount = Object.keys(TOOL_METADATA).length;
const legacyCount = dynamicCount - DYNAMIC_MANAGEMENT_TOOL_NAMES.length;
const staticDirectoryCount = DIRECTORY_PROFILE_TOOL_NAMES.length;
const dynamicDirectoryCount = new Set([
  ...DIRECTORY_PROFILE_TOOL_NAMES,
  ...PROTECTED_CORE_TOOL_NAMES,
]).size;

const personalCompactRecipe = `[mcp_servers.tdmcp.env]\nTDMCP_TOOL_PROFILE = "core"\nTDMCP_DYNAMIC_TOOLSETS = "on"`;
const staticFallbackRecipe = `[mcp_servers.tdmcp.env]\nTDMCP_TOOL_PROFILE = "build"\nTDMCP_DYNAMIC_TOOLSETS = "off"`;
const legacyRollbackRecipe = `[mcp_servers.tdmcp.env]\nTDMCP_TOOL_PROFILE = "full"\nTDMCP_DYNAMIC_TOOLSETS = "off"`;

const docs = {
  readme: read("README.md"),
  environment: read("docs/reference/environment.md"),
  architecture: read("docs/reference/architecture.md"),
  environmentPt: read("docs/pt/reference/environment.md"),
  architecturePt: read("docs/pt/reference/architecture.md"),
  deployment: read("docs/DEPLOYMENT.md"),
};

function expectInventory(text: string): void {
  expect(text).toContain(String(legacyCount));
  expect(text).toContain(String(dynamicCount));
  expect(text).toMatch(
    new RegExp(
      `directory[^\\n]{0,160}${staticDirectoryCount}[^\\n]{0,80}${dynamicDirectoryCount}`,
      "i",
    ),
  );
}

function expectBothRecoveryRecipes(text: string): void {
  expect(text).toContain(staticFallbackRecipe);
  expect(text).toContain(legacyRollbackRecipe);
  expect(text).toMatch(/restart|reinici/i);
  expect(text).toMatch(/approval|aprova/i);
}

describe("dynamic toolset documentation parity", () => {
  it("derives the documented inventory from the generated runtime contracts", () => {
    expect({ legacyCount, dynamicCount, staticDirectoryCount, dynamicDirectoryCount }).toEqual({
      legacyCount: 497,
      dynamicCount: 501,
      staticDirectoryCount: 15,
      dynamicDirectoryCount: 22,
    });
    expect(DYNAMIC_MANAGEMENT_TOOL_NAMES).toEqual([
      "discover_tools",
      "select_toolset",
      "get_active_toolset",
      "reset_toolset",
    ]);

    for (const text of Object.values(docs)) expectInventory(text);
  });

  it("keeps README setup, management, risk, refresh, and recovery semantics explicit", () => {
    expect(docs.readme).toContain(personalCompactRecipe);
    for (const name of DYNAMIC_MANAGEMENT_TOOL_NAMES) expect(docs.readme).toContain(name);
    expect(docs.readme).toContain("include_risky: true");
    expect(docs.readme).toContain("client_refresh_required: true");
    expect(docs.readme).toMatch(/hint[^\n]*not[^\n]*acknowledg/i);
    expect(docs.readme).toMatch(/startup[^\n]*reset[^\n]*not selectable/i);
    expectBothRecoveryRecipes(docs.readme);
  });

  it("keeps English and Portuguese references aligned with package defaults and lifecycle", () => {
    for (const text of [docs.environment, docs.environmentPt]) {
      const profileRow = text.split("\n").find((line) => line.startsWith("| `TDMCP_TOOL_PROFILE`"));
      for (const profile of profileChoices) expect(profileRow).toContain(`\`${profile}\``);
      expect(text).toContain(`| \`TDMCP_DYNAMIC_TOOLSETS\` | \`${defaults.dynamicToolsets}\` |`);
      expect(text).toContain(`| \`TDMCP_TOOL_MAX_ACTIVE\` | \`${defaults.toolMaxActive}\` |`);
      expect(text).toContain(
        `| \`TDMCP_TOOL_METADATA_BUDGET_KB\` | \`${defaults.toolMetadataBudgetKb}\` |`,
      );
      expectBothRecoveryRecipes(text);
    }

    for (const text of [docs.architecture, docs.architecturePt]) {
      expect(text).toContain("createTdmcpServer");
      expect(text).toContain("tools/list_changed");
      for (const name of DYNAMIC_MANAGEMENT_TOOL_NAMES) expect(text).toContain(name);
      expect(text).toContain("client_refresh_required: true");
      expect(text).toMatch(/hint|dica/i);
      expect(text).toMatch(/acknowledg|confirma/i);
      expect(text).toMatch(/protected|proteg/i);
      expect(text).toMatch(/raw|cru/i);
      expect(text).toMatch(/destructive|destrutiv/i);
      expectBothRecoveryRecipes(text);
    }
  });

  it("keeps MCPB, registry, and Smithery choices/defaults in parity", () => {
    const mcpb = JSON.parse(read("mcpb/manifest.json")) as {
      user_config?: Record<string, { description?: string; default?: unknown }>;
    };
    const registry = JSON.parse(read("server.json")) as {
      packages?: Array<{
        environmentVariables?: Array<{
          name?: string;
          default?: string;
          choices?: string[];
          format?: string;
        }>;
      }>;
    };
    const smithery = parseYaml(read("smithery.yaml")) as {
      startCommand?: {
        configSchema?: {
          properties?: Record<
            string,
            {
              type?: string;
              enum?: string[];
              default?: unknown;
              minimum?: number;
              maximum?: number;
            }
          >;
        };
        commandFunction?: string;
      };
    };

    const mcpbProfile = mcpb.user_config?.TDMCP_TOOL_PROFILE;
    expect(mcpbProfile?.default).toBe(defaults.toolProfile);
    for (const profile of profileChoices) expect(mcpbProfile?.description).toContain(profile);

    const registryVars = new Map(
      (registry.packages?.[0]?.environmentVariables ?? []).map((entry) => [entry.name, entry]),
    );
    expect(registryVars.get("TDMCP_TOOL_PROFILE")).toMatchObject({
      default: "directory",
      choices: profileChoices,
    });
    expect(registryVars.get("TDMCP_RAW_PYTHON")).toMatchObject({ default: "off" });
    expect(registryVars.get("TDMCP_DYNAMIC_TOOLSETS")).toMatchObject({ default: "off" });

    const properties = smithery.startCommand?.configSchema?.properties ?? {};
    expect(properties.toolProfile).toMatchObject({
      type: "string",
      enum: profileChoices,
      default: defaults.toolProfile,
    });
    expect(properties.dynamicToolsets).toMatchObject({
      type: "string",
      enum: ["off", "on"],
      default: defaults.dynamicToolsets,
    });
    expect(properties.toolMaxActive).toMatchObject({
      type: "integer",
      default: defaults.toolMaxActive,
      minimum: 1,
      maximum: dynamicCount,
    });
    expect(properties.toolMetadataBudgetKb).toMatchObject({
      type: "integer",
      default: defaults.toolMetadataBudgetKb,
      minimum: 1,
      maximum: 4096,
    });
    const commandFunction = smithery.startCommand?.commandFunction ?? "";
    for (const key of [
      "TDMCP_DYNAMIC_TOOLSETS",
      "TDMCP_TOOL_MAX_ACTIVE",
      "TDMCP_TOOL_METADATA_BUDGET_KB",
    ]) {
      expect(commandFunction).toContain(key);
    }
  });

  it("documents distribution limitations, SafeSkill risk composition, and release evidence", () => {
    expect(docs.deployment).toMatch(/MCPB/i);
    expect(docs.deployment).toMatch(/Smithery/i);
    expect(docs.deployment).toMatch(/registry/i);
    expect(docs.deployment).toMatch(/directory[^\n]*dynamic[^\n]*off/i);
    expectBothRecoveryRecipes(docs.deployment);

    const safeskill = JSON.parse(read("safeskill.manifest.json")) as {
      securityNotes?: string[];
    };
    const notes = (safeskill.securityNotes ?? []).join("\n");
    expect(notes).toMatch(/presets?[^\n]*safe by construction/i);
    expect(notes).toContain("exact tool name");
    expect(notes).toContain("include_risky: true");
    expect(notes).toMatch(/approval/i);
    expect(notes).toMatch(/environment/i);
    expect(notes).toMatch(/TDMCP_RAW_PYTHON=off[^\n]*authoritative/i);

    const changelog = read("CHANGELOG.md").match(/## \[Unreleased\]([\s\S]*?)(?=\n## \[)/)?.[1];
    expect(changelog).toBeDefined();
    for (const marker of [
      "dynamic toolsets",
      "discover_tools",
      "select_toolset",
      "get_active_toolset",
      "reset_toolset",
      "bilingual",
      "offline",
      "session isolation",
      "metadata budgets",
      "Inspector",
      "Conformance",
    ]) {
      expect(changelog).toContain(marker);
    }
  });

  it("records exact reviewed/artifact provenance without copied runtime source", () => {
    const architecture = docs.architecture;
    for (const marker of [
      "69749aa5081ddfe675d36da8d96c7e27d83742b8",
      "e12cbd7078db388152f6e839abdbe09ba01f3f32",
      "ebd0550fecea0f398aae4997a9c8189727aec6e0",
      "0ba1b8d1d8852e2f179f5a1945895ef97a91459f",
      "d1c0b9591786726d8a4bec05306eb103ba6894ff",
      "794dcab99ed1ef2b89607be9999574140ea5c96e",
      "52ecebcca4eb5bda15b26fd0aac00bd2298bfc1c",
      "f7771c177e100a62a5b99f0d8cd5e97300eda6ea",
      "f62d849350816588b1c6294e7914bbe4d8b84072",
      "FastMCP",
      "PydanticAI",
    ]) {
      expect(architecture).toContain(marker);
    }
    expect(architecture).toMatch(/no (?:runtime )?source (?:code )?(?:was |is )?copied/i);
  });

  it("generates the four management tools as their own documented group", () => {
    const generator = read("scripts/gen-tool-docs.ts");
    expect(generator).toContain('import { utilRegistrars } from "../src/tools/util/index.js"');
    expect(generator).toContain('heading: "Dynamic toolset management"');
    expect(generator).toContain("tools: capture(utilRegistrars)");
  });
});
