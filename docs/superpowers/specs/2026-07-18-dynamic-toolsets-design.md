# Dynamic MCP Toolsets and Contract Verification

**Date:** 2026-07-18

**Status:** Approved design

**Target:** `tdmcp` MCP server and the owner's Codex MCP configuration

## Summary

`tdmcp` currently exposes its entire tool surface to Codex. A local measurement of
the assembled MCP server found 497 tools and 1,025,214 bytes of serialized tool
metadata in the `full` profile. The existing `safe` profile removes 39 destructive
tools but still exposes 458 tools and 960,525 bytes. The `directory` profile proves
that a compact surface is possible: 15 tools and 26,276 bytes.

This project adds session-local, native MCP toolset selection. A compact core is
visible at startup; the client searches the complete internal catalog and activates
the real tools it needs. Activation uses the official TypeScript SDK's registered
tool lifecycle and `tools/list_changed` notification. Tool names, input and output
schemas, annotations, handlers, and Codex approval boundaries remain intact, except
for the bounded correction of the independently verified pre-existing macro
nested-dispatch defect described below.

The same wave adds pinned MCP Inspector and MCP Conformance checks, deterministic
tool-discovery evaluations, and metadata budgets. It does not copy whole external
projects or replace the existing TypeScript architecture.

## Context and measured baseline

The repository already has strong foundations:

- strict TypeScript and Zod validation;
- 497 assembled MCP tools across artist, foundation, library, AI, CLI, and atomic
  TouchDesigner layers;
- read/write/destructive MCP annotations on all assembled tools;
- `full`, `safe`, and `directory` exposure profiles;
- stdio plus stateful Streamable HTTP, with one `McpServer` instance per HTTP
  session;
- in-memory MCP integration tests, Vitest coverage gates, Python bridge tests,
  recipe validation, docs generation, and complexity ratchets.

The baseline was measured on 2026-07-18 by connecting an in-memory SDK client to a
fresh `createTdmcpServer` instance and serializing the result of `tools/list`.

| Profile | Tools | Metadata bytes | Description characters | Input-schema characters | Output schemas | Destructive |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `full` | 497 | 1,025,214 | 228,602 | 600,710 | 54 | 39 |
| `safe` | 458 | 960,525 | 211,761 | 567,074 | 49 | 0 |
| `directory` | 15 | 26,276 | 6,248 | 7,844 | 7 | 0 |

The owner's current Codex MCP entry does not set `TDMCP_TOOL_PROFILE`, so the
package default of `full` is active. Per-tool approval settings exist for a subset
of mutating tools, but approval settings do not reduce the initial tool catalog.

The worktree also contains an unrelated untracked `pnpm-lock.yaml`. This project
must not stage, modify, remove, or commit that file.

## External-source assessment

The following repositories were reviewed as design sources. Source code may only
be copied when the license permits it and the copied file or excerpt retains the
required notice. Prefer a local implementation of the pattern over copying code.

| Source | License | Decision | Useful pattern |
| --- | --- | --- | --- |
| [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) `v1.x` | MIT / Apache-2.0 | Adopt public SDK lifecycle | `RegisteredTool` enable/disable state and `tools/list_changed` |
| [modelcontextprotocol/inspector](https://github.com/modelcontextprotocol/inspector) | MIT | Add as pinned contract-test dependency | stdio/HTTP `tools/list` and `tools/call` CLI probes |
| [modelcontextprotocol/conformance](https://github.com/modelcontextprotocol/conformance) | Apache-2.0 | Add as pinned protocol-test dependency | spec-referenced server scenarios and machine-readable results |
| [stacklok/toolhive](https://github.com/stacklok/toolhive) | Apache-2.0 | Adapt ideas only | compact tool exposure, policy gates, local auditability |
| [openai/openai-agents-js](https://github.com/openai/openai-agents-js) | MIT | Defer to a later agent-runtime wave | guardrails, sessions, tracing, human approval |
| [lastmile-ai/mcp-agent](https://github.com/lastmile-ai/mcp-agent) | Apache-2.0 | Defer; do not rewrite the core in Python | workflow composition and durable execution |
| [PrefectHQ/fastmcp](https://github.com/PrefectHQ/fastmcp) | Apache-2.0 | Reference only | ergonomic Python MCP composition |
| [pydantic/pydantic-ai](https://github.com/pydantic/pydantic-ai) | MIT | Defer to an evaluation/agent wave | typed evals, approval, and observability |

The official TypeScript SDK v2 branch is pre-alpha as of the research date. This
wave stays on the production-recommended v1.x line and does not combine a protocol
generation migration with toolset work.

## Goals

1. Reduce the owner's default Codex tool surface from 497 tools to at most 20 and
   at most 64 KiB of serialized metadata.
2. Let an MCP client discover and activate real tdmcp tools without a generic
   invocation proxy.
3. Preserve every existing tool name, schema, annotation, handler, and environment
   gate in `full` mode.
4. Keep activation state isolated per stdio process or HTTP MCP session.
5. Prevent semantic discovery or presets from silently enabling raw-code or
   destructive tools.
6. Add deterministic discovery evaluations, Inspector contract tests, and MCP
   Conformance reporting to the existing quality gates.
7. Preserve package-level compatibility while making the owner's Codex connection
   use the compact dynamic mode.

## Non-goals

- Migrating to the TypeScript SDK v2 pre-alpha API.
- Replacing the tdmcp server or local copilot with a Python framework.
- Adding ToolHive, Docker, Kubernetes, an embedding model, or an external vector
  database as a runtime dependency.
- Hiding all tool calls behind an `invoke_tool` or arbitrary dispatch tool.
- Changing any of the 497 existing tool implementations in the first wave, except
  for the bounded `run_macro_script` nested-dispatch safety correction required by
  this design.
- Claiming TouchDesigner, GPU, camera, DMX, mixer, or venue validation without
  running that hardware.
- Publishing, tagging, pushing, or changing upstream release policy.

## Compatibility and defaults

The npm package retains its existing defaults and exact legacy surface:

- `TDMCP_TOOL_PROFILE=full` when unset;
- dynamic toolsets disabled when unset.

When dynamic mode is off, the four management tools are not registered. Therefore
legacy `full`, `safe`, and `directory` remain exactly 497, 458, and 15 tools. When
dynamic mode is on, the four protected management tools and all protected existing
core tools are unioned into the selected profile. Dynamic `full` and `safe` therefore
expose 501 and 462 tools. Dynamic `directory` is the exact union of the legacy
15-tool directory surface and the protected 17-tool core: 22 tools, because
`get_preview`, `get_td_node_errors`, and `summarize_td_errors` are protected but are
not in the legacy directory profile. Dynamic `full` is a startup/reset compatibility
state only; it is never selectable from a compact session. When a dynamic session
starts in legacy `safe`, initialization and reset likewise preserve the exact
462-tool compatibility surface despite ordinary count/byte budgets. Selecting
`safe` from a compact session remains subject to the configured budgets.

The owner's Codex configuration changes only after implementation and verification:

```toml
[mcp_servers.tdmcp.env]
TDMCP_TOOL_PROFILE = "core"
TDMCP_DYNAMIC_TOOLSETS = "on"
```

This separates a personal optimization from a package-wide breaking default. The
existing `full`, `safe`, and `directory` profiles remain supported. New static
profiles are `core`, `inspect`, `build`, `show`, and `library`.

New configuration fields are:

| Variable | Package default | Meaning |
| --- | --- | --- |
| `TDMCP_DYNAMIC_TOOLSETS` | `off` | Enables session-local management tools and runtime toolset changes |
| `TDMCP_TOOL_MAX_ACTIVE` | `120` | Maximum active tools in dynamic mode; only initialization/reset to a legacy `full` or `safe` startup state bypasses it |
| `TDMCP_TOOL_METADATA_BUDGET_KB` | `256` | Maximum serialized metadata for a dynamic selection; only initialization/reset to a legacy `full` or `safe` startup state bypasses it |

Invalid values fail through the existing configuration validation path. The core
profile also has a non-configurable CI acceptance ceiling of 20 tools and 64 KiB.

## Architecture

Each `createTdmcpServer` call owns one `ToolCatalog` and one `ToolsetManager`.
Because the HTTP transport already constructs a separate MCP server for every
session, no new cross-session state store is needed.

```text
MCP client
  -> core tools
     -> discover_tools -> ToolCatalog
     -> select_toolset -> policy + budget validation
                        -> RegisteredTool enabled-state transaction
                        -> one tools/list_changed notification
  -> refreshed tools/list
  -> original tdmcp tool handler with original schema and annotations
```

### Tool catalog

The catalog contains one entry per assembled tool:

```ts
interface ToolCatalogEntry {
  name: string;
  title?: string;
  summary: string;
  group: "layer1" | "layer2" | "layer3" | "foundation" | "library" | "vault" | "ai" | "cli" | "util";
  tags: string[];
  presets: ToolsetPreset[];
  readOnly: boolean;
  destructive: boolean;
  rawCode: boolean;
  openWorld: boolean;
  metadataBytes: number;
}
```

Registration is captured centrally. Individual tool files continue to call
`server.registerTool` in their existing pattern. The registration layer records
the returned `RegisteredTool` handle and the current registrar group. A small,
reviewable override map supplies bilingual aliases, preset membership, and the
few risk facts that cannot be inferred from MCP annotations.

The existing macro-recorder wrapper and profile-filter wrapper must not become an
unreviewable stack of monkey patches. Registration interception is consolidated
into one pipeline with explicit stages:

1. wrap the handler for macro recording;
2. register the real tool once;
3. capture the lifecycle handle and metadata;
4. apply the startup profile's enabled state.

Resources and prompts register after this pipeline and are not filtered.

### Exact core surface

When dynamic mode is enabled, its management tools are always enabled and cannot
disable themselves. The dynamic `core` profile contains these 17 tools:

1. `get_td_info`
2. `discover_tools`
3. `select_toolset`
4. `get_active_toolset`
5. `reset_toolset`
6. `search_operators`
7. `get_td_classes`
8. `get_operator_workflow_guide`
9. `find_td_nodes`
10. `get_td_node_parameters`
11. `get_td_node_flags`
12. `get_td_topology`
13. `get_td_node_errors`
14. `summarize_td_errors`
15. `get_preview`
16. `validate_operator_chain`
17. `list_recipes`

If the serialized surface exceeds 64 KiB, the acceptance gate fails and the core
membership must be redesigned. Existing tool descriptions, semantics, and schemas
are not silently shortened or weakened to satisfy the budget.

### Static profiles

- `core`: the 13 existing non-management tools above in static mode; the exact
  protected 17-tool surface above in dynamic mode.
- `inspect`: `core` plus curated read-only analysis, documentation, performance,
  topology, and knowledge tools.
- `build`: `core` plus at most 103 common non-destructive Layer 1, Layer 2, and
  foundation builders; no raw-code or destructive tools.
- `show`: `core` plus cue, setlist, monitoring, preview, rehearsal, and policy-safe
  show tools. Live physical dispatch remains behind existing environment and
  approval gates.
- `library`: `core` plus browsing, searching, diffing, validation, and read-only
  recipe/vault/package tools. Import, export, installation, publication, and file
  overwrite tools require explicit selection.
- `safe`: unchanged 458-tool legacy behavior in static mode; dynamic mode adds the
  four protected management tools. A session started in dynamic `safe` initializes
  and resets to exactly 462 as a legacy compatibility exemption from ordinary
  budgets; selecting `safe` from a compact session still enforces those budgets.
- `directory`: unchanged exact 15-tool registry-facing surface in static mode;
  dynamic mode exposes the exact 22-tool union of that legacy surface and the
  protected core so the session can leave the profile without a restart.
- `full`: unchanged 497-tool legacy surface in static mode. Dynamic mode adds the
  four protected management tools, but this 501-tool state exists only when the
  session starts in `full` and when that same session resets to its startup state.
  It cannot be selected from a compact session.

Preset membership is explicit and snapshot-tested. It is not inferred at runtime
from naming conventions alone.

## MCP management tools

All four new tools have Zod input schemas, Zod output schemas, structured content,
concise text summaries, and non-destructive annotations. Every advertised result is
a discriminated envelope: `ok: true` for success or `ok: false` with a stable error
code and code-specific allowlisted public details. Profile state is one of the eight
configured profile names or `custom`: preset replacement reports that preset,
explicit replacement and every add report `custom`, and reset reports the startup
profile.

### `discover_tools`

Input:

```ts
{
  query: string;
  preset?: "core" | "inspect" | "build" | "show" | "library";
  risk?: "read_only" | "safe_mutation" | "any";
  limit?: number; // 1..20, default 10
}
```

Output contains the normalized query and ranked candidates with `name`, `summary`,
`group`, `presets`, `risk`, `score`, and a short `reason`. It never returns full
input schemas. Candidates marked destructive or raw code are omitted unless
`risk: "any"`; even then discovery does not activate them.

Ranking is deterministic and offline:

1. exact tool-name or alias match;
2. tool-name token and prefix matches;
3. curated tag and bilingual Korean/English alias matches;
4. title and short-summary token matches;
5. optional preset affinity;
6. stable tool-name ordering for ties.

No LLM, embedding service, network call, user telemetry, or mutable learning index
participates in ranking.

### `select_toolset`

Input:

```ts
{
  preset?: "core" | "inspect" | "build" | "show" | "library" | "safe" | "directory";
  tools?: string[];
  mode?: "replace" | "add"; // default replace
  include_risky?: boolean;  // default false
}
```

Exactly one of `preset` or `tools` is required. `include_risky` is valid only with
an explicit `tools` list; it cannot make a preset risky. The result reports the
previous and current profile, active count, metadata bytes, added and removed tool
names, warnings, and `client_refresh_required: true`. `full` is deliberately absent
from the selector schema; only startup and reset may establish a dynamic full state.

### `get_active_toolset`

Returns the startup profile, current profile, active names, active count, metadata
bytes, count and byte budgets, dynamic-mode status, and protected core names.

### `reset_toolset`

Atomically returns the session to its startup profile. In the owner's Codex
configuration this means `core`; in an unchanged installation it means `full`.

## Activation transaction and safety policy

Every transition follows this order:

1. Resolve the requested preset or explicit names.
2. Add the protected core management surface when dynamic mode is enabled.
3. Reject unknown names and suggest close catalog matches.
4. Reject destructive or raw-code tools unless each was named explicitly and
   `include_risky` is true.
5. Reapply existing configuration gates. In particular, raw-code tools cannot be
   activated when `TDMCP_RAW_PYTHON=off`, regardless of `include_risky`.
6. Calculate the exact count and generated serialized-metadata budget.
7. Reject an over-budget selection with the largest metadata contributors and
   smaller preset suggestions. Only initialization or reset to a session whose
   startup profile is legacy `full` or `safe` bypasses the ordinary budgets;
   selecting `safe` from a compact session does not bypass them.
8. Compute the complete before/after enabled-state map.
9. Apply enabled states as one in-process transaction and emit one
   `tools/list_changed` notification.
10. Return the transition report and a client refresh hint.

All validation occurs before state mutation. An error leaves the prior active set
unchanged. The management tools and protected core cannot be removed. The pinned
SDK's high-level notification method does not expose delivery acknowledgement, so
the server never claims that the client refreshed.

The MCP protocol does not let a server reliably detect whether every client UI
reacted to `tools/list_changed`. Therefore `select_toolset` always returns
`client_refresh_required: true`. Clients that do not refresh use a static profile
selected at process startup.

Original handlers remain the authorization boundary. Dynamic selection never
executes a selected tool, weakens its schema, changes its annotation, or bypasses
Codex's per-tool approval configuration. `run_macro_script` is the only existing
direct nested-dispatch path and must enforce the same-session active set before each
entry, reject every raw-code or destructive target even when active, and validate
the target arguments against its captured input contract before invoking the safe
handler. Invalid, inactive, raw-code, or destructive entries never reach their
handlers and cannot change state; the raw-Python environment gate remains
authoritative as defense in depth.

## Metadata generation and drift control

A build-time generator assembles the real server under an explicit allowlisted
environment, connects an in-memory MCP client, calls `tools/list`, and records
per-tool serialized bytes plus stable schema fingerprints. Every registration
admission decision, including `TDMCP_RAG_APPLY_CARD`, comes from parsed
`ToolContext`; registrar arrays are never mutated from module-global `process.env`.
The committed generated manifest is the runtime source for byte-budget validation.

The generator has two commands:

- generate/update the manifest intentionally;
- regenerate into a temporary location and fail CI when the committed manifest
  drifts.

This follows the conformance project's useful traceability principle: measure the
assembled runtime surface rather than attempting to infer it from source text.
Generated metadata must not contain secrets, environment values, or handler code.
Same-process off/on and on/off construction tests prove order independence, and a
sentinel secret key/value test proves neither generated output nor logs retain it.

## Data flow examples

### Normal build request

1. Codex initially sees `core`.
2. It calls `discover_tools({ query: "오디오 반응형 비주얼 만들기" })`.
3. Discovery returns safe high-level audio-reactive builders and the `build`
   preset, without enabling anything.
4. Codex calls `select_toolset({ preset: "build" })`.
5. The manager validates risk and budgets, updates enabled states, and announces a
   tool-list change.
6. Codex refreshes and calls the original `create_audio_reactive` tool.
7. The existing create -> verify -> preview workflow runs unchanged.

### Risky explicit request

1. Discovery may show `execute_python_script` only under `risk: "any"` and marks it
   raw/destructive.
2. A preset can never activate it.
3. Explicit activation requires its exact name and `include_risky: true`.
4. `TDMCP_RAW_PYTHON=off` still blocks activation.
5. If active, calling it remains subject to its original schema, annotations, and
   Codex approval policy.

### Client without dynamic-list refresh

1. Selection succeeds server-side and returns `client_refresh_required: true`.
2. If the client does not show the new list, documentation directs the user to set
   a static profile such as `TDMCP_TOOL_PROFILE=build` and restart that client.
3. The server does not claim that an unobservable UI refresh succeeded.

## Error handling

All management-tool failures return `isError: true`, concise text, and a structured
`ok: false` envelope. Error codes are stable strings suitable for tests and clients:

- `dynamic_toolsets_disabled`
- `invalid_selection`
- `unknown_tool`
- `risky_tool_requires_explicit_opt_in`
- `raw_python_disabled`
- `active_tool_limit_exceeded`
- `metadata_budget_exceeded`
- `protected_core_tool`
- `toolset_transition_failed`

Unknown-tool errors include close matches. Budget errors include requested counts,
bytes, limits, largest contributors, and suggested presets. Error serialization is
code-specific and allowlists only public tool names, counts, limits, close matches,
and metadata contributors. No arbitrary error object is spread into a result or log;
sentinel token, path, schema, and handler strings must remain absent from both.

## Verification design

Results are reported in `PASS`, `FAIL`, and `UNVERIFIED` buckets. A live or hardware
check is never promoted to `PASS` unless it actually ran.

### Unit tests

- catalog entry validation and unique names;
- exact preset membership and protected core membership;
- bilingual alias normalization and deterministic scoring;
- stable tie ordering;
- discovery risk filters and result limits;
- explicit risky opt-in and raw-Python gate composition;
- count and metadata budget rejection;
- atomic failure with zero active-state changes;
- reset behavior, including a default-budget dynamic `safe` startup that transitions
  away and resets to the exact 462-tool compatibility surface;
- stable error codes, discriminated success/error parsing, `custom` profile-state
  semantics, and allowlisted redaction;
- synchronous transition calls execute in call-arrival order without inventing
  asynchronous lifecycle handles;
- macro replay permits only active safe targets and validates target inputs before
  invocation.

### MCP integration tests

- initial `core` list has exactly the approved 17 tools;
- dynamic `directory` is the exact 22-name union of legacy directory and protected
  core, while static `directory` remains exactly 15;
- serialized core metadata is at most 65,536 bytes;
- every preset selected from a compact session is subject to the configured
  120-tool/262,144-byte defaults;
- `build`, `show`, and `library` contain zero raw/destructive tools by default;
- selecting a toolset emits a list-change notification and exposes the original
  tool schema and annotations;
- a disabled tool cannot be called through MCP;
- unknown and over-budget transitions leave the prior list unchanged;
- a compact session cannot select `full`; a dynamic session started in `full`
  retains all pre-change tool names and stable schema fingerprints and reset returns
  to that startup state;
- a dynamic session started in `safe` under default budgets exposes exactly 462,
  can transition away, and resets to the exact 462-tool startup state, while compact
  selection of `safe` remains budget-checked;
- two HTTP sessions can select different toolsets without cross-session leakage;
- stdio retains one session-local active set.

### Golden discovery evaluation

At least 20 fixed English and Korean requests cover inspection, audio reaction,
GLSL, recipes, preview, node layout, live-show rehearsal, library search, and raw
Python. The expected tool must appear in the top five. Risky tools must not appear
for an ordinary safe query. The evaluation is deterministic and runs without a
model or network.

### Inspector contract checks

A pinned MCP Inspector CLI version tests the built stdio server:

- initialize;
- `tools/list` in core mode;
- call `get_active_toolset`;
- call `discover_tools`;
- verify resources and prompts remain available.

Inspector CLI invocations are independent processes, so a dynamic selection cannot
be assumed to persist from one invocation to the next. Selection followed by a
second list on the same connection is covered by the in-memory MCP integration
suite instead.

The harness uses a local built package and does not download floating `latest`
packages during CI.

### MCP Conformance checks

A pinned MCP Conformance version tests a temporary loopback HTTP server. Results
are stored as machine-readable artifacts and summarized by spec reference. Optional
features that tdmcp does not advertise are not failures. Missing prerequisites for
advertised behavior are failures, not silent skips. Any temporary expected-failure
file must name the exact scenario, spec basis, owner, and removal condition.

### Existing gates

The relevant final verification includes:

- `npm run typecheck`
- `npm run build`
- Biome/lint gates
- focused and full Vitest suites
- `npm run test:bridge`
- `npm run validate:recipes`
- docs build
- complexity ratchets
- dependency checks
- coverage harness/gate
- Inspector contract suite
- MCP Conformance suite

TouchDesigner, GPU, camera, DMX, mixer, and venue behavior remains `UNVERIFIED` if
the required bridge or hardware is unavailable. The dynamic catalog itself is fully
testable offline.

## Acceptance criteria

The implementation is accepted only when all of the following are evidenced:

1. The owner's configured startup surface contains at most 20 tools and 64 KiB of
   metadata.
2. Every selection made from a compact session respects the configured 120-tool and
   256-KiB defaults. Only initialization/reset to a legacy `full` or `safe` startup
   state is exempt.
3. `build`, `show`, and `library` activate no raw-code or destructive tools.
4. Static `full` remains exactly the existing 497 tools. Dynamic `full` contains
   those 497 unchanged tools plus the four management tools only as a startup/reset
   compatibility state and is never selectable from a compact session. Dynamic
   `safe` is exactly 462 when initialized/reset as the startup compatibility state,
   but compact selection of `safe` remains budget-bound. Static `directory` remains
   15 and dynamic `directory` is the exact protected-core union, 22. Existing schema
   fingerprints remain unchanged unless an independently verified pre-existing
   defect requires a documented fix.
5. A failed transition changes zero enabled states.
6. HTTP session isolation and stdio behavior pass integration tests.
7. Every golden request finds the expected tool within the top five.
8. Inspector contract checks pass.
9. MCP Conformance results contain no unexplained active-suite failures.
10. Existing repository gates remain at or above their current thresholds.
11. Live and hardware-dependent checks are reported honestly as PASS, FAIL, or
    UNVERIFIED.
12. The user's unrelated `pnpm-lock.yaml` remains untouched and uncommitted.
13. README, English and Portuguese references, Smithery, deployment, MCPB, and
    registry surfaces agree on profile choices, counts, defaults, refresh fallback,
    and legacy rollback.

## Rollout

1. Run the repository quality-audit baseline and capture command, security, UX,
   refactor/test, and QA evidence before behavior edits.
2. Add the catalog model, explicit preset manifest, metadata generator, and budget
   tests without changing the active default.
3. Add the four management tools and session-local lifecycle manager.
4. Add in-memory and HTTP isolation tests, then Inspector and Conformance harnesses.
5. Run the full offline quality gates and classify live checks.
6. Update user and developer documentation, including the static fallback path.
7. After all required offline gates pass, resolve the exact artifact configured by
   Codex, require its primary checkout to contain the QA-approved commit, rebuild
   and hash it, run the compact Inspector probe against that exact artifact, and
   hash the complete existing per-tool approval blocks.
8. Only after those checks pass, preserve the current Codex MCP entry and add the
   `core`/dynamic environment settings; require the approval-block hash to remain
   byte-identical.
9. Restart or refresh Codex as required, confirm the live tools list, and retain a
   documented rollback to `full` with dynamic mode off.

## Rollback

Runtime rollback requires no code deletion:

```toml
[mcp_servers.tdmcp.env]
TDMCP_TOOL_PROFILE = "full"
TDMCP_DYNAMIC_TOOLSETS = "off"
```

If the new code itself causes a regression, revert the isolated implementation
commits while retaining the research and test evidence. Do not reset or discard
unrelated user changes.

## Provenance and license policy

- Keep the repository's MIT license intact.
- Preserve upstream SPDX headers and notices for any copied MIT or Apache-2.0 code.
- Record the upstream repository, commit, file, and local adaptation for copied
  implementation code.
- Do not import GPL/AGPL code into the runtime without a separate license decision.
- Do not execute third-party setup scripts merely to inspect a repository.
- Pin test dependencies. Resolve lockfile changes with scripts disabled and
  package-lock-only first; review integrity, bundled licenses, and every new
  `hasInstallScript` package against the explicit allowlist before any ordinary
  install. CI must reject a script-bearing lockfile package outside that allowlist.

## Deferred follow-up waves

After this wave is stable, separate designs may evaluate:

1. OpenAI Agents JS guardrails, tracing, sessions, and human approval for the local
   copilot;
2. ToolHive-style process isolation, network policy, and audit export;
3. Python evaluation or durable-workflow sidecars based on mcp-agent or Pydantic AI;
4. a future SDK v2 migration after the v2 release is stable and its conformance
   status is verified.

These follow-ups must not be bundled into the dynamic-toolset implementation.
