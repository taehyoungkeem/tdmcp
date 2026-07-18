import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const CONFORMANCE_VERSION = "0.2.0-alpha.9";
const SPEC_VERSION = "2025-11-25";
const READINESS_TIMEOUT_MS = 15_000;
const CONFORMANCE_TIMEOUT_MS = 120_000;
const SERVER_TERMINATION_GRACE_MS = 5_000;
const CHILD_TERMINATION_GRACE_MS = 2_000;
const STATUS_VALUES = new Set(["SUCCESS", "FAILURE", "WARNING", "SKIPPED", "INFO"]);

const EXPECTED_FAILURE_SCENARIOS = [
  "completion-complete",
  "tools-call-image",
  "tools-call-mixed-content",
  "tools-call-with-logging",
  "tools-call-with-progress",
  "tools-call-sampling",
  "tools-call-elicitation",
  "tools-call-audio",
  "tools-call-embedded-resource",
  "elicitation-sep1034-defaults",
  "elicitation-sep1330-enums",
  "resources-read-text",
  "resources-read-binary",
  "resources-templates-read",
  "resources-subscribe",
  "resources-unsubscribe",
  "prompts-get-simple",
  "prompts-get-with-args",
  "prompts-get-embedded-resource",
  "prompts-get-with-image",
];

const EXPECTED_PASS_SCENARIOS = [
  "server-initialize",
  "logging-set-level",
  "ping",
  "tools-list",
  "tools-call-simple-text",
  "tools-call-error",
  "server-sse-multiple-streams",
  "resources-list",
  "prompts-list",
  "dns-rebinding-protection",
];

const ACTIVE_SCENARIOS = [...EXPECTED_PASS_SCENARIOS, ...EXPECTED_FAILURE_SCENARIOS];
const auditUnbaselined = process.argv.slice(2).includes("--audit-unbaselined");
const unexpectedArguments = process.argv
  .slice(2)
  .filter((argument) => argument !== "--audit-unbaselined");
assert.deepEqual(unexpectedArguments, [], `Unknown arguments: ${unexpectedArguments.join(", ")}`);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = resolve(repoRoot, "dist/index.js");
const conformanceBinary = resolve(repoRoot, "node_modules/.bin/conformance");
const conformancePackagePath = resolve(
  repoRoot,
  "node_modules/@modelcontextprotocol/conformance/package.json",
);
const baselinePath = resolve(repoRoot, "tests/contract/conformance-expected-failures.yml");
const outputDirectory = resolve(repoRoot, "artifacts/mcp-conformance");
const summaryPath = resolve(outputDirectory, "summary.json");

function assertPinnedInputs() {
  assert.ok(existsSync(serverPath), `Built MCP server not found: ${serverPath}`);
  assert.ok(
    existsSync(conformanceBinary),
    `Pinned Conformance binary not found: ${conformanceBinary}`,
  );
  const packageManifest = JSON.parse(readFileSync(conformancePackagePath, "utf8"));
  assert.equal(
    packageManifest.version,
    CONFORMANCE_VERSION,
    `Expected @modelcontextprotocol/conformance ${CONFORMANCE_VERSION}`,
  );
  assert.equal(packageManifest.bin?.conformance, "dist/index.js");
}

function assertFixtureBaseline() {
  const document = parseYaml(readFileSync(baselinePath, "utf8"));
  assert.ok(document && typeof document === "object" && !Array.isArray(document));
  assert.deepEqual(Object.keys(document), ["server"]);
  assert.ok(Array.isArray(document.server), "Expected a server scenario baseline array");
  assert.equal(document.server.length, 20, "Expected exactly 20 baseline scenarios");
  assert.equal(new Set(document.server).size, 20, "Baseline scenarios must be unique");
  assert.deepEqual(document.server, EXPECTED_FAILURE_SCENARIOS);
}

async function reserveLoopbackPort() {
  const probe = createServer();
  await new Promise((resolveListen, rejectListen) => {
    probe.once("error", rejectListen);
    probe.listen(0, "127.0.0.1", resolveListen);
  });
  const address = probe.address();
  assert.ok(address && typeof address === "object", "Loopback port probe did not bind");
  await new Promise((resolveClose, rejectClose) => {
    probe.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
  return address.port;
}

function cleanServerEnvironment(port) {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (name.startsWith("TDMCP_")) delete environment[name];
  }

  const configPath = resolve(tmpdir(), `tdmcp-conformance-${randomUUID()}.json`);
  assert.equal(
    existsSync(configPath),
    false,
    `Temporary config path already exists: ${configPath}`,
  );
  return {
    ...environment,
    TDMCP_CONFIG_FILE: configPath,
    TDMCP_TRANSPORT: "http",
    TDMCP_HTTP_HOST: "127.0.0.1",
    TDMCP_HTTP_PORT: String(port),
    TDMCP_TOOL_PROFILE: "core",
    TDMCP_DYNAMIC_TOOLSETS: "on",
    TDMCP_LOG_LEVEL: "silent",
    TDMCP_EVENTS: "off",
    TDMCP_RAW_PYTHON: "off",
  };
}

function captureChild(child) {
  const output = { stdout: "", stderr: "" };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output.stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output.stderr += chunk;
  });
  return output;
}

function isChildAlive(child) {
  return child.exitCode === null && child.signalCode === null;
}

function waitForChildClose(child, timeoutMs) {
  if (!isChildAlive(child)) return Promise.resolve(true);
  return new Promise((resolveWait) => {
    const onClose = () => {
      clearTimeout(timer);
      resolveWait(true);
    };
    const timer = setTimeout(() => {
      child.off("close", onClose);
      resolveWait(false);
    }, timeoutMs);
    child.once("close", onClose);
  });
}

function killRecordedProcess(pid) {
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function terminateRecordedChild(child, graceMs) {
  const pid = child?.pid;
  const cleanup = { pid: pid ?? null, wasRunning: false, forced: false, closed: true };
  if (!child || !pid || !isChildAlive(child)) return cleanup;

  cleanup.wasRunning = true;
  child.kill("SIGTERM");
  if (await waitForChildClose(child, graceMs)) return cleanup;

  cleanup.forced = true;
  killRecordedProcess(pid);
  cleanup.closed = await waitForChildClose(child, CHILD_TERMINATION_GRACE_MS);
  return cleanup;
}

function spawnServer(port) {
  const child = spawn(process.execPath, [serverPath], {
    cwd: repoRoot,
    env: cleanServerEnvironment(port),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const server = { child, output: captureChild(child), spawnError: null };
  child.once("error", (error) => {
    server.spawnError = error;
  });
  return server;
}

async function waitForReady(url, server) {
  const deadline = Date.now() + READINESS_TIMEOUT_MS;
  let lastError;
  while (Date.now() < deadline) {
    if (server.spawnError) {
      throw new Error(`Failed to spawn MCP server: ${server.spawnError.message}`);
    }
    if (!isChildAlive(server.child)) {
      throw new Error(
        `MCP server exited before readiness (code ${server.child.exitCode}, signal ${server.child.signalCode ?? "none"})\n` +
          `stderr:\n${server.output.stderr}\nstdout:\n${server.output.stdout}`,
      );
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      const body = await response.json();
      assert.equal(
        response.status,
        400,
        `Expected no-session readiness status 400, got ${response.status}`,
      );
      assert.deepEqual(body, { error: "Unknown or missing mcp-session-id." });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
  }
  throw new Error(
    `MCP server was not ready within ${READINESS_TIMEOUT_MS}ms: ${lastError?.message ?? "no response"}\n` +
      `stderr:\n${server.output.stderr}\nstdout:\n${server.output.stdout}`,
  );
}

function runConformance(url) {
  const argumentsAfterBinary = [
    "server",
    "--url",
    url,
    "--suite",
    "active",
    "--spec-version",
    SPEC_VERSION,
    ...(auditUnbaselined ? [] : ["--expected-failures", baselinePath]),
    "--output-dir",
    outputDirectory,
  ];
  const child = spawn(process.execPath, [conformanceBinary, ...argumentsAfterBinary], {
    cwd: repoRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = captureChild(child);

  const completion = new Promise((resolveRun, rejectRun) => {
    let timedOut = false;
    let forceKillTimer;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (!isChildAlive(child) || !child.pid) return;
        try {
          process.kill(child.pid, "SIGKILL");
        } catch (error) {
          if (error?.code !== "ESRCH") rejectRun(error);
        }
      }, CHILD_TERMINATION_GRACE_MS);
    }, CONFORMANCE_TIMEOUT_MS);

    const clearTimers = () => {
      clearTimeout(timeout);
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
    };

    child.once("error", (error) => {
      clearTimers();
      rejectRun(new Error(`Failed to spawn pinned Conformance CLI: ${error.message}`));
    });
    child.once("close", (code, signal) => {
      clearTimers();
      resolveRun({
        code,
        signal: signal ?? null,
        timedOut,
        stdout: output.stdout,
        stderr: output.stderr,
        arguments: argumentsAfterBinary,
      });
    });
  });

  return { child, completion };
}

function findChecksFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...findChecksFiles(path));
    else if (entry.isFile() && entry.name === "checks.json") files.push(path);
  }
  return files.sort();
}

function scenarioFromChecksPath(checksPath) {
  const directoryName = basename(dirname(checksPath));
  const match = directoryName.match(/^server-(.+)-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/);
  assert.ok(match, `Unexpected checks.json directory: ${directoryName}`);
  return match[1];
}

function assertCheck(check, checksPath) {
  assert.ok(check && typeof check === "object" && !Array.isArray(check), `${checksPath}: check`);
  for (const field of ["id", "name", "description", "status", "timestamp"]) {
    assert.equal(typeof check[field], "string", `${checksPath}: ${field} must be a string`);
    assert.ok(check[field].length > 0, `${checksPath}: ${field} must not be empty`);
  }
  assert.ok(STATUS_VALUES.has(check.status), `${checksPath}: invalid status ${check.status}`);
  assert.ok(Number.isFinite(Date.parse(check.timestamp)), `${checksPath}: invalid timestamp`);
  assert.ok(Array.isArray(check.specReferences), `${checksPath}: specReferences must be an array`);
  for (const reference of check.specReferences) {
    assert.equal(typeof reference?.id, "string", `${checksPath}: spec reference id`);
    assert.equal(typeof reference?.url, "string", `${checksPath}: spec reference url`);
  }
}

function countStatuses(checks) {
  const counts = Object.fromEntries([...STATUS_VALUES].map((status) => [status, 0]));
  for (const check of checks) counts[check.status] += 1;
  return counts;
}

function readScenarioResult(checksPath, scenario) {
  const checks = JSON.parse(readFileSync(checksPath, "utf8"));
  assert.ok(Array.isArray(checks), `${checksPath}: expected a top-level array`);
  assert.ok(checks.length > 0, `${checksPath}: expected at least one check`);
  for (const check of checks) assertCheck(check, checksPath);
  return {
    scenario,
    baseline: EXPECTED_FAILURE_SCENARIOS.includes(scenario),
    checksFile: relative(repoRoot, checksPath),
    countsByStatus: countStatuses(checks),
    checks,
  };
}

function collectScenarioResults() {
  const checksFiles = findChecksFiles(outputDirectory);
  assert.equal(checksFiles.length, 30, "Expected exactly 30 recursive checks.json files");

  const resultByScenario = new Map();
  for (const checksPath of checksFiles) {
    const scenario = scenarioFromChecksPath(checksPath);
    assert.ok(ACTIVE_SCENARIOS.includes(scenario), `Unexpected active scenario: ${scenario}`);
    assert.equal(resultByScenario.has(scenario), false, `Duplicate scenario result: ${scenario}`);
    const result = readScenarioResult(checksPath, scenario);
    resultByScenario.set(result.scenario, result);
  }

  assert.equal(resultByScenario.size, 30, "Expected exactly 30 unique scenario results");
  assert.deepEqual(
    [...resultByScenario.keys()].sort(),
    [...ACTIVE_SCENARIOS].sort(),
    "Executed active scenarios differ from the pinned 30-scenario contract",
  );
  return resultByScenario;
}

function reconcileExpectedFailures(resultByScenario) {
  const baselineExecuted = [];
  const baselineFailed = [];
  const baselineStale = [];
  for (const scenario of EXPECTED_FAILURE_SCENARIOS) {
    const result = resultByScenario.get(scenario);
    if (result) baselineExecuted.push(scenario);
    if (result?.countsByStatus.FAILURE > 0) baselineFailed.push(scenario);
    else baselineStale.push(scenario);
  }
  return { executed: baselineExecuted, failed: baselineFailed, stale: baselineStale };
}

function isCleanScenarioResult(result) {
  return (
    result !== undefined &&
    result.countsByStatus.SUCCESS > 0 &&
    result.countsByStatus.FAILURE === 0 &&
    result.countsByStatus.WARNING === 0
  );
}

function reconcileExpectedPasses(resultByScenario) {
  const nonBaselineClean = [];
  const nonBaselineFailures = [];
  for (const scenario of EXPECTED_PASS_SCENARIOS) {
    const result = resultByScenario.get(scenario);
    if (isCleanScenarioResult(result)) nonBaselineClean.push(scenario);
    else nonBaselineFailures.push(scenario);
  }
  return { clean: nonBaselineClean, failedOrWarning: nonBaselineFailures };
}

function assertReconciliation(baseline, nonBaseline) {
  assert.equal(baseline.executed.length, 20, "Every baseline scenario must execute");
  assert.equal(baseline.failed.length, 20, "Every baseline scenario must contain a real failure");
  assert.deepEqual(baseline.stale, [], "Passing or non-failing baseline entries are stale");
  assert.equal(nonBaseline.clean.length, 10, "All ten non-baseline scenarios must pass cleanly");
  assert.deepEqual(
    nonBaseline.failedOrWarning,
    [],
    "Non-baseline scenarios must have SUCCESS and no FAILURE or WARNING",
  );
}

function analyzeResults() {
  const resultByScenario = collectScenarioResults();
  const baseline = reconcileExpectedFailures(resultByScenario);
  const nonBaseline = reconcileExpectedPasses(resultByScenario);
  assertReconciliation(baseline, nonBaseline);

  const allChecks = [...resultByScenario.values()].flatMap((result) => result.checks);
  const countsByStatus = countStatuses(allChecks);
  assert.equal(countsByStatus.FAILURE, 20, "Expected exactly 20 explained failure checks");
  assert.equal(countsByStatus.WARNING, 0, "Active Conformance results must contain no warnings");
  return {
    countsByStatus,
    scenarios: ACTIVE_SCENARIOS.map((scenario) => resultByScenario.get(scenario)),
    reconciliation: {
      baseline: {
        expected: EXPECTED_FAILURE_SCENARIOS,
        ...baseline,
        unexecuted: EXPECTED_FAILURE_SCENARIOS.filter(
          (scenario) => !baseline.executed.includes(scenario),
        ),
      },
      nonBaseline: {
        expected: EXPECTED_PASS_SCENARIOS,
        ...nonBaseline,
        unexecuted: EXPECTED_PASS_SCENARIOS.filter((scenario) => !resultByScenario.has(scenario)),
      },
    },
  };
}

async function writeSummary(summary) {
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}

function createSummary() {
  return {
    status: "running",
    mode: auditUnbaselined ? "audit-unbaselined" : "reconciled",
    verifier: {
      package: "@modelcontextprotocol/conformance",
      version: CONFORMANCE_VERSION,
      specVersion: SPEC_VERSION,
      binary: relative(repoRoot, conformanceBinary),
    },
    expected: { scenarios: 30, baseline: 20, nonBaseline: 10 },
    server: null,
    cli: null,
    countsByStatus: null,
    scenarios: [],
    reconciliation: null,
    cleanup: { conformance: null, server: null },
    error: null,
  };
}

async function prepareOutputDirectory() {
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
}

async function writeRunnerOutput(cli) {
  await writeFile(resolve(outputDirectory, "runner.stdout.txt"), cli.stdout, "utf8");
  await writeFile(resolve(outputDirectory, "runner.stderr.txt"), cli.stderr, "utf8");
}

function recordCliSummary(summary, cli) {
  summary.cli = {
    exitCode: cli.code,
    signal: cli.signal,
    timedOut: cli.timedOut,
    arguments: cli.arguments,
  };
}

function recordAnalysis(summary, analysis) {
  summary.countsByStatus = analysis.countsByStatus;
  summary.scenarios = analysis.scenarios;
  summary.reconciliation = analysis.reconciliation;
}

function assertCliOutcome(summary, cli) {
  if (auditUnbaselined) {
    assert.equal(cli.code, 1, "Unbaselined audit must exit 1 for the 20 fixture failures");
    summary.status = "audit-verified";
    process.exitCode = cli.code ?? 1;
    return;
  }
  assert.equal(cli.code, 0, `Reconciled Conformance CLI exited with code ${cli.code}`);
  summary.status = "passed";
}

async function executeConformanceRun(summary, state) {
  assertPinnedInputs();
  assertFixtureBaseline();
  const port = await reserveLoopbackPort();
  const url = `http://127.0.0.1:${port}/mcp`;
  state.server = spawnServer(port);
  summary.server = { pid: state.server.child.pid ?? null, url, ready: false };
  await waitForReady(url, state.server);
  summary.server.ready = true;

  state.conformance = runConformance(url);
  const cli = await state.conformance.completion;
  await writeRunnerOutput(cli);
  recordCliSummary(summary, cli);
  assert.equal(cli.timedOut, false, `Conformance timed out after ${CONFORMANCE_TIMEOUT_MS}ms`);
  assert.equal(cli.signal, null, `Conformance exited on signal ${cli.signal}`);
  recordAnalysis(summary, analyzeResults());
  assertCliOutcome(summary, cli);
}

function inactiveCleanup(child) {
  return {
    pid: child?.pid ?? null,
    wasRunning: false,
    forced: false,
    closed: true,
  };
}

async function cleanupConformance(conformance) {
  if (conformance && isChildAlive(conformance.child)) {
    return terminateRecordedChild(conformance.child, CHILD_TERMINATION_GRACE_MS);
  }
  return inactiveCleanup(conformance?.child);
}

async function cleanupRun(summary, state) {
  summary.cleanup.conformance = await cleanupConformance(state.conformance);
  summary.cleanup.server = await terminateRecordedChild(
    state.server?.child,
    SERVER_TERMINATION_GRACE_MS,
  );
  await writeSummary(summary);
}

function recordFailure(summary, error) {
  summary.status = "failed";
  summary.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
}

async function main() {
  await prepareOutputDirectory();
  const summary = createSummary();
  const state = { server: undefined, conformance: undefined };
  let pendingError;
  try {
    await executeConformanceRun(summary, state);
  } catch (error) {
    pendingError = error;
    recordFailure(summary, error);
  } finally {
    await cleanupRun(summary, state);
  }

  if (pendingError) throw pendingError;
  const modeLabel = auditUnbaselined ? "unbaselined audit" : "reconciled run";
  console.log(`MCP Conformance ${modeLabel}: 30 scenarios, 10 clean passes, 20 fixture failures.`);
}

await main();
