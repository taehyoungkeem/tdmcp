import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { cliRegistrars } from "./cli/index.js";
import { type RegisterToolGroupsOptions, registerToolGroups } from "./registration.js";
import { runtimeToolRegistrarGroups } from "./registry.js";
import type { ToolContext } from "./types.js";

export type RegisterAllToolsOptions = Omit<RegisterToolGroupsOptions, "groups">;

/** Registers every tool (all layers) against the MCP server, honoring the profile. */
export function registerAllTools(
  server: McpServer,
  ctx: ToolContext,
  options: RegisterAllToolsOptions = { dynamic: ctx.dynamicToolsets === true },
): void {
  registerToolGroups(server, ctx, {
    ...options,
    groups: [...runtimeToolRegistrarGroups, { group: "cli", registrars: cliRegistrars }],
  });
}

export type { ToolContext, ToolRegistrar } from "./types.js";
