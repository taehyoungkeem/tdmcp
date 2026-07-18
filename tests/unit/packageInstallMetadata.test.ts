import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  pnpm?: unknown;
  version: string;
}

interface PnpmWorkspace {
  autoInstallPeers?: boolean;
  overrides?: Record<string, string>;
  onlyBuiltDependencies?: string[];
  allowBuilds?: Record<string, boolean>;
}

interface WorkflowStep {
  run?: string;
  uses?: string;
}

interface WorkflowJob {
  env?: Record<string, string>;
  needs?: string | string[];
  steps?: WorkflowStep[];
}

interface Workflow {
  jobs?: Record<string, WorkflowJob>;
}

const installScriptGateName = "install-script-allowlist";
const installScriptGateCommand = "node scripts/check-install-script-allowlist.mjs";
const installScriptGateResultExpression = "$" + "{{ needs.install-script-allowlist.result }}";
const installScriptGateLoopEntry = '"install-script-allowlist=$' + '{INSTALL_SCRIPT_ALLOWLIST}"';
const npmCiPattern = /\bnpm\s+ci\b/;
const workflowsDirectory = join(root, ".github", "workflows");

function readRootPackageJson(): PackageJson {
  return JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as PackageJson;
}

function readPnpmWorkspace(): PnpmWorkspace {
  return parseYaml(readFileSync(join(root, "pnpm-workspace.yaml"), "utf8")) as PnpmWorkspace;
}

function readWorkflow(fileName: string): Workflow {
  return parseYaml(readFileSync(join(workflowsDirectory, fileName), "utf8")) as Workflow;
}

function normalizedNeeds(job: WorkflowJob | undefined): string[] {
  if (typeof job?.needs === "string") return [job.needs];
  return Array.isArray(job?.needs) ? job.needs : [];
}

function runsNpmCi(job: WorkflowJob): boolean {
  return job.steps?.some((step) => npmCiPattern.test(step.run ?? "")) ?? false;
}

describe("package install metadata", () => {
  it("keeps hosted pnpm installs off known warning paths", () => {
    const packageJson = readRootPackageJson();
    const pnpmWorkspace = readPnpmWorkspace();

    expect(packageJson.dependencies).not.toHaveProperty("shader-park-core");
    expect(packageJson.pnpm).toBeUndefined();
    expect(packageJson.devDependencies).toHaveProperty("search-insights", "^2.17.3");
    expect(packageJson.peerDependencies).toMatchObject({
      "shader-park-core": "^0.2.8",
    });
    expect(packageJson.peerDependenciesMeta).toMatchObject({
      "shader-park-core": { optional: true },
    });
    expect(pnpmWorkspace.overrides).toMatchObject({
      "@bottobot/td-mcp>cheerio": "1.0.0-rc.12",
      vite: "6.4.3",
    });
    expect(pnpmWorkspace.onlyBuiltDependencies).toEqual(["esbuild", "msw"]);
    expect(pnpmWorkspace.allowBuilds).toEqual({ esbuild: true, msw: true });
    expect(pnpmWorkspace.autoInstallPeers).toBe(false);
  });

  it("keeps bridge stale-detection versions synced to the package version", () => {
    const packageJson = readRootPackageJson();
    const bridgeVersionPy = readFileSync(join(root, "td/modules/utils/version.py"), "utf8");
    const getTdInfoTs = readFileSync(join(root, "src/tools/layer3/getTdInfo.ts"), "utf8");

    expect(bridgeVersionPy).toContain(`BRIDGE_VERSION = "${packageJson.version}"`);
    expect(getTdInfoTs).toContain(`EXPECTED_BRIDGE_VERSION = "${packageJson.version}"`);
  });

  it("gates every GitHub Actions npm ci job behind the exact no-install checker", () => {
    const violations: string[] = [];
    let installingJobCount = 0;
    const workflowFiles = readdirSync(workflowsDirectory)
      .filter((fileName) => fileName.endsWith(".yml") || fileName.endsWith(".yaml"))
      .sort();

    for (const fileName of workflowFiles) {
      const jobs = readWorkflow(fileName).jobs ?? {};
      const installingJobs = Object.entries(jobs).filter(([, job]) => runsNpmCi(job));
      if (installingJobs.length === 0) continue;
      installingJobCount += installingJobs.length;

      const gate = jobs[installScriptGateName];
      if (!gate) {
        violations.push(`${fileName}: missing ${installScriptGateName} job`);
      } else {
        const gateRunCommands = (gate.steps ?? [])
          .map((step) => step.run)
          .filter((command): command is string => command !== undefined);
        if (gateRunCommands.length !== 1 || gateRunCommands[0] !== installScriptGateCommand) {
          violations.push(
            `${fileName}: ${installScriptGateName} must run only ${installScriptGateCommand}`,
          );
        }
        const gateUses = (gate.steps ?? [])
          .map((step) => step.uses)
          .filter((uses): uses is string => uses !== undefined);
        if (
          gate.steps?.length !== 2 ||
          gateUses.length !== 1 ||
          !gateUses[0]?.startsWith("actions/checkout@")
        ) {
          violations.push(
            `${fileName}: ${installScriptGateName} must contain only checkout and the checker`,
          );
        }
      }

      for (const [jobName, job] of installingJobs) {
        if (!normalizedNeeds(job).includes(installScriptGateName)) {
          violations.push(`${fileName}:${jobName} must need ${installScriptGateName}`);
        }
      }
    }

    expect(installingJobCount).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });

  it("keeps the code-quality success aggregator fail-closed on the install-script gate", () => {
    const success = readWorkflow("code-quality.yml").jobs?.["code-quality-success"];

    expect(normalizedNeeds(success)).toContain(installScriptGateName);
    expect(success?.env?.INSTALL_SCRIPT_ALLOWLIST).toBe(installScriptGateResultExpression);
    expect((success?.steps ?? []).map((step) => step.run ?? "").join("\n")).toContain(
      installScriptGateLoopEntry,
    );
  });
});
