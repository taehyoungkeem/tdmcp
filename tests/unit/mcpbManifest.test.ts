import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  OPTIONAL_TOOL_METADATA,
  TOOL_METADATA,
} from "../../src/tools/toolsets/toolMetadata.generated.js";
import { ConfigSchema, ToolProfileSchema } from "../../src/utils/config.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const profileChoices = [...ToolProfileSchema.options];
const packageDefaults = ConfigSchema.parse({});
const generatedToolCount =
  Object.keys(TOOL_METADATA).length + Object.keys(OPTIONAL_TOOL_METADATA).length;

function userConfigEnv(name: string): string {
  return `\${user_config.${name}}`;
}

describe("MCPB manifest safety controls", () => {
  it("exposes bridge auth and raw-tool profile controls to extension users", () => {
    const manifest = JSON.parse(readFileSync(join(root, "mcpb", "manifest.json"), "utf8")) as {
      server?: { mcp_config?: { env?: Record<string, string> } };
      user_config?: Record<
        string,
        {
          type?: string;
          title?: string;
          description?: string;
          default?: unknown;
          sensitive?: boolean;
          min?: number;
          max?: number;
          enum?: string[];
        }
      >;
    };

    expect(manifest.server?.mcp_config?.env).toMatchObject({
      TDMCP_BRIDGE_TOKEN: userConfigEnv("TDMCP_BRIDGE_TOKEN"),
      TDMCP_RAW_PYTHON: userConfigEnv("TDMCP_RAW_PYTHON"),
      TDMCP_TOOL_PROFILE: userConfigEnv("TDMCP_TOOL_PROFILE"),
      TDMCP_DYNAMIC_TOOLSETS: userConfigEnv("TDMCP_DYNAMIC_TOOLSETS"),
      TDMCP_TOOL_MAX_ACTIVE: userConfigEnv("TDMCP_TOOL_MAX_ACTIVE"),
      TDMCP_TOOL_METADATA_BUDGET_KB: userConfigEnv("TDMCP_TOOL_METADATA_BUDGET_KB"),
    });
    expect(manifest.user_config?.TDMCP_BRIDGE_TOKEN).toMatchObject({
      type: "string",
      title: "TouchDesigner bridge token",
      default: "",
      // The bridge token is a secret: Claude Desktop must mask it and store it in
      // the OS keychain rather than render it in plain text.
      sensitive: true,
    });
    expect(manifest.user_config?.TDMCP_RAW_PYTHON).toMatchObject({
      type: "string",
      default: "on",
    });
    expect(manifest.user_config?.TDMCP_TOOL_PROFILE).toMatchObject({
      type: "string",
      default: packageDefaults.toolProfile,
    });
    const profileConfig = manifest.user_config?.TDMCP_TOOL_PROFILE;
    for (const profile of profileChoices) expect(profileConfig?.description).toContain(profile);
    // MCPB manifest v0.3 does not support enum/choices for user_config strings.
    expect(profileConfig?.enum).toBeUndefined();
    expect(manifest.user_config?.TDMCP_DYNAMIC_TOOLSETS).toMatchObject({
      type: "string",
      default: packageDefaults.dynamicToolsets,
    });
    expect(manifest.user_config?.TDMCP_TOOL_MAX_ACTIVE).toMatchObject({
      type: "number",
      default: packageDefaults.toolMaxActive,
      min: 1,
      max: generatedToolCount,
    });
    expect(manifest.user_config?.TDMCP_TOOL_METADATA_BUDGET_KB).toMatchObject({
      type: "number",
      default: packageDefaults.toolMetadataBudgetKb,
      min: 1,
      max: 4096,
    });
  });

  it("defaults the MCP directory manifest to the compact directory profile", () => {
    const manifest = JSON.parse(readFileSync(join(root, "server.json"), "utf8")) as {
      packages?: Array<{
        environmentVariables?: Array<{
          name?: string;
          default?: string;
          choices?: string[];
          format?: string;
        }>;
      }>;
    };
    const variables = manifest.packages?.[0]?.environmentVariables ?? [];
    const byName = new Map(variables.map((variable) => [variable.name, variable]));

    expect(byName.get("TDMCP_TOOL_PROFILE")).toMatchObject({
      default: "directory",
      choices: profileChoices,
    });
    expect(byName.get("TDMCP_RAW_PYTHON")).toMatchObject({
      default: "off",
      choices: ["on", "off"],
    });
    expect(byName.get("TDMCP_DYNAMIC_TOOLSETS")).toMatchObject({
      default: "off",
      choices: ["on", "off"],
    });
    expect(byName.get("TDMCP_TOOL_MAX_ACTIVE")).toMatchObject({
      default: String(packageDefaults.toolMaxActive),
      format: "number",
    });
    expect(byName.get("TDMCP_TOOL_METADATA_BUDGET_KB")).toMatchObject({
      default: String(packageDefaults.toolMetadataBudgetKb),
      format: "number",
    });
  });

  it("keeps registry container scans compact while local Docker stays complete", () => {
    const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
    const compose = readFileSync(join(root, "docker-compose.yml"), "utf8");

    expect(dockerfile).toMatch(/TDMCP_TOOL_PROFILE=directory/);
    expect(dockerfile).toMatch(/TDMCP_RAW_PYTHON=off/);
    expect(dockerfile).toMatch(/TDMCP_HTTP_HOST=0\.0\.0\.0/);
    expect(compose).toMatch(/TDMCP_HTTP_HOST:\s*0\.0\.0\.0/);
    expect(compose).toMatch(/TDMCP_TOOL_PROFILE:\s*full/);
    expect(compose).toMatch(/TDMCP_RAW_PYTHON:\s*["']on["']/);
  });
});
