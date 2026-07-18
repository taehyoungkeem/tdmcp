---
description: "How the TouchDesigner MCP server works — the MCP tool layers, the embedded operator knowledge base, and the bridge that runs inside TouchDesigner."
---

# Architecture

tdmcp is three programs that talk to each other on your machine:

```
   AI assistant            tdmcp server                TouchDesigner
  (Claude / Cursor)  ──▶  (Node / TypeScript)   ──▶   (the Python bridge inside TD)
   "make a feedback        MCP tools + the              creates / connects /
    tunnel from noise"     operator knowledge base       inspects / previews nodes
```

1. **The AI assistant** is any MCP-capable client — Claude Desktop, Claude Code,
   Codex, or Cursor. It's where you describe what you want.
2. **The tdmcp server** is a small Node program. It exposes a set of TouchDesigner
   "tools" and an embedded operator knowledge base to the AI over the
   [Model Context Protocol](https://modelcontextprotocol.io).
3. **The bridge** is a Python package that runs *inside* TouchDesigner (behind a
   Web Server DAT). It's what actually drives TD. See
   [Bridge & REST API](/reference/bridge-api).

```
MCP client ──stdio──▶ tdmcp server (Node/TS) ──HTTP──▶ TouchDesigner bridge (Python)
                       ├── Layer 1  artist tools (create_visual_system, …)
                       ├── Layer 2  building blocks (create_node_chain, …)
                       ├── Layer 3  atomic ops (create_td_node, …)
                       ├── Knowledge base (MCP resources)
                       ├── Recipes (validated network templates)
                       └── Feedback engine (errors / preview / performance)
```

## The three tool layers

Tools are organized into layers so the AI can pick the right altitude for a task.
See the full, always-current list in the [Tools reference](/reference/tools).

- **Layer 1 — artist tools.** Describe a result (`create_feedback_network`,
  `create_audio_reactive`, `create_generative_art`, …) and get a whole network,
  wired and arranged, often with a control panel ready to perform.
- **Layer 2 — building blocks.** Mid-level pieces (`create_node_chain`,
  `connect_nodes`, `create_control_panel`, `animate_parameter`,
  `create_external_io`, …) for assembling and controlling networks by hand.
- **Layer 3 — atomic operations.** Single-node CRUD plus inspection, analysis,
  rendering and the Python escape hatches (`create_td_node`, `find_td_nodes`,
  `get_td_node_errors`, `execute_python_script`, …).

A separate group of [vault tools](/reference/tools#obsidian-vault) bridges an
Obsidian vault and TouchDesigner.

## Dynamic toolsets

The package-compatible defaults remain `TDMCP_TOOL_PROFILE=full`,
`TDMCP_DYNAMIC_TOOLSETS=off`, `TDMCP_TOOL_MAX_ACTIVE=120`, and
`TDMCP_TOOL_METADATA_BUDGET_KB=256`. All eight startup profiles are supported:
`full`, `safe`, `directory`, `core`, `inspect`, `build`, `show`, and `library`.
Static `full` preserves the 497 legacy tools. Dynamic `full` adds the four
management tools for 501 total, but it is a startup/reset compatibility state and
is not selectable from a compact session. The `directory` profile is static 15 / dynamic 22.

Each `createTdmcpServer` call owns one `ToolCatalog` and one `ToolsetManager`.
The existing HTTP server factory creates a new server and manager for each HTTP
MCP session, so enabled state never leaks between sessions. The native flow is:

```text
discover_tools -> validate policy and budgets
               -> RegisteredTool lifecycle batch
               -> one tools/list_changed
               -> refreshed original tools and handlers
```

The protected core always includes `discover_tools`, `select_toolset`,
`get_active_toolset`, and `reset_toolset`. Presets are safe by construction.
Raw-code or destructive tools require the exact tool name and explicit risky
opt-in, then still pass the original schema, per-tool approval, and environment
gates. `TDMCP_RAW_PYTHON=off` is authoritative. Dynamic selection does not invoke
a tool and does not introduce a generic proxy.

Compatibility note: `run_macro_script` keeps its legacy `allowRawPython` input
field and MCP description unchanged to preserve the immutable 497-tool contract.
At runtime, the legacy wording is not an authorization opt-in: nested raw-code and
destructive targets are always blocked regardless of that field or server context;
only same-session active, input-valid, non-raw, non-destructive handlers can run.

The pinned SDK cannot report whether a client actually refreshed. Therefore
`client_refresh_required: true` is a hint, not an acknowledgment. If a client
does not react to `tools/list_changed`, choose a static profile such as `build`,
disable dynamic mode, and restart:

```toml
[mcp_servers.tdmcp.env]
TDMCP_TOOL_PROFILE = "build"
TDMCP_DYNAMIC_TOOLSETS = "off"
```

To restore the full legacy behavior, use `full`, disable dynamic mode, and
restart:

```toml
[mcp_servers.tdmcp.env]
TDMCP_TOOL_PROFILE = "full"
TDMCP_DYNAMIC_TOOLSETS = "off"
```

Neither recovery recipe deletes code or changes per-tool approval settings.

## The create → verify → preview loop

Every high-level build follows the same loop so the AI can see and fix its own
work instead of guessing:

1. **Create** the network from a recipe, GLSL pattern, or generated Python.
2. **Verify** by reading cook/compile errors (`get_td_node_errors`,
   `summarize_td_errors`).
3. **Preview** by capturing the output TOP as an inline image (`get_preview`).

Generated networks are auto-arranged into a readable left→right layout
(`arrange_network`) instead of piling nodes on top of each other.

## Knowledge base

The server ships with an embedded, offline reference so the AI uses real
operators rather than inventing them: **629 operators**, **68 Python classes**,
workflow patterns, GLSL techniques, tutorials, **7 TouchDesigner release
profiles**, **45 operator compatibility entries**, **9 Python API compatibility
classes**, **6 experimental build series**, **7 technique packs** with **39
techniques**, and **6 TouchDesigner class references**. These are exposed as MCP
resources the AI can read on demand:

`tdmcp://operators/{category|name}` · `tdmcp://python-api/{class}` ·
`tdmcp://operator-connections/{operator}` · `tdmcp://operator-examples/{operator}` ·
`tdmcp://td-versions/{version}` · `tdmcp://td-experimental/{series_or_category}` ·
`tdmcp://compat/operators/{operator}` · `tdmcp://compat/python/{class_or_member}` ·
`tdmcp://techniques/{category}` · `tdmcp://td-classes/{family}` ·
`tdmcp://patterns/{name}` · `tdmcp://glsl/{name}` ·
`tdmcp://glsl-snippets` · `tdmcp://recipes/{name}` ·
`tdmcp://recipes/search/{query}` · `tdmcp://tutorials/{name}` ·
`tdmcp://commands` · `tdmcp://prompts` · `tdmcp://cheatsheets` ·
`tdmcp://learning/touchdesigner`

The knowledge base is committed to the repo, so a fresh clone needs only
`npm install && npm run build`. `npm run import:bottobot` regenerates it from
`@bottobot/td-mcp` and is only needed to refresh it.

## Creative RAG (optional, opt-in)

[Creative RAG](/CREATIVE_RAG) is a separate, opt-in subsystem that lives
**outside** the TouchDesigner bridge. It is **not** a tool layer, it does **not**
touch TD, DMX, fixtures or any Python exec path. It is a CLI subcommand
(`tdmcp creative-rag {sync|index|search}`) plus two **read-only** MCP resources
(`tdmcp://creative/cards/{id}` and `tdmcp://creative/search`), both registered
only when `TDMCP_RAG_ENABLED=1`. Its only outbound calls are HTTPS to four
open-data museum APIs (during explicit `sync`) and `POST /api/embed` to a
**local Ollama process** (during `index` and `search`). Repertoire, not policy
— search results never trigger an in-TD action.

## Recipes

Recipes are validated network templates (JSON) the AI can instantiate with
`apply_recipe`. They cover common starting points — feedback tunnels,
reaction-diffusion, particle galaxies, audio spectrum bars, projection mapping
and more. See the [Recipe gallery](/guide/recipes) for what each one builds, and
the repository's `CONTRIBUTING.md` guide to add your own.

## Transports & events

The server speaks two MCP transports:

- **stdio** (default) — for local clients like Claude Desktop and Claude Code.
- **Streamable HTTP** (`TDMCP_TRANSPORT=http`) — serves MCP at
  `POST/GET/DELETE /mcp` on loopback with stateful sessions, for remote/headless
  setups. See [Deployment](/deployment).

It can also subscribe to a **WebSocket event stream** from TD
(`node.created` / `node.deleted` / `node.error` / `project.saved` /
`timeline.frame` / `node.cook`) and forward events as MCP logging notifications.
High-frequency events (`timeline.frame`, `node.cook`) are dropped unless
explicitly opted in. Toggle with `TDMCP_EVENTS`.

### Calling tdmcp from inside TouchDesigner (LOPs)

dotsimulate's LOPs "MCP Client" can run *inside* TouchDesigner and spawn this
server over stdio, closing a loop: **TD (LOPs MCP Client) → `node dist/index.js`
(tdmcp) → HTTP → the TD bridge on `127.0.0.1:9980` (the same TD) → the network.**
No transport change is needed (stdio is the default). Because the client lives in
TD with no documented `env` field, point its `command` at the
`scripts/tdmcp-lops.mjs` wrapper, which injects the hardened profile
(`TDMCP_RAW_PYTHON=off`, `TDMCP_TOOL_PROFILE=safe`). See the
[LOPs integration guide](/guide/lops-integration).

## Security

The TouchDesigner bridge runs **arbitrary Python inside your TD process** — that
is what lets the assistant build networks for you. Treat it like an open door to
the machine TD runs on:

- **The Web Server DAT binds its port (default `9980`) on all interfaces, but the
  bridge is loopback-only by default.** A request from a non-loopback peer address
  is rejected immediately (HTTP `403`), **before** routing, authentication, or any
  tool runs, so reaching the port from another machine is not enough to drive it.
  To expose the bridge to a LAN, set `TDMCP_BRIDGE_ALLOW_LAN=1` in TouchDesigner's
  environment (also accepts `true`/`yes`/`on`) — and pair it with
  `TDMCP_BRIDGE_TOKEN`. Even then, only run it on a trusted network and/or firewall
  the port. (Some TouchDesigner builds don't surface the peer address to the
  callback; where that's the case the `Origin`/`Host` guards below are the
  defense.)
- **Turn on bridge auth for untrusted networks:** set `TDMCP_BRIDGE_TOKEN` to a
  shared secret in **both** the server's environment and TouchDesigner's
  environment. The bridge then rejects any request without a matching
  `Authorization: Bearer <token>` (HTTP `401`). Unset (default) keeps the
  zero-config local flow.
- `TDMCP_RAW_PYTHON=off` hides client-authored Python tools, including
  `execute_python_script`, `exec_node_method`, `create_python_script`, and
  persistent Script callbacks from `author_script_operator`. It is **not** a
  code-execution kill-switch: many higher-level tools still send their own
  templated Python to the bridge. The bridge-side arbitrary-code endpoints
  (`/api/exec`, node-`method`) are default-closed unless
  `TDMCP_BRIDGE_ALLOW_EXEC=1` is explicitly set in TouchDesigner's environment;
  `TDMCP_BRIDGE_TOKEN` authenticates requests but does not enable exec by itself.
  Structured endpoints keep working.
- The MCP server binds to loopback (`127.0.0.1`) for both transports and enables
  DNS-rebinding protection on HTTP.
- **The bridge refuses browser cross-origin requests.** Any request carrying an
  `Origin` header that isn't loopback is rejected (HTTP `403`), and a
  `POST`/`PATCH`/`PUT` whose `Content-Type` is present but not `application/json`
  is rejected too — that blocks the simple cross-site form/`fetch` POSTs a
  malicious web page could aim at the bridge (CSRF / DNS-rebinding → drive-by code
  execution). The MCP server sends no `Origin` and always uses
  `application/json`, so normal use is unaffected.
- **The local copilot chat UI (`tdmcp chat`) applies the same guard.** It binds to
  loopback and rejects (HTTP `403`) any request whose `Host` or `Origin` isn't a
  loopback name, so a page the artist visits can't drive node CRUD against the live
  project via `http://127.0.0.1:<chat-port>/chat`.

All of these are configured through [environment variables](/reference/environment).

## Upstream provenance for this wave

Reviewed source snapshots and published package artifacts are separate evidence.
The exact Inspector and Conformance packages are development dependencies used by
subprocess protocol probes; they are not server runtime dependencies.

| Source | Reviewed source snapshot | Published artifact provenance | License evidence | Use in this wave |
| --- | --- | --- | --- | --- |
| `modelcontextprotocol/typescript-sdk` | v1 HEAD `69749aa5081ddfe675d36da8d96c7e27d83742b8` | `1.29.0` gitHead/tag `e12cbd7078db388152f6e839abdbe09ba01f3f32` | Published `1.29.0` artifact: MIT. The repository's Apache-2.0/MIT transition is outside that artifact. | Public `RegisteredTool` lifecycle and `tools/list_changed`; no source copy. |
| `modelcontextprotocol/inspector` | checkout `ebd0550fecea0f398aae4997a9c8189727aec6e0` | CLI `0.22.0` gitHead/tag `0ba1b8d1d8852e2f179f5a1945895ef97a91459f` | Manifest: `SEE LICENSE IN LICENSE`; bundled `LICENSE` records the Apache-2.0/MIT transition; non-spec documentation may be CC-BY-4.0. | Exact dev dependency and subprocess contract probes. |
| `modelcontextprotocol/conformance` | main `d1c0b9591786726d8a4bec05306eb103ba6894ff` | `0.2.0-alpha.9` gitHead `794dcab99ed1ef2b89607be9999574140ea5c96e`; no git tag; npm `alpha`, while npm stable `latest` is `0.1.16` | Manifest: MIT; bundled `LICENSE` records the Apache-2.0/MIT transition; non-spec documentation may be CC-BY-4.0. | Exact dev dependency and machine-readable protocol checks. |
| `stacklok/toolhive` | `52ecebcca4eb5bda15b26fd0aac00bd2298bfc1c` | — | Apache-2.0 | Policy/exposure ideas only; no source copy. |
| `openai/openai-agents-js` | `f7771c177e100a62a5b99f0d8cd5e97300eda6ea` | — | MIT | Deferred agent-runtime ideas; no runtime dependency or source copy. |
| `lastmile-ai/mcp-agent` | `f62d849350816588b1c6294e7914bbe4d8b84072` | — | Apache-2.0 | Deferred workflow ideas; no Python rewrite or source copy. |

FastMCP and PydanticAI were reference-only. No runtime source code is copied from
ToolHive, OpenAI Agents JS, mcp-agent, FastMCP, or PydanticAI into tdmcp in this
wave. When package manifest metadata and repository summaries differ, the bundled
`LICENSE` wording is retained and both facts are reported rather than simplified.

## Known limitations

- **WebSocket events** are forwarded as MCP logging notifications on both
  transports; high-frequency events are dropped unless opted in.
- **Audio / particle / 3D builders and the exotic recipes** (kinect, LED,
  projection) produce valid, connected networks but use best-effort TD parameter
  names — fine-tuning may be needed, and they emit warnings to that effect.
- **Preview** returns the TOP at its native resolution (the requested size is
  advisory).
- The bridge ships as Python modules plus a callbacks template (a binary `.tox`
  can't be generated from source); the one-line installer assembles it for you.
