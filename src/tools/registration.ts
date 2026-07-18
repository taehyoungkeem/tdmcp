import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { MacroRecorder } from "../automation/macroSchema.js";
import { DYNAMIC_MANAGEMENT_TOOL_NAME_SET, staticProfileAllows } from "./toolsets/profiles.js";
import type { CapturedToolRegistration, ToolGroup, ToolRegistrarGroup } from "./toolsets/types.js";
import type { ToolContext } from "./types.js";

interface ToolConfig {
  title?: string;
  description?: string;
  annotations?: ToolAnnotations;
}

type RegisterToolForwarder = (name: string, ...rest: unknown[]) => RegisteredTool | undefined;

export interface RegisterToolGroupsOptions {
  groups: readonly ToolRegistrarGroup[];
  dynamic: boolean;
  macroRecorder?: MacroRecorder;
  onRegistered?: (entry: CapturedToolRegistration) => void;
}

export function registerToolGroups(
  server: McpServer,
  ctx: ToolContext,
  options: RegisterToolGroupsOptions,
): void {
  const mutableServer = server as unknown as { registerTool: RegisterToolForwarder };
  const originalRegister = server.registerTool;
  const realRegister = originalRegister.bind(server) as unknown as RegisterToolForwarder;
  let currentGroup: ToolGroup = "util";

  mutableServer.registerTool = (name, ...rest) => {
    const profile = ctx.toolProfile ?? "full";
    if (!options.dynamic && !staticProfileAllows(name, profile)) return undefined;
    if (!options.dynamic && DYNAMIC_MANAGEMENT_TOOL_NAME_SET.has(name)) return undefined;

    const config = (rest[0] ?? {}) as ToolConfig;
    const handler = rest.at(-1);
    if (typeof handler === "function" && options.macroRecorder) {
      rest[rest.length - 1] = options.macroRecorder.wrapHandler(
        name,
        handler as (args: unknown) => unknown,
      );
    }

    const handle = realRegister(name, ...rest) as RegisteredTool;
    options.onRegistered?.({
      name,
      group: currentGroup,
      title: config.title,
      description: config.description,
      annotations: config.annotations,
      handle,
    });
    return handle;
  };

  try {
    for (const group of options.groups) {
      currentGroup = group.group;
      for (const register of group.registrars) register(server, ctx);
    }
  } finally {
    mutableServer.registerTool = originalRegister as unknown as RegisterToolForwarder;
  }
}
