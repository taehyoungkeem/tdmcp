# Dynamic MCP Toolsets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give tdmcp a compact, bilingual, session-local MCP tool discovery and activation surface while preserving every existing tool contract and adding reproducible Inspector and Conformance evidence.

**Architecture:** Keep the 497 existing tools as native MCP tools and capture their public `RegisteredTool` lifecycle handles in one registration pipeline. A deterministic `ToolCatalog` searches generated metadata plus curated aliases, while a session-owned `ToolsetManager` validates risk and byte budgets before atomically enabling the selected native tools and emitting one `tools/list_changed` notification.

**Tech Stack:** Node.js 20.19+/22.x, TypeScript 6, Zod 4, `@modelcontextprotocol/sdk` v1.29.x, Vitest 4, Biome 2, MCP Inspector CLI 0.22.0, MCP Conformance 0.2.0-alpha.9, stateful Streamable HTTP.

## Global Constraints

- Keep `@modelcontextprotocol/sdk` on the production v1.x line; do not migrate to the v2 pre-alpha API in this work.
- Keep package defaults exactly `TDMCP_TOOL_PROFILE=full` and `TDMCP_DYNAMIC_TOOLSETS=off`.
- Static legacy `full`, `safe`, and `directory` must remain exactly 497, 458, and 15 tools.
- Dynamic `full`, `safe`, and `directory` must be exactly 501, 462, and 19 tools; dynamic `core` must be exactly 17 tools.
- Dynamic `core` must serialize to at most 65,536 bytes. Every ordinary dynamic preset must remain at most 120 tools and 262,144 bytes.
- The protected 17-tool core cannot be removed in dynamic mode.
- Presets never activate destructive or raw-code tools. A risky tool requires its exact name in `tools`, `include_risky: true`, and all existing environment gates.
- `TDMCP_RAW_PYTHON=off` remains authoritative even when `include_risky` is true.
- Do not add a generic invocation proxy, change an existing tool name/schema/annotation/handler, add embeddings, or add a runtime network dependency.
- Preserve the current stdio process-local state and the existing one-`McpServer`-per-HTTP-session isolation.
- Pin Inspector and Conformance exactly; do not use floating verifier packages in tests or CI.
- Record the exact reviewed upstream commit SHAs and package-declared licenses in provenance documentation.
- Preserve upstream license notices for copied source. Prefer adapting public patterns through local code over copying implementations.
- Do not modify, stage, delete, or commit the unrelated untracked `pnpm-lock.yaml`.
- Do not publish, tag, push, or open a pull request as part of this plan.
- TouchDesigner, GPU, camera, DMX, mixer, and venue checks stay `UNVERIFIED` unless they actually run.
- Run the repository's `tdmcp-quality-audit` fan-out/fan-in and QA gate before behavior edits.

---

## File Structure

### New runtime files

- `src/tools/toolsets/types.ts` — shared profile, catalog, discovery, selection, transition, and capture contracts.
- `src/tools/toolsets/profiles.ts` — protected core, static profile membership, legacy risk exclusions, and raw-code names.
- `src/tools/toolsets/overrides.ts` — curated English/Korean aliases and tags only.
- `src/tools/toolsets/catalog.ts` — normalization, deterministic ranking, close-match suggestions, and risk filtering.
- `src/tools/toolsets/metadata.ts` — generated-manifest lookup and exact serialized-list byte accounting.
- `src/tools/toolsets/toolMetadata.generated.ts` — committed generated per-tool byte sizes and schema fingerprints.
- `src/tools/toolsets/manager.ts` — session-local lifecycle handles, validation, serialized transitions, rollback, and one-notification batching.
- `src/tools/toolsets/errors.ts` — stable error codes and redacted structured details.
- `src/tools/toolsets/index.ts` — narrow public exports.
- `src/tools/registration.ts` — the single registration interception pipeline for macro wrapping, static filtering, real registration, and capture.
- `src/tools/util/discoverTools.ts` — `discover_tools` schema, implementation, and registrar.
- `src/tools/util/selectToolset.ts` — `select_toolset` schema, implementation, and registrar.
- `src/tools/util/getActiveToolset.ts` — `get_active_toolset` output and registrar.
- `src/tools/util/resetToolset.ts` — `reset_toolset` output and registrar.

### New generator, fixtures, and tests

- `scripts/gen-tool-metadata.ts` — writes or checks the deterministic metadata manifest and one-time legacy contract baseline.
- `scripts/test-mcp-inspector.mjs` — built-package stdio contract probes using the pinned local CLI.
- `scripts/test-mcp-conformance.mjs` — temporary loopback HTTP lifecycle, active-suite execution, result summary, and cleanup.
- `tests/fixtures/tool-contract-baseline.json` — immutable 497-tool name/fingerprint baseline captured before behavior changes.
- `tests/fixtures/tool-discovery-golden.json` — fixed Korean/English discovery cases.
- `tests/contract/conformance-expected-failures.yml` — scenario-level fixture mismatch baseline accepted by the upstream runner.
- `tests/contract/conformance-expected-failures.md` — spec basis, owner, and removal condition for every baseline entry.
- `tests/unit/toolMetadata.test.ts` — canonicalization, byte math, generated drift, and legacy baseline checks.
- `tests/unit/toolRegistration.test.ts` — consolidated interception, group capture, restoration, and static filtering.
- `tests/unit/toolProfiles.test.ts` — exact membership and risk invariants.
- `tests/unit/toolCatalog.test.ts` — normalization, ranking, ties, aliases, filtering, and suggestions.
- `tests/unit/toolsetManager.test.ts` — limits, risk gates, atomicity, rollback, reset, and notification count.
- `tests/unit/toolsetManagementTools.test.ts` — schemas, structured success/error results, and annotations.
- `tests/unit/result.test.ts` — structured MCP error-result shape.
- `tests/integration/dynamicToolsets.test.ts` — in-memory MCP list/call/notification/contract behavior.
- `tests/integration/httpDynamicToolsets.test.ts` — two-session isolation.
- `tests/eval/toolDiscoveryGolden.test.ts` — deterministic top-five bilingual evaluation.

### Existing files to modify

- `src/utils/config.ts`, `src/cli/configInit.ts`, `src/cli/doctor.ts`, `src/server/context.ts`, `src/tools/types.ts` — validated configuration and context wiring.
- `src/tools/registry.ts`, `src/tools/index.ts`, `src/tools/util/index.ts`, `src/server/tdmcpServer.ts` — grouped registration and manager ownership.
- `src/tools/result.ts` — structured `isError` helper.
- `tests/unit/config.test.ts`, `tests/unit/configInit.test.ts`, `tests/integration/toolProfile.test.ts`, `tests/integration/httpTransport.test.ts` — compatibility regression coverage.
- `package.json`, `package-lock.json` — scripts and exact dev-only verifier versions.
- `.github/workflows/ci.yml`, `.github/workflows/code-quality.yml`, `.gitignore` — contract jobs, generated drift, artifact upload, and ignored local results.
- `scripts/gen-tool-docs.ts`, `README.md`, `docs/reference/environment.md`, `docs/reference/architecture.md`, `mcpb/manifest.json`, `server.json`, `safeskill.manifest.json`, `CHANGELOG.md` — package, registry, and fallback documentation.
- `~/.codex/config.toml` — personal rollout only after all required offline checks pass; preserve all existing per-tool approval entries.

---

### Task 1: Run the Required Quality-Audit Baseline

**Files:**
- Create (ignored workspace): `_workspace/quality-audit/00_scope.md`
- Create (ignored workspace): `_workspace/quality-audit/01_commands.md`
- Create (ignored workspace): `_workspace/quality-audit/02_security.md`
- Create (ignored workspace): `_workspace/quality-audit/03_usability.md`
- Create (ignored workspace): `_workspace/quality-audit/04_refactor_tests.md`
- Create (ignored workspace): `_workspace/quality-audit/05_plan.md`
- Create (ignored workspace): `_workspace/quality-audit/06_qa.md`

**Interfaces:**
- Consumes: approved design `docs/superpowers/specs/2026-07-18-dynamic-toolsets-design.md` and the `tdmcp-quality-audit` skill.
- Produces: evidence-backed PASS/FAIL/UNVERIFIED baseline and a QA-approved first patch wave; no runtime edits.

- [ ] **Step 1: Record scope, dirty state, and command policy**

Run:

```bash
rtk git status --short --branch
rtk git log -3 --oneline
rtk proxy command -v rtk
```

Write `00_scope.md` with these exact sections:

```markdown
# Dynamic Toolsets Quality-Audit Scope

## Requested scope
Audit the registration, configuration, trust, UX, test, CI, and contract-verification boundaries needed for the approved dynamic-toolset design. No behavior edit is allowed before the four specialist reports and QA review.

## Repository state
- Target branch: `main`.
- Approved design and implementation-plan commits are present.
- Preserve the unrelated untracked `pnpm-lock.yaml`; it is outside this work.

## Safe one-shot commands
- `npm run typecheck`
- `npm run build`
- `./node_modules/.bin/biome check .`
- `npm test`
- `npm run validate:recipes`
- `npm run test:bridge`
- `npm run docs:build`
- `make complexity`
- `npm run deps:check`
- `npm run coverage:harness`

## Commands requiring timeout and cleanup
- `npm run dev`, `npm start`, `npm run docs:dev`, `npm run docs:preview`, and every HTTP server probe.

## External prerequisites
- Network: dependency installation and upstream verifier acquisition only.
- TouchDesigner/hardware/credentials: live smoke and device checks; report as UNVERIFIED when absent.

## Forbidden without separate approval
- `npm publish`, version/tag/push/release commands, destructive git commands, hardware control, and credential mutation.
```

Expected: status shows only planned docs commits plus the pre-existing untracked `pnpm-lock.yaml`; `rtk` is available.

- [ ] **Step 2: Run the safe baseline commands**

Run each separately so one failure does not erase later evidence:

```bash
rtk npm run typecheck
rtk npm run build
rtk proxy ./node_modules/.bin/biome check .
rtk test npm test
rtk npm run validate:recipes
rtk test npm run test:bridge
rtk npm run docs:build
rtk proxy make complexity
rtk npm run deps:check
rtk npm run coverage:harness
```

Expected: every command is recorded with exit code and concise output in `01_commands.md`. A failure is recorded as FAIL and investigated; it is not relabeled as a pass.

- [ ] **Step 3: Dispatch the four mandated independent auditors**

Use the `tdmcp-quality-audit` roster exactly:

```text
tdmcp-command-auditor       -> _workspace/quality-audit/01_commands.md
tdmcp-security-auditor      -> _workspace/quality-audit/02_security.md
tdmcp-ux-flow-auditor       -> _workspace/quality-audit/03_usability.md
tdmcp-refactor-test-auditor -> _workspace/quality-audit/04_refactor_tests.md
```

Each report must cite commands or `file:line`, separate PASS/FAIL/UNVERIFIED, and restrict findings to concrete patches or tests relevant to this design.

- [ ] **Step 4: Synthesize and run QA before edits**

The lead writes `05_plan.md` with deduplicated severity/confidence, assigns the dynamic-toolset implementation as the smallest safe wave, then dispatches `tdmcp-quality-qa`. QA writes `06_qa.md` and must reject unsupported pass claims, weakened thresholds, broad rewrites, or live checks presented as passing without execution.

Expected: `06_qa.md` explicitly says whether behavior edits may begin. If it rejects the wave, resolve the cited evidence gap and rerun QA before Task 2.

- [ ] **Step 5: Confirm the audit workspace did not alter tracked files**

Run:

```bash
rtk git status --short
```

Expected: `_workspace/` remains ignored; `pnpm-lock.yaml` remains untracked and untouched. This task has no commit because its evidence workspace is intentionally ignored.

---

### Task 2: Add Validated Dynamic-Toolset Configuration

**Files:**
- Create: `src/tools/toolsets/types.ts`
- Modify: `src/utils/config.ts`
- Modify: `src/cli/configInit.ts`
- Modify: `src/cli/doctor.ts`
- Modify: `src/server/context.ts`
- Modify: `src/tools/types.ts`
- Modify: `tests/unit/config.test.ts`
- Modify: `tests/unit/configInit.test.ts`
- Test: `tests/unit/doctor.test.ts`

**Interfaces:**
- Consumes: existing `ConfigSchema`, `envValues`, `buildToolContext`, and config precedence.
- Produces: `ToolProfile`, `dynamicToolsets`, `toolMaxActive`, `toolMetadataBudgetKb`, and context byte-budget fields used by Tasks 4–7.

- [ ] **Step 1: Write failing configuration tests**

Add these cases to `tests/unit/config.test.ts`:

```ts
it("keeps dynamic toolsets off and package limits stable by default", () => {
  const cfg = loadConfig({});
  expect(cfg.toolProfile).toBe("full");
  expect(cfg.dynamicToolsets).toBe("off");
  expect(cfg.toolMaxActive).toBe(120);
  expect(cfg.toolMetadataBudgetKb).toBe(256);
});

it.each(["core", "inspect", "build", "show", "library"] as const)(
  "accepts the %s tool profile",
  (profile) => {
    expect(loadConfig({ TDMCP_TOOL_PROFILE: profile }).toolProfile).toBe(profile);
  },
);

it("loads dynamic limits from env and rejects invalid values", () => {
  const cfg = loadConfig({
    TDMCP_DYNAMIC_TOOLSETS: "on",
    TDMCP_TOOL_MAX_ACTIVE: "80",
    TDMCP_TOOL_METADATA_BUDGET_KB: "192",
  });
  expect(cfg.dynamicToolsets).toBe("on");
  expect(cfg.toolMaxActive).toBe(80);
  expect(cfg.toolMetadataBudgetKb).toBe(192);
  expect(() => loadConfig({ TDMCP_TOOL_MAX_ACTIVE: "0" })).toThrow();
  expect(() => loadConfig({ TDMCP_TOOL_METADATA_BUDGET_KB: "0" })).toThrow();
});
```

Add the three env names to the `required` array in `tests/unit/configInit.test.ts` and assert:

```ts
expect(body).toContain('TDMCP_DYNAMIC_TOOLSETS="off"');
expect(body).toContain('TDMCP_TOOL_MAX_ACTIVE="120"');
expect(body).toContain('TDMCP_TOOL_METADATA_BUDGET_KB="256"');
```

- [ ] **Step 2: Run focused tests and verify the red state**

Run:

```bash
rtk test node scripts/run-vitest.mjs run tests/unit/config.test.ts tests/unit/configInit.test.ts
```

Expected: FAIL because the new profile values and three config properties are not recognized.

- [ ] **Step 3: Extend `ConfigSchema` and environment mapping**

In `src/utils/config.ts`, export the profile schema and add the exact fields:

```ts
export const ToolProfileSchema = z.enum([
  "full", "safe", "directory", "core", "inspect", "build", "show", "library",
]);
export type ToolProfile = z.infer<typeof ToolProfileSchema>;

// Inside ConfigSchema:
toolProfile: ToolProfileSchema.default("full"),
dynamicToolsets: z.enum(["on", "off"]).default("off"),
toolMaxActive: z.coerce.number().int().positive().max(501).default(120),
toolMetadataBudgetKb: z.coerce.number().int().positive().max(4096).default(256),
```

Add to `envValues`:

```ts
dynamicToolsets: env.TDMCP_DYNAMIC_TOOLSETS,
toolMaxActive: env.TDMCP_TOOL_MAX_ACTIVE,
toolMetadataBudgetKb: env.TDMCP_TOOL_METADATA_BUDGET_KB,
```

- [ ] **Step 4: Create the shared controller contracts and wire context**

Create `src/tools/toolsets/types.ts`:

```ts
export type ToolGroup = "layer1" | "layer2" | "layer3" | "foundation" | "library" | "vault" | "ai" | "cli" | "util";
export type ToolsetPreset = "core" | "inspect" | "build" | "show" | "library";
export type SelectableToolsetPreset = ToolsetPreset | "safe" | "directory" | "full";
export type ToolRisk = "read_only" | "safe_mutation" | "destructive" | "raw_code";

export interface DiscoverToolsInput {
  query: string;
  preset?: ToolsetPreset;
  risk?: "read_only" | "safe_mutation" | "any";
  limit?: number;
}
export interface DiscoverToolCandidate {
  name: string; summary: string; group: ToolGroup; presets: ToolsetPreset[];
  risk: ToolRisk; score: number; reason: string;
}
export interface DiscoverToolsOutput {
  query: string; normalized_query: string; candidates: DiscoverToolCandidate[];
}
export interface SelectToolsetInput {
  preset?: SelectableToolsetPreset;
  tools?: string[];
  mode?: "replace" | "add";
  include_risky?: boolean;
}
export interface ToolsetTransitionOutput {
  previous_profile: string; current_profile: string; active_count: number;
  metadata_bytes: number; added: string[]; removed: string[]; warnings: string[];
  client_refresh_required: true;
}
export interface ActiveToolsetOutput {
  startup_profile: string; current_profile: string; active_tools: string[];
  active_count: number; metadata_bytes: number; max_active: number;
  metadata_budget_bytes: number; dynamic_toolsets: boolean; protected_core: string[];
}
export interface ToolsetController {
  discover(input: DiscoverToolsInput): DiscoverToolsOutput;
  select(input: SelectToolsetInput): Promise<ToolsetTransitionOutput>;
  getActive(): ActiveToolsetOutput;
  reset(): Promise<ToolsetTransitionOutput>;
}
```

In `src/tools/types.ts`, import `ToolProfile` and `ToolsetController`, replace the inline profile union, and add:

```ts
toolProfile?: ToolProfile;
dynamicToolsets?: boolean;
toolMaxActive?: number;
toolMetadataBudgetBytes?: number;
toolsets?: ToolsetController;
```

In `src/server/context.ts`, map:

```ts
toolProfile: config.toolProfile,
dynamicToolsets: config.dynamicToolsets === "on",
toolMaxActive: config.toolMaxActive,
toolMetadataBudgetBytes: config.toolMetadataBudgetKb * 1024,
```

- [ ] **Step 5: Update starter config and doctor output**

In `src/cli/configInit.ts`, render:

```ts
'# Dynamic session-local discovery/activation tools. on|off.',
'TDMCP_DYNAMIC_TOOLSETS="off"',
'# Maximum active tools in dynamic mode; explicit full bypasses this count limit.',
'TDMCP_TOOL_MAX_ACTIVE="120"',
'# Serialized tools/list budget in KiB for dynamic selections.',
'TDMCP_TOOL_METADATA_BUDGET_KB="256"',
```

Update the profile comment to list all eight values. In `src/cli/doctor.ts`, include `dynamicToolsets`, `toolMaxActive`, and `toolMetadataBudgetKb` in the existing tool-exposure diagnostic data and describe dynamic `off` as the compatibility default.

- [ ] **Step 6: Run focused tests and static checks**

Run:

```bash
rtk test node scripts/run-vitest.mjs run tests/unit/config.test.ts tests/unit/configInit.test.ts tests/unit/doctor.test.ts
rtk npm run typecheck
rtk proxy ./node_modules/.bin/biome check src/utils/config.ts src/cli/configInit.ts src/cli/doctor.ts src/server/context.ts src/tools/types.ts src/tools/toolsets/types.ts tests/unit/config.test.ts tests/unit/configInit.test.ts tests/unit/doctor.test.ts
```

Expected: all focused tests pass; TypeScript and Biome report no errors.

- [ ] **Step 7: Commit the configuration slice**

Run:

```bash
rtk git add src/utils/config.ts src/cli/configInit.ts src/cli/doctor.ts src/server/context.ts src/tools/types.ts src/tools/toolsets/types.ts tests/unit/config.test.ts tests/unit/configInit.test.ts tests/unit/doctor.test.ts
rtk git commit -m "feat: configure dynamic toolset limits"
```

Expected: the commit excludes `pnpm-lock.yaml`.

---

### Task 3: Lock the Legacy Tool-Metadata Contract

**Files:**
- Create: `scripts/gen-tool-metadata.ts`
- Create: `src/tools/toolsets/metadata.ts`
- Create: `src/tools/toolsets/toolMetadata.generated.ts`
- Create: `tests/fixtures/tool-contract-baseline.json`
- Create: `tests/unit/toolMetadata.test.ts`
- Modify: `src/tools/toolsets/types.ts`
- Modify: `package.json`
- Modify: `.github/workflows/code-quality.yml`

**Interfaces:**
- Consumes: `createTdmcpServer`, in-memory SDK transport, static `full`, and the current 497-tool surface.
- Produces: `TOOL_METADATA`, `serializedToolListBytes(names)`, stable SHA-256 schema fingerprints, and a non-regenerating 497-tool baseline.

- [ ] **Step 1: Write failing metadata utility tests**

Create `tests/unit/toolMetadata.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  fingerprintTool,
  serializedToolListBytesFromEntries,
} from "../../src/tools/toolsets/metadata.js";

describe("tool metadata", () => {
  it("canonicalizes object keys recursively", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, b: 3 } })).toBe(
      '{"a":{"b":3,"y":2},"z":1}',
    );
  });

  it("fingerprints equivalent key order identically", () => {
    expect(fingerprintTool({ name: "x", inputSchema: { type: "object" } })).toBe(
      fingerprintTool({ inputSchema: { type: "object" }, name: "x" }),
    );
  });

  it("computes the exact serialized tools/list envelope", () => {
    expect(serializedToolListBytesFromEntries([])).toBe(
      Buffer.byteLength('{"tools":[]}', "utf8"),
    );
    expect(serializedToolListBytesFromEntries([3, 5])).toBe(12 + 3 + 1 + 5);
  });
});
```

- [ ] **Step 2: Run the test and verify the red state**

Run:

```bash
rtk test node scripts/run-vitest.mjs run tests/unit/toolMetadata.test.ts
```

Expected: FAIL because `metadata.ts` does not exist.

- [ ] **Step 3: Implement deterministic metadata primitives**

Create `src/tools/toolsets/metadata.ts`:

```ts
import { createHash } from "node:crypto";
import type { GeneratedToolMetadataEntry } from "./types.js";
import { TOOL_METADATA } from "./toolMetadata.generated.js";

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => [key, sortValue(child)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(sortValue(value));
  if (serialized === undefined) {
    throw new TypeError("Tool metadata must be JSON-serializable.");
  }
  return serialized;
}

export function fingerprintTool(tool: unknown): string {
  return createHash("sha256").update(canonicalJson(tool)).digest("hex");
}

export function serializedToolListBytesFromEntries(entryBytes: readonly number[]): number {
  return 12 + entryBytes.reduce((sum, bytes) => sum + bytes, 0) + Math.max(0, entryBytes.length - 1);
}

export function serializedToolListBytes(names: Iterable<string>): number {
  const bytes = [...names]
    .sort()
    .map((name) => {
      const entry = TOOL_METADATA[name];
      if (!entry) throw new Error(`Missing generated metadata for ${name}`);
      return entry.bytes;
    });
  return serializedToolListBytesFromEntries(bytes);
}
```

Add the generated-entry contract to `src/tools/toolsets/types.ts` so the generated module and metadata utilities have no runtime import cycle:

```ts
export interface GeneratedToolMetadataEntry {
  bytes: number;
  fingerprint: string;
}
```

Seed `toolMetadata.generated.ts` only long enough for the generator to run:

```ts
import type { GeneratedToolMetadataEntry } from "./types.js";

export const TOOL_METADATA = {} satisfies Record<string, GeneratedToolMetadataEntry>;
```

- [ ] **Step 4: Implement the assembled-server generator**

Create `scripts/gen-tool-metadata.ts` with these concrete operations:

```ts
async function collectFullTools(env: NodeJS.ProcessEnv): Promise<Tool[]> {
  const config = loadConfig(env);
  const server = createTdmcpServer(config, { logger: silentLogger });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "tdmcp-metadata-generator", version: "0.0.0" });
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return (await client.listTools()).tools.sort((a, b) => a.name.localeCompare(b.name));
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
}
```

Render each tool as:

```ts
[tool.name]: {
  bytes: Buffer.byteLength(JSON.stringify(tool), "utf8"),
  fingerprint: fingerprintTool(tool),
}
```

The CLI accepts exactly one mode:

```text
--write          replace src/tools/toolsets/toolMetadata.generated.ts
--check          compare a fresh deterministic render and exit 1 on drift
--write-baseline write tests/fixtures/tool-contract-baseline.json only if absent
```

`--write-baseline` must assert exactly 497 tools and render:

```json
{
  "count": 497,
  "fingerprints": {
    "tool_name": "sha256"
  }
}
```

Unknown or multiple modes exit 2. The generated TypeScript has no timestamp and begins:

```ts
/**
 * Generated by scripts/gen-tool-metadata.ts.
 * Regenerate with `npm run tools:metadata:gen`; verify with `npm run tools:metadata:check`.
 */
```

Add package scripts:

```json
"tools:metadata:gen": "tsx scripts/gen-tool-metadata.ts --write",
"tools:metadata:check": "tsx scripts/gen-tool-metadata.ts --check",
"tools:metadata:baseline": "tsx scripts/gen-tool-metadata.ts --write-baseline"
```

- [ ] **Step 5: Generate and lock the pre-change 497-tool baseline**

Run:

```bash
rtk npm run tools:metadata:gen
rtk npm run tools:metadata:baseline
rtk npm run tools:metadata:check
```

Expected:

```text
generated metadata entries: 497
legacy baseline entries: 497
tool metadata is current
```

Extend the unit test:

```ts
import baseline from "../fixtures/tool-contract-baseline.json" with { type: "json" };
import { TOOL_METADATA } from "../../src/tools/toolsets/toolMetadata.generated.js";

it("locks the original full surface at 497 names and fingerprints", () => {
  expect(baseline.count).toBe(497);
  expect(Object.keys(baseline.fingerprints)).toHaveLength(497);
  for (const [name, fingerprint] of Object.entries(baseline.fingerprints)) {
    expect(TOOL_METADATA[name]?.fingerprint).toBe(fingerprint);
  }
});
```

- [ ] **Step 6: Add generated drift to CI**

In `.github/workflows/code-quality.yml`, add after the agent-catalog check:

```yaml
      - name: Verify generated MCP tool metadata
        run: npm run tools:metadata:check
```

Do not regenerate the legacy baseline in CI. It is the immutable pre-change contract.

- [ ] **Step 7: Run focused and generated checks**

Run:

```bash
rtk test node scripts/run-vitest.mjs run tests/unit/toolMetadata.test.ts
rtk npm run tools:metadata:check
rtk npm run typecheck
rtk proxy ./node_modules/.bin/biome check scripts/gen-tool-metadata.ts src/tools/toolsets/metadata.ts src/tools/toolsets/types.ts src/tools/toolsets/toolMetadata.generated.ts tests/unit/toolMetadata.test.ts
rtk git diff --check
```

Expected: all commands pass with no whitespace errors.

- [ ] **Step 8: Commit the contract baseline separately**

Run:

```bash
rtk git add package.json scripts/gen-tool-metadata.ts src/tools/toolsets/metadata.ts src/tools/toolsets/types.ts src/tools/toolsets/toolMetadata.generated.ts tests/fixtures/tool-contract-baseline.json tests/unit/toolMetadata.test.ts .github/workflows/code-quality.yml
rtk git commit -m "test: lock MCP tool metadata baseline"
```

Expected: the commit contains 497 baseline fingerprints and excludes `pnpm-lock.yaml`.

---

### Task 4: Consolidate Tool Registration Without Contract Drift

**Files:**
- Create: `src/tools/registration.ts`
- Create: `src/tools/toolsets/profiles.ts`
- Create: `tests/unit/toolRegistration.test.ts`
- Modify: `src/tools/registry.ts`
- Modify: `src/tools/index.ts`
- Modify: `src/server/tdmcpServer.ts`
- Modify: `src/tools/cli/runMacroScript.ts`
- Modify: `tests/smoke/execOff.test.ts`
- Modify: `tests/integration/toolProfile.test.ts`

**Interfaces:**
- Consumes: `ToolRegistrar`, `MacroRecorder`, static profile config, and the baseline fingerprints from Task 3.
- Produces: `ToolRegistrarGroup`, `CapturedToolRegistration`, `registerToolGroups`, and exact static profile selection used by the manager.

- [ ] **Step 1: Write failing registration-pipeline tests**

Create `tests/unit/toolRegistration.test.ts` using a fake `registerTool` that returns fake handles. Cover:

```ts
expect(captured.map((entry) => entry.name)).toEqual(["read_tool", "write_tool"]);
expect(captured.map((entry) => entry.group)).toEqual(["layer3", "layer1"]);
expect(realRegister).toHaveBeenCalledTimes(2);
expect(wrappedHandler).not.toBe(originalHandler);
expect(server.registerTool).toBe(originalRegisterAfterCompletion);
```

Add a throwing registrar case and assert restoration in `finally`. Add static-filter cases asserting excluded tools never reach the real registrar.

- [ ] **Step 2: Run focused tests and verify the red state**

Run:

```bash
rtk test node scripts/run-vitest.mjs run tests/unit/toolRegistration.test.ts tests/integration/toolProfile.test.ts tests/smoke/execOff.test.ts
```

Expected: the new test fails because grouped capture does not exist; existing profile tests remain green before the refactor.

- [ ] **Step 3: Define grouped registrar and capture contracts**

Append to `src/tools/toolsets/types.ts`:

```ts
import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ToolRegistrar } from "../types.js";

export interface ToolRegistrarGroup {
  group: ToolGroup;
  registrars: readonly ToolRegistrar[];
}
export interface CapturedToolRegistration {
  name: string;
  group: ToolGroup;
  title?: string;
  description?: string;
  annotations?: ToolAnnotations;
  handle: RegisteredTool;
}
```

- [ ] **Step 4: Move profile policy to one explicit module**

Create `src/tools/toolsets/profiles.ts`. Move the existing 39 `SAFE_PROFILE_EXCLUDE` names and 15 `DIRECTORY_PROFILE_ALLOW` names without spelling changes. Export:

```ts
export const DYNAMIC_MANAGEMENT_TOOL_NAMES = [
  "discover_tools", "select_toolset", "get_active_toolset", "reset_toolset",
] as const;
export const DYNAMIC_MANAGEMENT_TOOL_NAME_SET: ReadonlySet<string> =
  new Set(DYNAMIC_MANAGEMENT_TOOL_NAMES);
export const SAFE_PROFILE_EXCLUDE: ReadonlySet<string>;
export const DIRECTORY_PROFILE_TOOL_NAMES: readonly string[];
export const RAW_CODE_TOOL_NAMES = [
  "execute_python_script", "exec_node_method", "create_python_script", "author_script_operator",
] as const;

export function staticProfileAllows(name: string, profile: ToolProfile): boolean {
  if (profile === "full") return true;
  if (profile === "safe") return !SAFE_PROFILE_EXCLUDE.has(name);
  return STATIC_PROFILE_TOOL_NAMES[profile].includes(name);
}
```

For this refactor commit only, map the five new profiles to the current 15-tool directory list. Task 5 replaces those temporary arrays before rollout.

- [ ] **Step 5: Implement the single interception pipeline**

Create `src/tools/registration.ts`:

```ts
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
): void;
```

Install one temporary `registerTool` wrapper, track the current group, and execute:

```ts
if (!options.dynamic && !staticProfileAllows(name, ctx.toolProfile ?? "full")) return undefined;
if (!options.dynamic && DYNAMIC_MANAGEMENT_TOOL_NAME_SET.has(name)) return undefined;
const handler = rest.at(-1);
if (typeof handler === "function" && options.macroRecorder) {
  rest[rest.length - 1] = options.macroRecorder.wrapHandler(name, handler);
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
```

Restore the original method in `finally`. Dynamic mode registers every environment-eligible tool; static mode never registers filtered tools.

- [ ] **Step 6: Express all registrars as named groups**

In `src/tools/registry.ts`, export:

```ts
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
```

Keep `runtimeToolRegistrars` as a flattened compatibility export. Keep `registerToolRegistrars` by delegating to `registerToolGroups` with one `util` group, `dynamic: false`, and no observer. In `src/tools/index.ts`, append `{ group: "cli", registrars: cliRegistrars }` and accept registration options.

In `src/tools/cli/runMacroScript.ts`, build the internal handler map through the same grouped pipeline so dynamic startup profile filtering cannot make a later-selected tool look unknown:

```ts
registerToolGroups(stub, ctx, {
  groups: [
    ...runtimeToolRegistrarGroups,
    { group: "cli", registrars: [registerMacroRecorder, registerRunMacroScript] },
  ],
  dynamic: ctx.dynamicToolsets === true,
});
```

Keep the existing `WeakMap` cache and test injection. Do not call the outer macro recorder wrapper while constructing this private dispatch map.

- [ ] **Step 7: Remove the server-level macro monkey patch**

In `src/server/tdmcpServer.ts`, replace the old wrapper with:

```ts
ctx.server = server;
registerAllTools(server, ctx, {
  dynamic: ctx.dynamicToolsets === true,
  macroRecorder: getMacroRecorder(),
});
```

Resources and prompts remain registered after tools and never enter the filter.

- [ ] **Step 8: Prove zero legacy contract drift**

Run:

```bash
rtk test node scripts/run-vitest.mjs run tests/unit/toolRegistration.test.ts tests/integration/toolProfile.test.ts tests/smoke/execOff.test.ts tests/unit/macroRecorder.test.ts
rtk npm run tools:metadata:check
rtk npm run typecheck
rtk npm run deps:check
```

Expected:

```text
static full: 497
static safe: 458
static directory: 15
generated metadata: no drift
```

If an original fingerprint changes, fix the pipeline; do not regenerate the locked baseline.

- [ ] **Step 9: Commit the behavior-preserving refactor**

Run:

```bash
rtk git add src/tools/registration.ts src/tools/toolsets/profiles.ts src/tools/toolsets/types.ts src/tools/registry.ts src/tools/index.ts src/server/tdmcpServer.ts src/tools/cli/runMacroScript.ts tests/unit/toolRegistration.test.ts tests/smoke/execOff.test.ts tests/integration/toolProfile.test.ts
rtk git commit -m "refactor: consolidate MCP tool registration"
```

Expected: original metadata remains identical.

---

### Task 5: Build Explicit Presets and the Deterministic Bilingual Catalog

**Files:**
- Create: `src/tools/toolsets/overrides.ts`
- Create: `src/tools/toolsets/catalog.ts`
- Create: `tests/unit/toolProfiles.test.ts`
- Create: `tests/unit/toolCatalog.test.ts`
- Modify: `src/tools/toolsets/profiles.ts`
- Modify: `src/tools/toolsets/types.ts`

**Interfaces:**
- Consumes: captured registration metadata, generated bytes, legacy risk sets, and approved profile definitions.
- Produces: protected core, explicit static memberships, discovery overrides, `ToolCatalog.discover`, `suggest`, and `namesForPreset`.

- [ ] **Step 1: Write failing exact-membership and catalog tests**

Assert:

```ts
expect(CORE_EXISTING_TOOL_NAMES).toHaveLength(13);
expect(PROTECTED_CORE_TOOL_NAMES).toHaveLength(17);
expect(DIRECTORY_PROFILE_TOOL_NAMES).toHaveLength(15);
expect(new Set(PROTECTED_CORE_TOOL_NAMES).size).toBe(17);
expect(BUILD_PROFILE_TOOL_NAMES.length).toBeLessThanOrEqual(116);
```

For each of `core`, `inspect`, `build`, `show`, and `library`, assert the static membership has at most 116 names and at most 262,144 serialized bytes, then union the four management names and assert the dynamic membership has at most 120 names. Task 8 checks dynamic bytes after the management entries exist in generated metadata. Every explicit name must exist in `TOOL_METADATA` or the four management names. `build`, `show`, and `library` must not intersect `SAFE_PROFILE_EXCLUDE` or `RAW_CODE_TOOL_NAMES`.

In `toolCatalog.test.ts`, assert:

```ts
expect(catalog.discover({ query: "오디오 반응형 비주얼", limit: 5 }).candidates[0]?.name)
  .toBe("create_audio_reactive");
expect(catalog.discover({ query: "GLSL shader", limit: 5 }).candidates[0]?.name)
  .toBe("create_glsl_shader");
expect(catalog.discover({ query: "python 실행", limit: 20 }).candidates.map((x) => x.name))
  .not.toContain("execute_python_script");
expect(catalog.discover({ query: "python 실행", risk: "any", limit: 20 }).candidates.map((x) => x.name))
  .toContain("execute_python_script");
```

Also test NFKC/case/underscore normalization, exact-name and prefix priority, preset affinity, name tie ordering, limits 1/20, and a suggestion for `create_audio_reactiv`.

- [ ] **Step 2: Run tests and verify the red state**

Run:

```bash
rtk test node scripts/run-vitest.mjs run tests/unit/toolProfiles.test.ts tests/unit/toolCatalog.test.ts
```

Expected: FAIL because approved memberships, aliases, and ranking do not exist.

- [ ] **Step 3: Define the protected core exactly**

In `profiles.ts`, keep the management-name tuple and set added in Task 4 and add the two exact core tuples:

```ts
export const CORE_EXISTING_TOOL_NAMES = [
  "get_td_info", "search_operators", "get_td_classes", "get_operator_workflow_guide",
  "find_td_nodes", "get_td_node_parameters", "get_td_node_flags", "get_td_topology",
  "get_td_node_errors", "summarize_td_errors", "get_preview", "validate_operator_chain",
  "list_recipes",
] as const;
export const PROTECTED_CORE_TOOL_NAMES = [
  "get_td_info", ...DYNAMIC_MANAGEMENT_TOOL_NAMES, ...CORE_EXISTING_TOOL_NAMES.slice(1),
] as const;
```

- [ ] **Step 4: Replace temporary aliases with explicit curated memberships**

Define these extra lists, then create sorted duplicate-free unions with `CORE_EXISTING_TOOL_NAMES`:

```ts
export const INSPECT_EXTRA_TOOL_NAMES = [
  "analyze_project", "check_operator_availability", "compact_graph_digest",
  "compare_operator_docs", "compare_td_nodes", "diagnose_hardware_environment",
  "diff_snapshots", "document_network", "get_bridge_logs", "get_dat_content",
  "get_inline_preview", "get_module_help", "get_node_state_runtime", "get_parameter_menu",
  "get_td_class_details", "get_td_nodes", "get_td_performance", "get_technique_detail",
  "get_tutorial", "inspect_gpu_and_displays", "inspect_op_extensions_storage",
  "lint_recipe_library", "profile_cook_cost", "read_parameter_modes",
  "search_touchdesigner_knowledge", "snapshot_td_graph", "watch_node",
  "watch_parameter_changes",
] as const;

export const BUILD_EXTRA_TOOL_NAMES = [
  "add_custom_parameters", "animate_parameter", "apply_glsl_top_mapping", "apply_lut",
  "apply_post_processing", "arrange_network", "auto_ui_from_params", "batch_operations",
  "bind_audio_reactive", "bind_to_channel", "build_chop_chain", "build_pop_chain",
  "build_sop_geometry", "connect_nodes", "create_3d_audio_reactive", "create_3d_scene",
  "create_audio_glsl_uniforms", "create_audio_reactive", "create_automation_lane",
  "create_color_grade", "create_color_wheels", "create_container", "create_control_panel",
  "create_control_surface", "create_datamosh", "create_displacement_warp", "create_dither",
  "create_feedback_network", "create_feedback_tunnel", "create_glsl_material",
  "create_glsl_shader", "create_gpu_particle_field", "create_halftone",
  "create_histogram_scope", "create_kaleidoscope", "create_keyframe_animation",
  "create_kinetic_text", "create_layer_mixer", "create_layer_stack", "create_media_bin",
  "create_multi_output", "create_node_chain", "create_npr_filter", "create_optical_flow",
  "create_palette", "create_particle_system", "create_pbr_scene", "create_pixel_sort",
  "create_point_cloud", "create_pop_particle_system", "create_preset_morph",
  "create_projection_mapping", "create_reaction_diffusion", "create_spectrum",
  "create_td_node", "create_tempo_sync", "create_test_pattern", "create_text_3d",
  "create_text_overlay", "create_video_player", "create_video_scopes", "create_visual_system",
  "create_waveform", "detect_onsets", "detect_pitch", "detect_tempo", "disconnect_nodes",
  "duplicate_network", "extract_audio_features", "extract_palette", "image_to_particles",
  "set_parameter_expression", "set_parameters_batch", "setup_output",
  "update_td_node_parameters",
] as const;

export const SHOW_EXTRA_TOOL_NAMES = [
  "add_timecode_overlay", "atem_switcher_control", "compose_cue_list",
  "connect_ableton_link_session", "connect_blackmagic_atem", "connect_companion_surface",
  "connect_obs_recorder", "connect_qlab_cue_stack", "connect_resolume_arena",
  "connect_spout_syphon_router", "control_timeline_transport", "create_autopilot",
  "create_companion_surface", "create_cue_sequencer", "create_decklink_io_router",
  "create_direct_display_output", "create_dome_output", "create_histogram_scope",
  "create_ltc_timecode_bridge", "create_monitor_layout_panel", "create_multi_output",
  "create_ndi_router_matrix", "create_scene_timeline", "create_scheduler",
  "create_set_navigator", "create_setlist_runner", "create_show_failover",
  "create_stage_dashboard", "create_test_pattern", "create_transition",
  "create_video_scopes", "create_window_output_matrix", "diagnose_hardware_environment",
  "get_td_performance", "inspect_gpu_and_displays", "manage_cue", "obs_stream_control",
  "profile_cook_cost", "qlab_osc_bridge", "resolume_vdmx_output_chain",
  "set_perform_mode", "setup_output", "show_preflight_report", "sync_external_clock",
  "sync_timecode", "watch_node", "watch_parameter_changes",
] as const;

export const LIBRARY_EXTRA_TOOL_NAMES = [
  "browse_library", "browse_vault_library", "checksum_and_verify_pack",
  "compare_operator_docs", "component_changelog_trail", "component_link_health",
  "diff_library_assets", "draft_recipe_from_operator_chain", "draft_recipe_from_technique",
  "draft_recipe_from_tutorial", "get_dat_content", "get_technique_detail", "get_tutorial",
  "inspect_component_manifest", "library_lineage_graph", "lint_recipe_library",
  "load_session_profile", "narrate_set", "plan_td_version_migration", "provenance_stamp",
  "recall_similar_work", "search_touchdesigner_knowledge", "validate_library_asset",
] as const;
```

Use `sortedUnion(...lists)` only to deduplicate and sort explicitly named entries; never infer admission from naming conventions.

- [ ] **Step 5: Add curated discovery aliases and tags**

Create `overrides.ts` with this type:

```ts
export interface ToolDiscoveryOverride {
  aliases: readonly string[];
  tags: readonly string[];
}
```

Populate the following exact mappings:

```ts
export const TOOL_DISCOVERY_OVERRIDES: Readonly<Record<string, ToolDiscoveryOverride>> = {
  get_td_info: { aliases: ["TouchDesigner 상태", "연결 상태", "bridge health"], tags: ["inspect", "connection"] },
  find_td_nodes: { aliases: ["노드 찾기", "노드 검색", "find nodes"], tags: ["inspect", "topology"] },
  get_td_node_parameters: { aliases: ["노드 파라미터", "parameter inspect"], tags: ["inspect", "parameter"] },
  get_preview: { aliases: ["미리보기", "렌더 미리보기", "preview image"], tags: ["inspect", "render"] },
  create_audio_reactive: { aliases: ["오디오 반응형", "사운드 리액티브", "audio reactive visual"], tags: ["audio", "build"] },
  create_glsl_shader: { aliases: ["GLSL 셰이더", "셰이더 만들기", "build shader"], tags: ["glsl", "shader", "build"] },
  list_recipes: { aliases: ["레시피 목록", "recipe list"], tags: ["recipe", "library"] },
  apply_recipe: { aliases: ["레시피 적용", "apply recipe"], tags: ["recipe", "build"] },
  arrange_network: { aliases: ["노드 정리", "그래프 정리", "layout nodes"], tags: ["layout", "build"] },
  show_preflight_report: { aliases: ["공연 전 점검", "리허설 점검", "show rehearsal"], tags: ["show", "preflight"] },
  browse_library: { aliases: ["라이브러리 검색", "컴포넌트 찾기", "browse library"], tags: ["library", "search"] },
  diff_library_assets: { aliases: ["라이브러리 비교", "asset diff"], tags: ["library", "diff"] },
  connect_nodes: { aliases: ["노드 연결", "connect operators"], tags: ["build", "topology"] },
  update_td_node_parameters: { aliases: ["파라미터 수정", "set parameters"], tags: ["build", "parameter"] },
  summarize_td_errors: { aliases: ["오류 요약", "에러 정리"], tags: ["inspect", "error"] },
  create_particle_system: { aliases: ["파티클 시스템", "particle visual"], tags: ["particle", "build"] },
  create_feedback_network: { aliases: ["피드백 네트워크", "feedback visual"], tags: ["feedback", "build"] },
  create_projection_mapping: { aliases: ["프로젝션 매핑", "projection mapping"], tags: ["mapping", "build"] },
  create_color_grade: { aliases: ["컬러 그레이딩", "color grading"], tags: ["color", "build"] },
  create_setlist_runner: { aliases: ["셋리스트 실행", "setlist runner"], tags: ["show", "cue"] },
  import_shadertoy: { aliases: ["Shadertoy 가져오기", "import shadertoy"], tags: ["shader", "import"] },
  create_pose_tracking: { aliases: ["포즈 트래킹", "body pose tracking"], tags: ["tracking", "build"] },
  setup_output: { aliases: ["출력 설정", "output mapping"], tags: ["output", "show"] },
  search_python_api: { aliases: ["파이썬 API 검색", "python api help"], tags: ["inspect", "python"] },
  execute_python_script: { aliases: ["파이썬 실행", "raw python"], tags: ["python", "raw-code"] },
};
```

- [ ] **Step 6: Implement deterministic offline ranking**

In `catalog.ts`:

```ts
export function normalizeDiscoveryText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}
```

Build each entry from captured metadata, annotations, explicit memberships, overrides, and generated bytes. `summary` is the first non-empty sentence or first 240 normalized characters. Risk priority is raw code, destructive, read-only, safe mutation.

Use these score ceilings:

```text
exact tool name or exact alias: 1000
tool-name token/prefix match:    600
alias or tag token match:        350
title token match:               200
summary token match:             100
requested preset membership:      25
```

Tokenize normalized query/fields on spaces. Exact name or alias equality contributes 1000 and suppresses lower lexical categories; otherwise each category contributes at most once, scaled by matched query-token coverage and rounded to an integer. Preset affinity may add 25. Drop zero-score entries, then sort descending score and ascending ASCII tool name.

Implement `suggest(name, limit = 5)` with a local two-row Levenshtein calculation over normalized tool names. Sort by exact-prefix match first, then edit distance, then ASCII name; return at most five and add no package dependency.

Default `risk` is `safe_mutation`, which includes read-only plus safe mutation; `read_only` admits only read-only; `any` admits all. Require non-empty query and clamp `limit` to 1..20 with default 10.

- [ ] **Step 7: Run catalog and profile tests**

Run:

```bash
rtk test node scripts/run-vitest.mjs run tests/unit/toolProfiles.test.ts tests/unit/toolCatalog.test.ts tests/unit/toolMetadata.test.ts
rtk npm run typecheck
rtk npm run deps:check
```

Expected: memberships contain only real tools, risk intersections are empty, and ranking is deterministic.

- [ ] **Step 8: Commit the catalog slice**

Run:

```bash
rtk git add src/tools/toolsets/profiles.ts src/tools/toolsets/overrides.ts src/tools/toolsets/catalog.ts src/tools/toolsets/types.ts tests/unit/toolProfiles.test.ts tests/unit/toolCatalog.test.ts
rtk git commit -m "feat: add curated MCP tool catalog"
```

Expected: no generated metadata or original tool implementation changes.

---

### Task 6: Implement the Atomic Session-Local Toolset Manager

**Files:**
- Create: `src/tools/toolsets/errors.ts`
- Create: `src/tools/toolsets/manager.ts`
- Create: `src/tools/toolsets/index.ts`
- Create: `tests/unit/toolsetManager.test.ts`
- Modify: `src/tools/toolsets/types.ts`

**Interfaces:**
- Consumes: `ToolCatalog`, captured `RegisteredTool` handles, explicit profiles, generated byte accounting, and `McpServer.sendToolListChanged()`.
- Produces: `ToolsetManager.capture`, `initialize`, `discover`, `select`, `getActive`, and `reset` implementing `ToolsetController`.

- [ ] **Step 1: Write failing manager tests with fake lifecycle handles**

Use fake handles whose `enable`, `disable`, and `update` mutate `enabled`, plus a fake server with a counted notification. Add one named test for each invariant:

- `initializes core without a client notification`: start every fake handle enabled, initialize `core`, assert exactly the protected 17 remain enabled and the notification count is zero.
- `unions every selection with the protected 17-tool core`: replace with one optional safe tool and assert the result is the 17 core names plus that tool.
- `rejects unknown names with close matches and no state change`: request `discover_toolz`, assert code `unknown_tool`, a `discover_tools` suggestion, and an unchanged enabled snapshot.
- `requires explicit tools plus include_risky for destructive/raw code`: try a risky preset-only selection, then an explicit name without the flag, and assert both reject before lifecycle calls.
- `keeps raw code blocked when raw Python is off`: request `execute_python_script` explicitly with `include_risky: true`, assert `raw_python_disabled`, including when raw tools were intentionally not captured by registration.
- `rejects count and byte budgets with largest contributors`: inject small test budgets, assert `active_tool_limit_exceeded` and `metadata_budget_exceeded` in separate cases, sorted largest contributors, and an unchanged enabled snapshot.
- `lets only explicit full bypass ordinary budgets`: assert `{ preset: "full" }` succeeds above the ordinary budget while an equivalent explicit tool list fails.
- `applies replace and add modes`: replace optional membership, add another optional tool, and assert the exact sorted active names after both transitions.
- `rolls back every handle when one lifecycle update throws`: make the middle fake throw, assert all handles return to their snapshot and no notification is emitted.
- `emits exactly one list-change notification`: transition across several enable/disable operations and assert the public notifier is called once after success.
- `serializes overlapping transitions`: block the first fake update with a deferred promise, start a second selection, release the first, and assert non-interleaved final state and two ordered results.
- `resets exactly to the startup profile`: initialize a non-default startup profile, mutate it, reset it, and assert exact startup membership rather than hard-coded core membership.

Each failure test snapshots all `enabled` values before the call and compares them after rejection.

- [ ] **Step 2: Run manager tests and verify the red state**

Run:

```bash
rtk test node scripts/run-vitest.mjs run tests/unit/toolsetManager.test.ts
```

Expected: FAIL because manager and stable errors do not exist.

- [ ] **Step 3: Add stable typed errors**

Create `errors.ts`:

```ts
export type ToolsetErrorCode =
  | "dynamic_toolsets_disabled"
  | "invalid_selection"
  | "unknown_tool"
  | "risky_tool_requires_explicit_opt_in"
  | "raw_python_disabled"
  | "active_tool_limit_exceeded"
  | "metadata_budget_exceeded"
  | "protected_core_tool"
  | "toolset_transition_failed";

export class ToolsetError extends Error {
  constructor(
    readonly code: ToolsetErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ToolsetError";
  }
}
```

Messages may name tools, counts, and public limits only; never include environment values, complete schemas, handler text, paths, or credentials.

- [ ] **Step 4: Implement capture and initialization**

Use this public contract:

```ts
export interface ToolsetManagerOptions {
  server: McpServer;
  startupProfile: ToolProfile;
  maxActive: number;
  metadataBudgetBytes: number;
  allowRawPython: boolean;
}
export class ToolsetManager implements ToolsetController {
  constructor(options: ToolsetManagerOptions);
  capture(entry: CapturedToolRegistration): void;
  initialize(): void;
  discover(input: DiscoverToolsInput): DiscoverToolsOutput;
  select(input: SelectToolsetInput): Promise<ToolsetTransitionOutput>;
  getActive(): ActiveToolsetOutput;
  reset(): Promise<ToolsetTransitionOutput>;
}
```

`capture` rejects duplicate names. `initialize` constructs the catalog after registration and establishes startup enabled state before transport connection without notification. A second initialization throws. Until Task 7 regenerates management metadata, zero-byte fallback is allowed only for the four management names; every other missing entry is fatal.

- [ ] **Step 5: Validate the whole transition before mutation**

Enforce this order:

```text
validate exactly one of preset/tools
validate include_risky only with explicit tools
resolve preset or exact names
union the protected core
resolve raw-code constants as known-but-environment-blocked even when registration did not capture them
reject every other unknown name and attach five suggestions
require exact explicit risky names plus include_risky
apply the raw-Python gate
calculate count and exact serialized bytes
reject ordinary count/byte overflow; explicit full alone bypasses
compute complete before/after enabled-state maps
```

Budget errors include requested count/bytes, limits, the ten largest contributors, and smaller fitting presets.

- [ ] **Step 6: Apply one rollback-safe lifecycle transaction**

The v1 SDK lifecycle sends a notification per handle. Suppress only the high-level notifier during the batch, retain `enable`/`disable`, then send once:

```ts
const originalNotify = server.sendToolListChanged.bind(server);
const previousNotify = server.sendToolListChanged;
(server as { sendToolListChanged: () => void }).sendToolListChanged = () => {};
try {
  for (const [name, shouldEnable] of target) {
    const handle = handles.get(name);
    if (!handle || handle.enabled === shouldEnable) continue;
    if (shouldEnable) handle.enable();
    else handle.disable();
  }
} catch (cause) {
  for (const [name, wasEnabled] of before) {
    const handle = handles.get(name);
    if (handle && handle.enabled !== wasEnabled) handle.update({ enabled: wasEnabled });
  }
  throw new ToolsetError("toolset_transition_failed", "Toolset transition rolled back.", {
    cause: cause instanceof Error ? cause.name : "unknown",
  });
} finally {
  (server as { sendToolListChanged: () => void }).sendToolListChanged = previousNotify;
}
originalNotify();
```

Guard the block with a promise tail so overlapping `select`/`reset` calls execute in arrival order. Update `currentProfile` only after success. Sort every name array.

- [ ] **Step 7: Run manager and compatibility checks**

Run:

```bash
rtk test node scripts/run-vitest.mjs run tests/unit/toolsetManager.test.ts tests/unit/toolCatalog.test.ts tests/unit/toolProfiles.test.ts
rtk npm run typecheck
rtk npm run deps:check
rtk proxy ./node_modules/.bin/biome check src/tools/toolsets tests/unit/toolsetManager.test.ts tests/unit/toolCatalog.test.ts tests/unit/toolProfiles.test.ts
```

Expected: failures mutate zero states and success emits one notification.

- [ ] **Step 8: Commit the manager slice**

Run:

```bash
rtk git add src/tools/toolsets/errors.ts src/tools/toolsets/manager.ts src/tools/toolsets/index.ts src/tools/toolsets/types.ts tests/unit/toolsetManager.test.ts
rtk git commit -m "feat: add atomic MCP toolset manager"
```

Expected: no MCP management tool is visible yet.

---

### Task 7: Register the Four MCP Management Tools and Wire the Server

**Files:**
- Create: `src/tools/util/discoverTools.ts`
- Create: `src/tools/util/selectToolset.ts`
- Create: `src/tools/util/getActiveToolset.ts`
- Create: `src/tools/util/resetToolset.ts`
- Create: `tests/unit/toolsetManagementTools.test.ts`
- Create: `tests/unit/result.test.ts`
- Modify: `src/tools/util/index.ts`
- Modify: `src/tools/result.ts`
- Modify: `src/server/tdmcpServer.ts`
- Modify: `src/tools/index.ts`
- Modify: `scripts/gen-tool-metadata.ts`
- Modify: `src/tools/toolsets/toolMetadata.generated.ts`
- Modify: `tests/integration/toolProfile.test.ts`

**Interfaces:**
- Consumes: `ToolsetController`, `ToolsetManager`, grouped capture callback, and existing result helpers.
- Produces: four native MCP tools with Zod inputs/outputs, structured success/error results, exact static/dynamic counts, and a 501-entry generated manifest.

- [ ] **Step 1: Write failing result-helper and management-tool tests**

In `tests/unit/toolsetManagementTools.test.ts`, use a fake controller and capturing server. Assert all four names register with an `outputSchema`, all have `destructiveHint: false`, and read-only hints are true only for discovery/state inspection.

Add an error assertion:

```ts
const result = await selectToolsetImpl(ctx, { tools: ["missing"] });
expect(result.isError).toBe(true);
expect(result.structuredContent).toMatchObject({
  ok: false,
  code: "unknown_tool",
});
```

Add a `structuredErrorResult` unit case to `tests/unit/result.test.ts`:

```ts
expect(structuredErrorResult("failed", { code: "x" })).toEqual({
  isError: true,
  content: [{ type: "text", text: "failed" }],
  structuredContent: { code: "x" },
});
```

- [ ] **Step 2: Run focused tests and verify the red state**

Run:

```bash
rtk test node scripts/run-vitest.mjs run tests/unit/toolsetManagementTools.test.ts tests/unit/result.test.ts
```

Expected: FAIL because the helper and four files do not exist.

- [ ] **Step 3: Add structured error results**

In `src/tools/result.ts`:

```ts
export function structuredErrorResult(summary: string, data: object): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: summary }],
    structuredContent: data as { [key: string]: unknown },
  };
}
```

Management implementations catch only `ToolsetError` and return:

```ts
return structuredErrorResult(error.message, {
  ok: false,
  code: error.code,
  ...error.details,
});
```

Unexpected errors are logged without arguments and return code `toolset_transition_failed` with no stack or path.

- [ ] **Step 4: Implement `discover_tools`**

In `src/tools/util/discoverTools.ts`, define:

```ts
export const discoverToolsSchema = z.object({
  query: z.string().trim().min(1),
  preset: z.enum(["core", "inspect", "build", "show", "library"]).optional(),
  risk: z.enum(["read_only", "safe_mutation", "any"]).default("safe_mutation"),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});
export const discoverToolsOutputSchema = z.object({
  query: z.string(),
  normalized_query: z.string(),
  candidates: z.array(z.object({
    name: z.string(), summary: z.string(),
    group: z.enum(["layer1", "layer2", "layer3", "foundation", "library", "vault", "ai", "cli", "util"]),
    presets: z.array(z.enum(["core", "inspect", "build", "show", "library"])),
    risk: z.enum(["read_only", "safe_mutation", "destructive", "raw_code"]),
    score: z.number(), reason: z.string(),
  })),
});
```

The registrar uses `inputSchema: discoverToolsSchema.shape`, `outputSchema: discoverToolsOutputSchema.shape`, `readOnlyHint: true`, `destructiveHint: false`, and `openWorldHint: false`. The implementation returns `structuredResult` with no full schemas.

- [ ] **Step 5: Implement `select_toolset`**

In `src/tools/util/selectToolset.ts`, define:

```ts
export const selectToolsetSchema = z.object({
  preset: z.enum(["core", "inspect", "build", "show", "library", "safe", "directory", "full"]).optional(),
  tools: z.array(z.string().trim().min(1)).min(1).max(120).optional(),
  mode: z.enum(["replace", "add"]).default("replace"),
  include_risky: z.boolean().default(false),
});
export const toolsetTransitionOutputSchema = z.object({
  previous_profile: z.string(), current_profile: z.string(),
  active_count: z.number().int().nonnegative(), metadata_bytes: z.number().int().nonnegative(),
  added: z.array(z.string()), removed: z.array(z.string()), warnings: z.array(z.string()),
  client_refresh_required: z.literal(true),
});
```

The manager enforces the cross-field selection rules. Register with `readOnlyHint: false`, `destructiveHint: false`, `openWorldHint: false` and return a concise summary plus the exact structured transition.

- [ ] **Step 6: Implement state inspection and reset**

`getActiveToolset.ts` uses an empty Zod object input and an output schema matching every field in `ActiveToolsetOutput`. It is read-only.

`resetToolset.ts` uses an empty Zod object input and reuses `toolsetTransitionOutputSchema`. It is a non-destructive mutation. Both call `ctx.toolsets`; if absent, return `dynamic_toolsets_disabled` through `structuredErrorResult`.

Update `src/tools/util/index.ts`:

```ts
import { registerDiscoverTools } from "./discoverTools.js";
import { registerGetActiveToolset } from "./getActiveToolset.js";
import { registerResetToolset } from "./resetToolset.js";
import { registerSelectToolset } from "./selectToolset.js";

export const utilRegistrars: ToolRegistrar[] = [
  registerDiscoverTools,
  registerSelectToolset,
  registerGetActiveToolset,
  registerResetToolset,
];
```

- [ ] **Step 7: Give each server instance one manager**

In `createTdmcpServer`, after constructing `server` and before registering tools:

```ts
const toolsets = ctx.dynamicToolsets
  ? new ToolsetManager({
      server,
      startupProfile: ctx.toolProfile ?? "full",
      maxActive: ctx.toolMaxActive ?? 120,
      metadataBudgetBytes: ctx.toolMetadataBudgetBytes ?? 256 * 1024,
      allowRawPython: ctx.allowRawPython !== false,
    })
  : undefined;
ctx.toolsets = toolsets;
ctx.server = server;
registerAllTools(server, ctx, {
  dynamic: ctx.dynamicToolsets === true,
  macroRecorder: getMacroRecorder(),
  onRegistered: (entry) => toolsets?.capture(entry),
});
toolsets?.initialize();
```

Keep resource and prompt registration after `initialize`. Update server instructions conditionally: when dynamic mode is on, tell the client to call `discover_tools`, select a preset, refresh after `client_refresh_required`, then call the original tool.

- [ ] **Step 8: Regenerate metadata with dynamic management entries**

Change the generator to collect both static full and dynamic full:

```ts
const legacy = await collectFullTools({
  TDMCP_TOOL_PROFILE: "full",
  TDMCP_DYNAMIC_TOOLSETS: "off",
});
const dynamic = await collectFullTools({
  TDMCP_TOOL_PROFILE: "full",
  TDMCP_DYNAMIC_TOOLSETS: "on",
});
```

Assert legacy count is 497, dynamic count is 501, every legacy name/fingerprint matches the immutable baseline, and the dynamic-only names equal the four management names. Render the 501-entry dynamic manifest. The manager's temporary zero-byte management fallback now disappears under normal operation.

Run:

```bash
rtk npm run tools:metadata:gen
rtk npm run tools:metadata:check
```

Expected: 501 generated entries and zero drift on the second command.

- [ ] **Step 9: Lock exact static and dynamic counts**

Extend `tests/integration/toolProfile.test.ts` with a table-driven assertion:

```ts
const EXPECTED_COUNTS = [
  [{ TDMCP_TOOL_PROFILE: "full" }, 497],
  [{ TDMCP_TOOL_PROFILE: "safe" }, 458],
  [{ TDMCP_TOOL_PROFILE: "directory" }, 15],
  [{ TDMCP_TOOL_PROFILE: "core" }, 13],
  [{ TDMCP_TOOL_PROFILE: "full", TDMCP_DYNAMIC_TOOLSETS: "on" }, 501],
  [{ TDMCP_TOOL_PROFILE: "safe", TDMCP_DYNAMIC_TOOLSETS: "on" }, 462],
  [{ TDMCP_TOOL_PROFILE: "directory", TDMCP_DYNAMIC_TOOLSETS: "on" }, 19],
  [{ TDMCP_TOOL_PROFILE: "core", TDMCP_DYNAMIC_TOOLSETS: "on" }, 17],
] as const;
```

Assert the four management names are absent in every static mode and present in every dynamic mode.

- [ ] **Step 10: Run the focused integration slice**

Run:

```bash
rtk test node scripts/run-vitest.mjs run tests/unit/toolsetManagementTools.test.ts tests/unit/result.test.ts tests/unit/toolsetManager.test.ts tests/integration/toolProfile.test.ts
rtk npm run tools:metadata:check
rtk npm run typecheck
rtk npm run build
```

Expected: all tests pass and the built server starts with unchanged package defaults.

- [ ] **Step 11: Commit the native management surface**

Run:

```bash
rtk git add src/tools/util/discoverTools.ts src/tools/util/selectToolset.ts src/tools/util/getActiveToolset.ts src/tools/util/resetToolset.ts src/tools/util/index.ts src/tools/result.ts src/server/tdmcpServer.ts src/tools/index.ts scripts/gen-tool-metadata.ts src/tools/toolsets/toolMetadata.generated.ts tests/unit/toolsetManagementTools.test.ts tests/unit/result.test.ts tests/integration/toolProfile.test.ts
rtk git commit -m "feat: expose dynamic MCP toolset controls"
```

Expected: original 497 fingerprints still equal `tool-contract-baseline.json`.

---

### Task 8: Verify Native MCP List Changes, Budgets, and Original Contracts

**Files:**
- Create: `tests/integration/dynamicToolsets.test.ts`
- Modify: `tests/integration/helpers.ts`

**Interfaces:**
- Consumes: assembled dynamic server, SDK client notification API, management tools, and immutable fingerprint baseline.
- Produces: protocol-level evidence for startup surface, transition notification, disabled calls, budget compliance, and contract preservation.

- [ ] **Step 1: Add a reusable configurable in-memory session helper**

Extend `tests/integration/helpers.ts`:

```ts
export async function connectConfiguredClient(
  clientName: string,
  env: NodeJS.ProcessEnv,
): Promise<ResourceClientSession> {
  const config = loadConfig(env);
  const server = createTdmcpServer(config, { logger: silentLogger });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: clientName, version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => { await Promise.all([client.close(), server.close()]); },
  };
}
```

Keep the existing helper delegating with an empty env so resource tests remain unchanged.

- [ ] **Step 2: Write the initial-core and metadata-budget test**

In `dynamicToolsets.test.ts`, connect with core/dynamic on, list tools, and assert exact sorted names equal `PROTECTED_CORE_TOOL_NAMES`. Compute:

```ts
const bytes = Buffer.byteLength(JSON.stringify({ tools }), "utf8");
expect(tools).toHaveLength(17);
expect(bytes).toBeLessThanOrEqual(65_536);
expect(tools.every((tool) => tool.outputSchema !== undefined || !DYNAMIC_MANAGEMENT_TOOL_NAME_SET.has(tool.name))).toBe(true);
```

- [ ] **Step 3: Verify one list-change notification and original tool contract**

Before selection:

```ts
let notifications = 0;
client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
  notifications += 1;
});
```

Call:

```ts
await client.callTool({
  name: "select_toolset",
  arguments: { tools: ["create_audio_reactive"], mode: "replace" },
});
```

Wait one event-loop turn, assert `notifications === 1`, relist, and compare the selected tool's `fingerprintTool(tool)` to `tool-contract-baseline.json`. This proves the original schema and annotations survived activation.

- [ ] **Step 4: Verify disabled and failed calls do not leak state**

On initial core, call `create_audio_reactive` and assert an MCP error result containing `disabled`. Capture the active list, then call unknown and intentionally over-budget selections; assert both return stable structured error codes and the subsequent list exactly equals the captured list.

- [ ] **Step 5: Verify every preset budget and risk invariant through MCP**

For `core`, `inspect`, `build`, `show`, and `library`, select the preset, relist, and assert count <=120 and serialized bytes <=262,144. For `build`, `show`, and `library`, assert every returned tool has `destructiveHint !== true` and none is a raw-code name.

Select `full` and assert the 497 baseline names plus four management names. With `TDMCP_RAW_PYTHON=off`, explicitly select `execute_python_script` with `include_risky: true` and assert `raw_python_disabled` with no list change.

- [ ] **Step 6: Run the protocol integration suite**

Run:

```bash
rtk test node scripts/run-vitest.mjs run tests/integration/dynamicToolsets.test.ts tests/integration/toolProfile.test.ts
rtk npm run tools:metadata:check
```

Expected: all profile, count, byte, risk, notification, and fingerprint assertions pass.

- [ ] **Step 7: Commit the MCP integration evidence**

Run:

```bash
rtk git add tests/integration/helpers.ts tests/integration/dynamicToolsets.test.ts
rtk git commit -m "test: verify dynamic MCP tool contracts"
```

---

### Task 9: Prove Streamable HTTP Session Isolation

**Files:**
- Create: `tests/integration/httpDynamicToolsets.test.ts`
- Modify: `tests/integration/httpTransport.test.ts` only if shared port helpers are extracted.

**Interfaces:**
- Consumes: `startTransport(() => createTdmcpServer(config, { logger: silentLogger }), config, silentLogger)` and two independent `StreamableHTTPClientTransport` sessions.
- Produces: evidence that tool activation is isolated to the SDK server instance owned by each HTTP session.

- [ ] **Step 1: Write the two-session isolation test**

Start one HTTP listener on a dedicated test port with core/dynamic on. Connect two clients. Assert both initially list the 17-tool core. Client A selects `build`; client B selects `show`. Relist both and assert:

```ts
expect(namesA).toContain("create_audio_reactive");
expect(namesA).not.toContain("create_setlist_runner");
expect(namesB).toContain("create_setlist_runner");
expect(namesB).not.toContain("create_audio_reactive");
```

Then reset client A and assert client B's list is byte-for-byte unchanged.

- [ ] **Step 2: Run the test and inspect the expected failure or pass**

Run:

```bash
rtk test node scripts/run-vitest.mjs run tests/integration/httpDynamicToolsets.test.ts tests/integration/httpTransport.test.ts
```

Expected: PASS with current one-server-per-session transport. If it fails, correct only session ownership or test cleanup; do not add a global state store.

- [ ] **Step 3: Verify cleanup and no open handles**

Close both clients and the transport handle in `afterAll`/`finally`. Run the focused test twice:

```bash
rtk test node scripts/run-vitest.mjs run tests/integration/httpDynamicToolsets.test.ts
rtk test node scripts/run-vitest.mjs run tests/integration/httpDynamicToolsets.test.ts
```

Expected: both runs pass without port-in-use or open-handle warnings.

- [ ] **Step 4: Commit the isolation evidence**

Run:

```bash
rtk git add tests/integration/httpDynamicToolsets.test.ts tests/integration/httpTransport.test.ts
rtk git commit -m "test: prove HTTP toolset isolation"
```

---

### Task 10: Add the Offline Korean/English Discovery Evaluation

**Files:**
- Create: `tests/fixtures/tool-discovery-golden.json`
- Create: `tests/eval/toolDiscoveryGolden.test.ts`
- Modify: `src/tools/toolsets/overrides.ts` only when a failing case proves an alias gap.

**Interfaces:**
- Consumes: deterministic `ToolCatalog.discover` through the native `discover_tools` MCP tool and the assembled 501-entry catalog.
- Produces: at least 20 fixed top-five retrieval cases and explicit risky-result exclusions with no model or network.

- [ ] **Step 1: Create the fixed golden fixture**

Create `tests/fixtures/tool-discovery-golden.json` with these cases:

```json
[
  { "query": "TouchDesigner 연결 상태 확인", "expected": "get_td_info" },
  { "query": "find every TOP under project1", "expected": "find_td_nodes" },
  { "query": "이 노드 파라미터를 보고 싶어", "expected": "get_td_node_parameters" },
  { "query": "렌더 결과 미리보기", "expected": "get_preview" },
  { "query": "오디오 반응형 비주얼 만들기", "expected": "create_audio_reactive" },
  { "query": "build a GLSL shader", "expected": "create_glsl_shader" },
  { "query": "레시피 목록", "expected": "list_recipes" },
  { "query": "apply a saved recipe", "expected": "apply_recipe" },
  { "query": "노드 그래프 자동 정리", "expected": "arrange_network" },
  { "query": "공연 전 리허설 점검", "expected": "show_preflight_report" },
  { "query": "search component library", "expected": "browse_library" },
  { "query": "라이브러리 자산 차이 비교", "expected": "diff_library_assets" },
  { "query": "connect two nodes", "expected": "connect_nodes" },
  { "query": "파라미터 값 수정", "expected": "update_td_node_parameters" },
  { "query": "summarize all node errors", "expected": "summarize_td_errors" },
  { "query": "create a particle system", "expected": "create_particle_system" },
  { "query": "피드백 네트워크", "expected": "create_feedback_network" },
  { "query": "projection mapping system", "expected": "create_projection_mapping" },
  { "query": "컬러 그레이딩 적용", "expected": "create_color_grade" },
  { "query": "셋리스트 실행", "expected": "create_setlist_runner" },
  { "query": "import Shadertoy shader", "expected": "import_shadertoy" },
  { "query": "포즈 트래킹", "expected": "create_pose_tracking" },
  { "query": "output mapping", "expected": "setup_output" },
  { "query": "파이썬 API 도움", "expected": "search_python_api", "forbidden": ["execute_python_script"] },
  { "query": "execute_python_script", "risk": "any", "expected": "execute_python_script" }
]
```

- [ ] **Step 2: Write the assembled-catalog evaluation**

Use `connectConfiguredClient("tool-discovery-golden", { TDMCP_TOOL_PROFILE: "core", TDMCP_DYNAMIC_TOOLSETS: "on" })` from Task 8 so the real registration capture builds the 501-entry catalog without contacting TouchDesigner. For each case call the native management tool and validate its structured result:

```ts
const result = await client.callTool({
  name: "discover_tools",
  arguments: {
    query: testCase.query,
    risk: testCase.risk ?? "safe_mutation",
    limit: 5,
  },
});
expect(result.isError).not.toBe(true);
const output = discoverToolsOutputSchema.parse(result.structuredContent);
const names = output.candidates.map((candidate) => candidate.name);
expect(names, testCase.query).toContain(testCase.expected);
for (const forbidden of testCase.forbidden ?? []) {
  expect(names, testCase.query).not.toContain(forbidden);
}
```

Run the fixture twice in the same session and assert the complete structured outputs are deeply equal. Stub `globalThis.fetch` to throw for the test and restore it in `finally`, so an accidental network call fails without contaminating other suites. Close the client/server session in `finally`.

- [ ] **Step 3: Run the evaluation and correct only evidenced alias gaps**

Run:

```bash
rtk test node scripts/run-vitest.mjs run tests/eval/toolDiscoveryGolden.test.ts tests/unit/toolCatalog.test.ts
```

Expected: every expected tool appears in the top five, default safe queries exclude risky tools, and both runs are identical. If a case fails, add the smallest explicit alias/tag entry and rerun; do not tune results with nondeterministic scoring.

- [ ] **Step 4: Commit the evaluation**

Run:

```bash
rtk git add tests/fixtures/tool-discovery-golden.json tests/eval/toolDiscoveryGolden.test.ts src/tools/toolsets/overrides.ts
rtk git commit -m "test: add bilingual tool discovery eval"
```

---

### Task 11: Add Pinned MCP Inspector Stdio Contract Checks

**Files:**
- Create: `scripts/test-mcp-inspector.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: built `dist/index.js`, local `mcp-inspector-cli`, core/dynamic environment, and independent stdio processes.
- Produces: reproducible initialize/list/call/resources/prompts contract evidence without downloading packages during CI.

- [ ] **Step 1: Install the exact CLI-only verifier dependency**

After reviewing the package and lockfile diff, run:

```bash
rtk proxy npm install --save-dev --save-exact @modelcontextprotocol/inspector-cli@0.22.0
```

Expected: `package.json` records exactly `0.22.0`; only `package-lock.json` changes with it. Do not create or update `pnpm-lock.yaml`.

- [ ] **Step 2: Implement a strict subprocess harness**

Create `scripts/test-mcp-inspector.mjs` using `spawn` with a 30-second timeout per invocation. Resolve:

```js
const inspector = resolve("node_modules/.bin/mcp-inspector-cli");
const server = resolve("dist/index.js");
const env = {
  ...process.env,
  TDMCP_TOOL_PROFILE: "core",
  TDMCP_DYNAMIC_TOOLSETS: "on",
  TDMCP_LOG_LEVEL: "silent",
};
```

Spawn the inspector with argument prefix `[process.execPath, server]`; `dist/index.js` is a Node entry point, not a standalone executable. Run these independent commands:

```text
mcp-inspector-cli node <dist/index.js> --method tools/list
mcp-inspector-cli node <dist/index.js> --method tools/call --tool-name get_active_toolset
mcp-inspector-cli node <dist/index.js> --method tools/call --tool-name discover_tools --tool-arg query=오디오_반응형
mcp-inspector-cli node <dist/index.js> --method resources/list
mcp-inspector-cli node <dist/index.js> --method prompts/list
```

Parse exactly one JSON payload from stdout; treat extra non-whitespace stdout as failure. Keep stderr for error reporting. Assert:

```js
assert.deepEqual(toolNames.sort(), [...PROTECTED_CORE_TOOL_NAMES].sort());
assert.equal(active.structuredContent.active_count, 17);
assert.ok(discovery.structuredContent.candidates.some((item) => item.name === "create_audio_reactive"));
assert.ok(resources.resources.length > 0);
assert.ok(prompts.prompts.length > 0);
```

The commands are independent by design; the script does not claim a selection persists across processes.

- [ ] **Step 3: Add the package command and run it against the build**

Add:

```json
"test:mcp:inspector": "node scripts/test-mcp-inspector.mjs"
```

Run:

```bash
rtk npm run build
rtk npm run test:mcp:inspector
```

Expected: five Inspector probes pass using the local pinned binary.

- [ ] **Step 4: Add a Node 22 contract job**

In `.github/workflows/ci.yml`, add `mcp-inspector-contract` using Node 22.x:

```yaml
  mcp-inspector-contract:
    name: MCP Inspector Contract
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10
        with:
          persist-credentials: false
      - uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e
        with:
          node-version: 22.x
          cache: npm
      - run: npm ci
      - run: npm run import:bottobot
      - run: npm run build
      - run: npm run test:mcp:inspector
```

Add the job to `ci-success.needs`, environment result mapping, and required result loop.

- [ ] **Step 5: Run lint and commit the Inspector harness**

Run:

```bash
rtk proxy ./node_modules/.bin/biome check scripts/test-mcp-inspector.mjs
rtk npm run test:mcp:inspector
rtk git diff --check
rtk git add package.json package-lock.json scripts/test-mcp-inspector.mjs .github/workflows/ci.yml
rtk git commit -m "test: add pinned MCP Inspector contracts"
```

Expected: exact dependency version and no floating network execution in the harness or CI.

---

### Task 12: Add Pinned MCP Conformance HTTP Evidence

**Files:**
- Create: `scripts/test-mcp-conformance.mjs`
- Create: `tests/contract/conformance-expected-failures.yml`
- Create: `tests/contract/conformance-expected-failures.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: built stateful HTTP server, pinned Conformance CLI, protocol version 2025-11-25, and loopback host protection.
- Produces: machine-readable active-suite results, explicit fixture-only expected failures, CI artifacts, and a zero-unexplained-failure gate.

- [ ] **Step 1: Install the exact Conformance dependency**

Run after package review:

```bash
rtk proxy npm install --save-dev --save-exact @modelcontextprotocol/conformance@0.2.0-alpha.9
```

Expected: exact version in `package.json`; only `package-lock.json` changes. Do not run any upstream setup script manually.

- [ ] **Step 2: Create the initial fixture-mismatch baseline**

Create `tests/contract/conformance-expected-failures.yml`:

```yaml
server:
  - completion-complete
  - tools-call-simple-text
  - tools-call-image
  - tools-call-mixed-content
  - tools-call-with-logging
  - tools-call-with-progress
  - tools-call-sampling
  - tools-call-elicitation
  - tools-call-audio
  - tools-call-embedded-resource
  - elicitation-sep1034-defaults
  - elicitation-sep1330-enums
  - resources-read-text
  - resources-read-binary
  - resources-templates-read
  - resources-subscribe
  - resources-unsubscribe
  - prompts-get-simple
  - prompts-get-with-args
  - prompts-get-embedded-resource
  - prompts-get-with-image
```

Do not include `tools-call-error`: the upstream scenario accepts any well-formed `isError` result and therefore passes for an unknown fixture tool. Do not include lifecycle, ping, list, logging-level, DNS, resources-list, or prompts-list; tdmcp advertises those and must pass them.

- [ ] **Step 3: Document every baseline entry and removal condition**

Create `tests/contract/conformance-expected-failures.md` with a table containing one row per YAML entry. Use these group explanations while still listing each scenario name:

```markdown
| Scenario | Spec basis | Why expected for tdmcp | Owner | Removal condition |
| --- | --- | --- | --- | --- |
| `completion-complete` | MCP completion/complete | Upstream scenario hard-codes `test_prompt_with_arguments`; tdmcp does not ship conformance fixture prompts. | tdmcp maintainers | Upstream gains capability-aware generic completion or tdmcp adds a test-only fixture server outside production. |
| `tools-call-simple-text` | MCP tools/call | Upstream requires `test_simple_text`; production tdmcp does not expose verifier fixture tools. | tdmcp maintainers | Run against a test-only fixture adapter or upstream makes the scenario generic. |
```

Repeat the tools explanation for each listed tools-call scenario using its exact required fixture name from upstream source; repeat equivalent exact rows for elicitation, resources, and prompts. State that a baseline entry passing is treated as stale and fails CI.

- [ ] **Step 4: Implement the temporary HTTP runner with cleanup**

Create `scripts/test-mcp-conformance.mjs` that:

1. Reserves a free loopback port with `net.createServer().listen(0, "127.0.0.1")`, records the assigned port, then closes the probe.
2. Removes and recreates `artifacts/mcp-conformance` with `fs.rm(outputDir, { recursive: true, force: true })` and `fs.mkdir(outputDir, { recursive: true })`.
3. Spawns `node dist/index.js` with HTTP transport, the selected port, `TDMCP_TOOL_PROFILE=core`, dynamic on, and silent logs.
4. Polls `http://127.0.0.1:<port>/mcp` until it returns any HTTP response, with a 15-second readiness deadline.
5. Spawns the local `node_modules/.bin/conformance` with:

```text
server --url http://127.0.0.1:<port>/mcp
--suite active
--spec-version 2025-11-25
--expected-failures tests/contract/conformance-expected-failures.yml
--output-dir artifacts/mcp-conformance
```

6. Reads every `checks.json`, writes `artifacts/mcp-conformance/summary.json` with counts by SUCCESS/FAILURE/WARNING and scenario, and fails if the CLI exits nonzero or a result is missing.
7. Sends SIGTERM to the server in `finally`, waits five seconds, then SIGKILLs only that recorded child PID if necessary.

Add `.gitignore`:

```gitignore
# Local machine-readable MCP verifier output; CI uploads it as an artifact.
artifacts/mcp-conformance/
```

- [ ] **Step 5: Run once without a baseline to audit actual failures**

Temporarily omit the `--expected-failures` arguments from the local invocation only, then run:

```bash
rtk npm run build
rtk proxy node scripts/test-mcp-conformance.mjs --audit-unbaselined
```

Expected: exit 1 is acceptable only for the named fixture-specific scenarios. Inspect every `checks.json`. If any lifecycle/list/security scenario fails, fix tdmcp or the harness; do not add it to the baseline. Remove any baseline entry that actually passes.

- [ ] **Step 6: Add the package command and verify reconciled results**

Add:

```json
"test:mcp:conformance": "node scripts/test-mcp-conformance.mjs"
```

Run:

```bash
rtk npm run test:mcp:conformance
```

Expected: exit 0, no stale baseline entries, no unexplained failures, and populated machine-readable output.

- [ ] **Step 7: Add CI execution and artifact upload**

Add a Node 22 `mcp-conformance` job to `.github/workflows/ci.yml` that installs, imports the knowledge base, builds, runs `npm run test:mcp:conformance`, and always uploads `artifacts/mcp-conformance` using the already-pinned `actions/upload-artifact` SHA with `if-no-files-found: error`. Add the result to `ci-success` just like Inspector.

- [ ] **Step 8: Run harness checks and commit**

Run:

```bash
rtk npm run test:mcp:conformance
rtk proxy ./node_modules/.bin/biome check scripts/test-mcp-conformance.mjs
rtk git diff --check
rtk git add package.json package-lock.json scripts/test-mcp-conformance.mjs tests/contract/conformance-expected-failures.yml tests/contract/conformance-expected-failures.md .gitignore .github/workflows/ci.yml
rtk git commit -m "test: add pinned MCP conformance harness"
```

Expected: artifact output stays ignored and no server child remains running.

---

### Task 13: Document Package Behavior, Fallbacks, and Provenance

**Files:**
- Modify: `README.md`
- Modify: `docs/reference/environment.md`
- Modify: `docs/reference/architecture.md`
- Modify: `scripts/gen-tool-docs.ts`
- Modify: `mcpb/manifest.json`
- Modify: `server.json`
- Modify: `safeskill.manifest.json`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: final configuration, profile membership, management schemas, verifier commands, and approved provenance policy.
- Produces: accurate end-user setup, static fallback, registry choices, generated tool reference, rollback instructions, and source attribution.

- [ ] **Step 1: Update environment and architecture references**

Add rows to `docs/reference/environment.md` for the three new variables with exact defaults. Expand `TDMCP_TOOL_PROFILE` to all eight values. Add a dynamic-toolset section to architecture covering:

```text
one manager per createTdmcpServer call
one manager per HTTP session through the existing server factory
discover -> validate -> lifecycle batch -> one tools/list_changed
protected core and raw/destructive gates
static fallback when a client does not refresh
```

Include the exact fallback:

```toml
TDMCP_TOOL_PROFILE = "build"
TDMCP_DYNAMIC_TOOLSETS = "off"
```

State that `client_refresh_required: true` is a hint, not acknowledgement.

- [ ] **Step 2: Update README and generated tool docs**

README must show package-compatible defaults and the personal compact example:

```toml
[mcp_servers.tdmcp.env]
TDMCP_TOOL_PROFILE = "core"
TDMCP_DYNAMIC_TOOLSETS = "on"
```

Describe `discover_tools`, `select_toolset`, `get_active_toolset`, and `reset_toolset`, including explicit risky opt-in and the static-client fallback.

In `scripts/gen-tool-docs.ts`, import `utilRegistrars`, capture them with a context containing `dynamicToolsets: true`, add a `Dynamic toolset management` group, and keep the generated total at 501. Do not hand-edit generated `docs/reference/tools.md`; regenerate through the script.

- [ ] **Step 3: Expose config choices in distribution manifests**

In `mcpb/manifest.json`, pass through `TDMCP_DYNAMIC_TOOLSETS`, `TDMCP_TOOL_MAX_ACTIVE`, and `TDMCP_TOOL_METADATA_BUDGET_KB`; add corresponding user config entries with defaults off/120/256. Expand the profile description to all eight values.

In `server.json`, retain registry default `directory`, expand profile choices, and add dynamic mode default `off`. Do not change package version in this implementation wave.

Update `safeskill.manifest.json` to say presets are safe by construction and risky tools require exact opt-in plus existing approval/environment gates.

- [ ] **Step 4: Record provenance and release notes**

Under `CHANGELOG.md` Unreleased, record compact dynamic toolsets, bilingual offline discovery, session isolation, metadata budgets, and pinned Inspector/Conformance gates.

Add a provenance table in `docs/reference/architecture.md` with the exact research snapshots:

```markdown
| Source | Reviewed commit/version | License evidence | Use in this wave |
| --- | --- | --- | --- |
| `modelcontextprotocol/typescript-sdk` | `69749aa5081ddfe675d36da8d96c7e27d83742b8`, production v1 API | reviewed checkout `LICENSE`: MIT | Public `RegisteredTool` lifecycle and `tools/list_changed`; no source copy. |
| `modelcontextprotocol/inspector` | `ebd0550fecea0f398aae4997a9c8189727aec6e0`, CLI `0.22.0` | package says `SEE LICENSE IN LICENSE`; bundled license records the MCP Apache-2.0/MIT transition | Exact dev dependency and subprocess contract probes. |
| `modelcontextprotocol/conformance` | `d1c0b9591786726d8a4bec05306eb103ba6894ff`, `0.2.0-alpha.9` | package metadata says MIT; bundled license records the MCP Apache-2.0/MIT transition | Exact dev dependency and machine-readable protocol checks. |
| `stacklok/toolhive` | `52ecebcca4eb5bda15b26fd0aac00bd2298bfc1c` | Apache-2.0 | Policy/exposure ideas only; no source copy. |
| `openai/openai-agents-js` | `f7771c177e100a62a5b99f0d8cd5e97300eda6ea` | MIT | Deferred agent-runtime ideas; no runtime dependency or source copy. |
| `lastmile-ai/mcp-agent` | `f62d849350816588b1c6294e7914bbe4d8b84072` | Apache-2.0 | Deferred workflow ideas; no Python rewrite or source copy. |
```

Also state that FastMCP and PydanticAI were reference-only, and that no ToolHive, OpenAI Agents JS, mcp-agent, FastMCP, or PydanticAI runtime code is copied into tdmcp in this wave. If installed-package license metadata differs from a repository README, preserve the bundled `LICENSE` wording and report both instead of simplifying it.

- [ ] **Step 5: Regenerate and verify docs**

Run:

```bash
rtk npm run docs:gen
rtk npm run docs:build
rtk npm run tools:metadata:check
rtk test node scripts/run-vitest.mjs run tests/unit/mcpbManifest.test.ts
rtk git diff --check
```

Expected: docs report 501 total tools, VitePress builds, manifest tests pass, and generated metadata remains current.

- [ ] **Step 6: Commit the documentation slice**

Run:

```bash
rtk git add README.md docs/reference/environment.md docs/reference/architecture.md scripts/gen-tool-docs.ts docs/reference/tools.md mcpb/manifest.json server.json safeskill.manifest.json CHANGELOG.md
rtk git commit -m "docs: document dynamic MCP toolsets"
```

If `docs/reference/tools.md` is ignored rather than tracked, omit it from `git add` and record that the docs build regenerated it successfully.

---

### Task 14: Run Final QA, Apply the Personal Codex Rollout, and Verify Rollback

**Files:**
- Modify (ignored audit evidence): `_workspace/quality-audit/06_qa.md`
- Modify after all offline PASS results: `~/.codex/config.toml`

**Interfaces:**
- Consumes: all implementation commits, the `verification-before-completion` skill, quality-audit QA, and current Codex MCP entry.
- Produces: final PASS/FAIL/UNVERIFIED evidence, compact personal configuration, measured <=20/64KiB startup surface, and a tested rollback instruction.

- [ ] **Step 1: Run narrow verifier commands first**

Run:

```bash
rtk npm run tools:metadata:check
rtk test node scripts/run-vitest.mjs run tests/unit/toolMetadata.test.ts tests/unit/toolProfiles.test.ts tests/unit/toolCatalog.test.ts tests/unit/toolsetManager.test.ts tests/unit/toolsetManagementTools.test.ts tests/integration/dynamicToolsets.test.ts tests/integration/httpDynamicToolsets.test.ts tests/eval/toolDiscoveryGolden.test.ts
rtk npm run test:mcp:inspector
rtk npm run test:mcp:conformance
```

Expected: every focused command passes; Conformance has zero unexplained failures and zero stale baseline entries.

- [ ] **Step 2: Run every relevant repository gate**

Run each separately and preserve its exit code:

```bash
rtk npm run typecheck
rtk npm run build
rtk npm run lint
rtk test npm test
rtk npm run test:coverage
rtk test npm run test:bridge
rtk npm run validate:recipes
rtk npm run docs:build
rtk proxy make complexity
rtk npm run deps:check
rtk npm run coverage:harness
rtk git diff --check
```

Expected: every offline gate passes without lowering coverage or complexity thresholds. If a command changes generated files, inspect the diff and keep only intentional outputs.

- [ ] **Step 3: Re-run quality QA on the patch wave**

Dispatch `tdmcp-quality-qa` with all audit reports, implementation diffs, and command outputs. Update `_workspace/quality-audit/06_qa.md` with:

```markdown
## Final status
- PASS: configuration defaults and validation
- PASS: static 497/458/15 compatibility
- PASS: dynamic 501/462/19 and core 17 counts
- PASS: core <=65,536 bytes and presets <=120/262,144
- PASS: risky/raw gate composition and atomic rollback
- PASS: stdio list-change and HTTP session isolation
- PASS: bilingual top-five discovery evaluation
- PASS: Inspector and explained Conformance results
- UNVERIFIED: checks requiring an unavailable TouchDesigner bridge or physical hardware
```

Replace any line with FAIL if its evidence command failed. QA must approve before personal config mutation.

- [ ] **Step 4: Confirm the personal config target without exposing secrets**

Run:

```bash
codex mcp get tdmcp --json
```

Expected: stdio command still points to the bundled Node runtime and this checkout's `dist/index.js`; current env has no dynamic override. Do not print unrelated config sections or secret values.

- [ ] **Step 5: Patch only the tdmcp environment table**

Use `apply_patch` on `~/.codex/config.toml`, requesting filesystem approval for that exact file if required. Add beneath the existing `[mcp_servers.tdmcp]` command/args fields and before any nested per-tool tables:

```toml
[mcp_servers.tdmcp.env]
TDMCP_TOOL_PROFILE = "core"
TDMCP_DYNAMIC_TOOLSETS = "on"
```

Do not remove or rewrite any existing `[mcp_servers.tdmcp.tools.*]` approval settings. Do not use `codex mcp remove`, because that would discard nested approval configuration.

- [ ] **Step 6: Verify configured and measured startup surfaces**

Run:

```bash
codex mcp get tdmcp --json
rtk npm run build
rtk test node scripts/run-vitest.mjs run tests/integration/dynamicToolsets.test.ts -t "initial core"
```

Expected: config JSON shows only the two non-secret env values; the measured list is exactly 17 tools and <=65,536 bytes. Note that the already-running Codex task may require an app restart before its UI refreshes; do not claim that unobservable refresh passed.

- [ ] **Step 7: Record and dry-check rollback**

Document the exact rollback without applying it:

```toml
[mcp_servers.tdmcp.env]
TDMCP_TOOL_PROFILE = "full"
TDMCP_DYNAMIC_TOOLSETS = "off"
```

Prove the rollback runtime path through an isolated test process:

```bash
rtk test node scripts/run-vitest.mjs run tests/integration/toolProfile.test.ts -t "static full"
```

Expected: static full lists exactly 497 original tools. Personal config remains compact unless the user explicitly asks to roll back.

- [ ] **Step 8: Verify repository cleanliness and commit scope**

Run:

```bash
rtk git status --short --branch
rtk git log --oneline --decorate -15
rtk git diff origin/main --stat
```

Expected: all planned repository files are committed, `pnpm-lock.yaml` is still the sole unrelated untracked file, and no publish/tag/push action occurred. The personal config is outside git.

---

## Approved Design Coverage Matrix

| Approved design area | Implementation/evidence task |
| --- | --- |
| Compatibility defaults, eight profiles, package limits | Task 2; exact count regression in Task 7 |
| Native lifecycle architecture and one interception pipeline | Tasks 4, 6, and 7 |
| Exact 13/17 core and explicit inspect/build/show/library membership | Task 5; protocol checks in Task 8 |
| Four native management tools and structured errors | Tasks 6 and 7 |
| Risk, raw-Python, protected-core, count, and byte gates | Task 6; MCP regression in Task 8 |
| Immutable 497-tool contracts and generated 501-entry metadata | Tasks 3 and 7 |
| Korean/English deterministic discovery and close matches | Tasks 5 and 10 |
| One list-change event, disabled-call behavior, and stdio-local state | Task 8; built stdio probes in Task 11 |
| One manager per Streamable HTTP session | Task 9 |
| Pinned Inspector and Conformance evidence | Tasks 11 and 12 |
| Source comparison, exact commits, licenses, and no copied runtime code | Task 13 |
| Quality audit, full gates, honest hardware status, personal rollout, rollback | Tasks 1 and 14 |
| Deferred agent runtime, process sandbox, Python sidecars, and SDK v2 migration | Explicitly excluded by Global Constraints; no implementation task |

---

## Final Acceptance Checklist

- [ ] Static `full`/`safe`/`directory` are 497/458/15.
- [ ] Dynamic `full`/`safe`/`directory` are 501/462/19; dynamic `core` is 17.
- [ ] Core is <=65,536 serialized bytes; ordinary presets are <=120 tools and <=262,144 bytes.
- [ ] Original 497 names and fingerprints match `tests/fixtures/tool-contract-baseline.json`.
- [ ] A failed transition changes zero handle states; a success emits one list-change notification.
- [ ] Presets contain no raw/destructive tools; explicit risky activation respects raw-Python and Codex approval gates.
- [ ] Two HTTP clients can hold different selections without leakage.
- [ ] All 25 golden queries retrieve the expected tool in the top five.
- [ ] Inspector passes from local pinned dependencies.
- [ ] Conformance has no unexplained active-suite failure and no stale baseline.
- [ ] Existing type, build, lint, test, coverage, bridge, recipe, docs, complexity, and dependency gates pass.
- [ ] Personal Codex config selects core/dynamic while retaining every per-tool approval entry.
- [ ] `pnpm-lock.yaml` is untouched and uncommitted.
- [ ] Live/hardware status is reported as actual PASS, FAIL, or UNVERIFIED.
