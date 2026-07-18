import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { aiRegistrars } from "./ai/index.js";
import { foundationRegistrars } from "./foundation/index.js";
import { layer1Registrars } from "./layer1/index.js";
import { layer2Registrars } from "./layer2/index.js";
import { layer3Registrars } from "./layer3/index.js";
import { libraryRegistrars } from "./library/index.js";
import { registerToolGroups } from "./registration.js";
import type { ToolRegistrarGroup } from "./toolsets/types.js";
import type { ToolContext, ToolRegistrar } from "./types.js";
import { utilRegistrars } from "./util/index.js";
import { vaultRegistrars } from "./vault/index.js";

export const runtimeToolRegistrarGroups: readonly ToolRegistrarGroup[] = [
  { group: "layer3", registrars: layer3Registrars },
  { group: "layer2", registrars: layer2Registrars },
  { group: "layer1", registrars: layer1Registrars },
  { group: "foundation", registrars: foundationRegistrars },
  { group: "library", registrars: libraryRegistrars },
  { group: "util", registrars: utilRegistrars },
  { group: "vault", registrars: vaultRegistrars },
  { group: "ai", registrars: aiRegistrars },
];

/** Flattened compatibility export for callers that still compose registrar arrays. */
export const runtimeToolRegistrars: ToolRegistrar[] = runtimeToolRegistrarGroups.flatMap(
  (entry) => entry.registrars,
);

export function registerToolRegistrars(
  server: McpServer,
  ctx: ToolContext,
  registrars: readonly ToolRegistrar[],
): void {
  registerToolGroups(server, ctx, {
    groups: [{ group: "util", registrars }],
    dynamic: false,
  });
}

export function registerRuntimeTools(server: McpServer, ctx: ToolContext): void {
  registerToolGroups(server, ctx, {
    groups: runtimeToolRegistrarGroups,
    dynamic: false,
  });
}
