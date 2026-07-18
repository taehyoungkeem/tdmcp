import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const INSPECTOR_VERSION = "0.22.0";
const PROBE_TIMEOUT_MS = 30_000;
const TERMINATION_GRACE_MS = 1_000;
const MANAGEMENT_TOOL_NAMES = [
  "discover_tools",
  "select_toolset",
  "get_active_toolset",
  "reset_toolset",
];
const PROTECTED_CORE_TOOL_NAMES = [
  "get_td_info",
  ...MANAGEMENT_TOOL_NAMES,
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
];
const SELECTABLE_PRESETS = ["core", "inspect", "build", "show", "library", "safe", "directory"];

const inspector = resolve("node_modules/.bin/mcp-inspector-cli");
const server = resolve(process.env.TDMCP_INSPECTOR_SERVER ?? "dist/index.js");
const inspectorPackagePath = resolve(
  "node_modules/@modelcontextprotocol/inspector-cli/package.json",
);
const inspectorPackage = JSON.parse(readFileSync(inspectorPackagePath, "utf8"));
assert.equal(
  inspectorPackage.version,
  INSPECTOR_VERSION,
  `Expected @modelcontextprotocol/inspector-cli ${INSPECTOR_VERSION}`,
);
assert.equal(inspectorPackage.bin?.["mcp-inspector-cli"], "build/cli.js");
assert.ok(existsSync(inspector), `Pinned Inspector binary not found: ${inspector}`);
assert.ok(existsSync(server), `Built MCP server not found: ${server}`);

const inspectorBuildDirectory = resolve(dirname(inspectorPackagePath), "build");
// inspector-cli 0.22.0 checks ../package.json against process.cwd() before importing
// that path relative to build/index.js. Running from its packaged build directory
// keeps both paths on the audited manifest. The exact-version guard above prevents
// this packaging workaround from silently carrying forward when the pin changes.
assert.ok(existsSync(resolve(inspectorBuildDirectory, "index.js")));

const configPath = resolve(tmpdir(), `tdmcp-inspector-${randomUUID()}.json`);
assert.equal(existsSync(configPath), false, `Temporary config path already exists: ${configPath}`);
const env = {
  ...process.env,
  TDMCP_CONFIG_FILE: configPath,
  TDMCP_TOOL_PROFILE: "core",
  TDMCP_DYNAMIC_TOOLSETS: "on",
  TDMCP_LOG_LEVEL: "silent",
  TDMCP_TRANSPORT: "stdio",
  TDMCP_EVENTS: "off",
  TDMCP_RAW_PYTHON: "off",
};
delete env.TDMCP_PROFILE;

function invokeInspector(label, args) {
  return new Promise((resolveProbe, rejectProbe) => {
    const child = spawn(inspector, ["--cli", process.execPath, server, ...args], {
      cwd: inspectorBuildDirectory,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let forceKillTimer;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, TERMINATION_GRACE_MS);
    }, PROBE_TIMEOUT_MS);

    const clearTimers = () => {
      clearTimeout(timer);
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
    };

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimers();
      rejectProbe(new Error(`${label}: failed to spawn pinned Inspector: ${error.message}`));
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimers();
      if (timedOut) {
        rejectProbe(
          new Error(
            `${label}: timed out after ${PROBE_TIMEOUT_MS}ms\nstderr:\n${stderr}\nstdout:\n${stdout}`,
          ),
        );
        return;
      }
      if (code !== 0) {
        rejectProbe(
          new Error(
            `${label}: Inspector exited with code ${code} signal ${signal ?? "none"}\nstderr:\n${stderr}\nstdout:\n${stdout}`,
          ),
        );
        return;
      }

      try {
        // Parsing the complete stdout in one operation rejects empty output,
        // multiple JSON values, banners, and any other non-whitespace output.
        resolveProbe(JSON.parse(stdout));
      } catch (error) {
        rejectProbe(
          new Error(
            `${label}: stdout was not exactly one JSON payload: ${error.message}\nstderr:\n${stderr}\nstdout:\n${stdout}`,
          ),
        );
      }
    });
  });
}

function findManagementTool(tools, name) {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `Missing management tool: ${name}`);
  return tool;
}

function assertManagementToolSchema(tool) {
  assert.equal(tool.inputSchema?.type, "object", `${tool.name} input must be a root object`);
  assert.equal(tool.outputSchema?.type, "object", `${tool.name} output must be a root object`);
  assert.deepEqual(tool.outputSchema?.required, ["ok"], `${tool.name} must require ok`);
  assert.equal(
    tool.outputSchema?.additionalProperties,
    false,
    `${tool.name} output must reject unknown fields`,
  );
  assert.equal(tool.annotations?.destructiveHint, false);
  assert.equal(tool.annotations?.openWorldHint, false);
}

function assertDiscoverSchema(discover) {
  assert.deepEqual(discover.inputSchema?.required, ["query"]);
  assert.equal(discover.outputSchema?.properties?.candidates?.type, "array");
}

function assertSelectSchema(select) {
  const presets = select.inputSchema?.properties?.preset?.enum;
  assert.deepEqual(presets, SELECTABLE_PRESETS);
  assert.equal(presets.includes("full"), false);
}

function assertEmptyInputSchema(tool) {
  assert.deepEqual(tool.inputSchema?.properties, {});
}

function assertManagementSchemas(tools) {
  const managementTools = tools.filter((tool) => MANAGEMENT_TOOL_NAMES.includes(tool.name));
  assert.deepEqual(
    managementTools.map((tool) => tool.name).sort(),
    [...MANAGEMENT_TOOL_NAMES].sort(),
  );

  for (const tool of managementTools) assertManagementToolSchema(tool);
  assertDiscoverSchema(findManagementTool(managementTools, "discover_tools"));
  assertSelectSchema(findManagementTool(managementTools, "select_toolset"));

  for (const name of ["get_active_toolset", "reset_toolset"]) {
    assertEmptyInputSchema(findManagementTool(managementTools, name));
  }
}

const toolsResult = await invokeInspector("tools/list", ["--method", "tools/list"]);
assert.ok(Array.isArray(toolsResult.tools), "tools/list must return a tools array");
assert.deepEqual(
  toolsResult.tools.map((tool) => tool.name).sort(),
  [...PROTECTED_CORE_TOOL_NAMES].sort(),
);
assert.equal(toolsResult.tools.length, 17);
for (const tool of toolsResult.tools) {
  assert.equal(tool.inputSchema?.type, "object", `${tool.name} input must be a root object`);
}
assertManagementSchemas(toolsResult.tools);

const active = await invokeInspector("get_active_toolset", [
  "--method",
  "tools/call",
  "--tool-name",
  "get_active_toolset",
]);
assert.notEqual(active.isError, true);
assert.equal(active.structuredContent?.ok, true);
assert.equal(active.structuredContent?.startup_profile, "core");
assert.equal(active.structuredContent?.current_profile, "core");
assert.equal(active.structuredContent?.dynamic_toolsets, true);
assert.equal(active.structuredContent?.active_count, 17);
assert.deepEqual(
  [...active.structuredContent.active_tools].sort(),
  [...PROTECTED_CORE_TOOL_NAMES].sort(),
);
assert.deepEqual(
  [...active.structuredContent.protected_core].sort(),
  [...PROTECTED_CORE_TOOL_NAMES].sort(),
);

const discovery = await invokeInspector("discover_tools", [
  "--method",
  "tools/call",
  "--tool-name",
  "discover_tools",
  "--tool-arg",
  "query=오디오_반응형",
]);
assert.notEqual(discovery.isError, true);
assert.equal(discovery.structuredContent?.ok, true);
assert.ok(Array.isArray(discovery.structuredContent?.candidates));
assert.ok(
  discovery.structuredContent.candidates.some((item) => item.name === "create_audio_reactive"),
  "discover_tools must rank create_audio_reactive for the Korean audio-reactive query",
);

const resources = await invokeInspector("resources/list", ["--method", "resources/list"]);
assert.ok(Array.isArray(resources.resources));
assert.ok(resources.resources.length > 0, "resources/list must remain available");

const prompts = await invokeInspector("prompts/list", ["--method", "prompts/list"]);
assert.ok(Array.isArray(prompts.prompts));
assert.ok(prompts.prompts.length > 0, "prompts/list must remain available");

console.log("MCP Inspector contract passed: 5 independent probes, 17 protected core tools.");
