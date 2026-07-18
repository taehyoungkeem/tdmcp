import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = resolve(repositoryRoot, "package.json");
const packageLockPath = resolve(repositoryRoot, "package-lock.json");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const packageLock = JSON.parse(readFileSync(packageLockPath, "utf8"));

function requireRecord(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object`);
  }
  return value;
}

const lockPackages = requireRecord(packageLock.packages, "package-lock.json#packages");
const allowScripts = requireRecord(packageJson.allowScripts, "package.json#allowScripts");
for (const [packageName, enabled] of Object.entries(allowScripts)) {
  if (typeof enabled !== "boolean") {
    throw new TypeError(`package.json#allowScripts.${packageName} must be a boolean`);
  }
}

function packageNameFromLockPath(lockPath) {
  const marker = "node_modules/";
  const markerIndex = lockPath.lastIndexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`Cannot derive a package name from lockfile path: ${lockPath}`);
  }

  const segments = lockPath.slice(markerIndex + marker.length).split("/");
  if (segments[0]?.startsWith("@")) {
    if (!segments[1]) {
      throw new Error(`Cannot derive a scoped package name from lockfile path: ${lockPath}`);
    }
    return `${segments[0]}/${segments[1]}`;
  }

  if (!segments[0]) {
    throw new Error(`Cannot derive a package name from lockfile path: ${lockPath}`);
  }
  return segments[0];
}

const installScriptEntries = [];
const installScriptPackages = new Set();
for (const [lockPath, metadata] of Object.entries(lockPackages)) {
  requireRecord(metadata, `package-lock.json#packages[${JSON.stringify(lockPath)}]`);
  if (metadata?.hasInstallScript === true) {
    const packageName = packageNameFromLockPath(lockPath);
    installScriptPackages.add(packageName);
    installScriptEntries.push({
      packageName,
      lockPath,
      version: metadata.version ?? "<missing>",
      integrity: metadata.integrity ?? "<missing>",
    });
  }
}

const missingOrDisabled = installScriptEntries
  .filter(({ packageName }) => allowScripts[packageName] !== true)
  .sort((left, right) => left.lockPath.localeCompare(right.lockPath));
const staleEnabled = Object.entries(allowScripts)
  .filter(([packageName, enabled]) => enabled === true && !installScriptPackages.has(packageName))
  .map(([packageName]) => packageName)
  .sort();

if (missingOrDisabled.length > 0 || staleEnabled.length > 0) {
  const details = [
    ...missingOrDisabled.map(
      ({ packageName, lockPath, version, integrity }) =>
        `missing or disabled: ${packageName} (${lockPath}, version=${version}, integrity=${integrity})`,
    ),
    ...staleEnabled.map((packageName) => `enabled without hasInstallScript: ${packageName}`),
  ];
  throw new Error(`Install-script allowlist drift detected:\n${details.join("\n")}`);
}

console.log(
  `Install-script allowlist verified for ${installScriptPackages.size} package(s): ${[
    ...installScriptPackages,
  ]
    .sort()
    .join(", ")}`,
);
