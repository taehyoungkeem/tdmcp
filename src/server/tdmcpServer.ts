import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getMacroRecorder } from "../automation/macroSchema.js";
import { createLazyLlmClient } from "../llm/resolve.js";
import { registerAllPrompts } from "../prompts/index.js";
import { registerAllResources } from "../resources/index.js";
import { registerAllTools } from "../tools/index.js";
import { ToolsetManager } from "../tools/toolsets/index.js";
import type { TdmcpConfig } from "../utils/config.js";
import { getVersion } from "../utils/version.js";
import { buildToolContext, type ToolContextOverrides } from "./context.js";

const INSTRUCTIONS = `tdmcp lets you build visual systems in TouchDesigner.

Workflow:
1. Call get_td_info first to confirm the bridge is reachable.
2. Consult the knowledge base resources (tdmcp://operators/..., tdmcp://recipes/...) before creating nodes — never invent operator types.
3. Build with the highest-level tool that fits, dropping to Layer 2/3 for fine control.
4. After building, check get_td_node_errors and capture get_preview so the artist can see the result.
5. Prefer structured inspection/edit tools (find_td_nodes, get_td_node_parameters, summarize_td_errors, compare_td_nodes, snapshot_td_graph, update_td_node_parameters) and process their structuredContent with code. Treat execute_python_script and exec_node_method as a last resort, only when no structured tool fits.

Token economy: read tools return a lot — scope every read (a parent path, a name filter, specific parameter keys) instead of listing broadly, don't re-list a path you already inspected, and prefer get_preview's sample_grid over a full image when you only need to know whether an output is alive.

The server stays usable even when TouchDesigner is offline; tools return a friendly error in that case.`;

const DYNAMIC_TOOLSET_INSTRUCTIONS = `${INSTRUCTIONS}

Dynamic toolsets are enabled for this session:
1. Call discover_tools to find the original task tool by name, preset, risk, and summary.
2. Call select_toolset with exactly one preset or explicit tool list; risky explicit tools require opt-in.
3. When client_refresh_required is true, refresh tools/list before continuing because client visibility may lag.
4. Call the original discovered tool after it appears in the refreshed list.

If the client cannot refresh dynamic tools, set a static TDMCP_TOOL_PROFILE and restart the server.`;

export type TdmcpServerOverrides = ToolContextOverrides;

/** Builds a fully wired (but not yet connected) MCP server. */
export function createTdmcpServer(
  config: TdmcpConfig,
  overrides: TdmcpServerOverrides = {},
): McpServer {
  const ctx = buildToolContext(config, overrides);
  const { knowledge, recipes, logger } = ctx;

  const server = new McpServer(
    { name: "tdmcp", version: getVersion() },
    {
      capabilities: { logging: {} },
      instructions: ctx.dynamicToolsets ? DYNAMIC_TOOLSET_INSTRUCTIONS : INSTRUCTIONS,
    },
  );

  // Wire the LLM shim now that the underlying Server exists. Sampling capability
  // is probed on first method call (post-initialize) — no `sampling` server
  // capability declared. Eager resolution here would race the MCP handshake and
  // always fall through to LlmClient because getClientCapabilities() is empty
  // before the client's initialize request arrives.
  ctx.llm = createLazyLlmClient(config, server.server);

  const toolsets = ctx.dynamicToolsets
    ? new ToolsetManager({
        server,
        startupProfile: ctx.toolProfile ?? "full",
        maxActive: ctx.toolMaxActive ?? 120,
        metadataBudgetBytes: ctx.toolMetadataBudgetBytes ?? 256 * 1024,
        allowRawPython: ctx.allowRawPython !== false,
      })
    : undefined;

  // Expose session-local dependencies before registration. Dynamic mode captures
  // every native handle, then initializes the requested startup profile before
  // resources or prompts can observe the server.
  ctx.toolsets = toolsets;
  ctx.server = server;
  registerAllTools(server, ctx, {
    dynamic: ctx.dynamicToolsets === true,
    macroRecorder: getMacroRecorder(),
    onRegistered: (entry) => toolsets?.capture(entry),
  });
  toolsets?.initialize();
  registerAllResources(server, {
    knowledge,
    recipes,
    logger,
    client: ctx.client,
    creativeRag: ctx.creativeRag,
    projectRag: ctx.projectRag,
  });
  registerAllPrompts(server, {
    knowledge,
    recipes,
    logger,
    creativeRag: ctx.creativeRag,
    projectRag: ctx.projectRag,
  });

  // Defer the stats log to after we return so the heavy knowledge-base warmup
  // doesn't gate the transport from accepting connections. The version is cheap
  // (cached) so we log it inline; the rest is fire-and-forget.
  logger.info("tdmcp server initializing", { version: getVersion() });
  setImmediate(() => {
    logger.info("tdmcp server ready", {
      knowledge: knowledge.stats(),
      recipes: recipes.list().length,
    });
  });

  return server;
}
