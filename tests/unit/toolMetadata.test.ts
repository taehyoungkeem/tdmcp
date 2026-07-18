import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createTdmcpServer } from "../../src/server/tdmcpServer.js";
import {
  canonicalJson,
  fingerprintTool,
  serializedToolListBytesFromEntries,
} from "../../src/tools/toolsets/metadata.js";
import { TOOL_METADATA } from "../../src/tools/toolsets/toolMetadata.generated.js";
import { loadConfig } from "../../src/utils/config.js";
import { silentLogger } from "../../src/utils/logger.js";
import baseline from "../fixtures/tool-contract-baseline.json" with { type: "json" };

const APPLY_CREATIVE_CARD = "apply_creative_card";
const GENERATED_METADATA_PATH = join(process.cwd(), "src/tools/toolsets/toolMetadata.generated.ts");

async function assembledToolNames(env: NodeJS.ProcessEnv): Promise<string[]> {
  const server = createTdmcpServer(loadConfig(env), { logger: silentLogger });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "tdmcp-tool-metadata-test", version: "0.0.0" });
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return (await client.listTools()).tools.map((tool) => tool.name).sort();
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
}

function expectOnlyApplyCardDiff(offNames: string[], onNames: string[]): void {
  const off = new Set(offNames);
  const on = new Set(onNames);
  expect(onNames.filter((name) => !off.has(name))).toEqual([APPLY_CREATIVE_CARD]);
  expect(offNames.filter((name) => !on.has(name))).toEqual([]);
}

function runGenerator(args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  const tsxBin = process.platform === "win32" ? "tsx.cmd" : "tsx";
  return spawnSync(
    join(process.cwd(), "node_modules", ".bin", tsxBin),
    ["scripts/gen-tool-metadata.ts", ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", ...extraEnv },
    },
  );
}

describe("tool metadata", () => {
  it("canonicalizes object keys recursively", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, b: 3 } })).toBe('{"a":{"b":3,"y":2},"z":1}');
  });

  it("fingerprints equivalent key order identically", () => {
    expect(fingerprintTool({ name: "x", inputSchema: { type: "object" } })).toBe(
      fingerprintTool({ inputSchema: { type: "object" }, name: "x" }),
    );
  });

  it("computes the exact serialized tools/list envelope", () => {
    expect(serializedToolListBytesFromEntries([])).toBe(Buffer.byteLength('{"tools":[]}', "utf8"));
    expect(serializedToolListBytesFromEntries([3, 5])).toBe(12 + 3 + 1 + 5);
  });

  it("locks the original full surface at 497 names and fingerprints", () => {
    expect(baseline.count).toBe(497);
    expect(Object.keys(baseline.fingerprints)).toHaveLength(497);
    for (const [name, fingerprint] of Object.entries(baseline.fingerprints)) {
      expect(TOOL_METADATA[name]?.fingerprint).toBe(fingerprint);
    }
  });

  it("assembles RAG apply-card off then on without leaking registration state", async () => {
    const offNames = await assembledToolNames({ TDMCP_RAG_APPLY_CARD: "0" });
    const onNames = await assembledToolNames({ TDMCP_RAG_APPLY_CARD: "1" });

    expectOnlyApplyCardDiff(offNames, onNames);
  });

  it("assembles RAG apply-card on then off without leaking registration state", async () => {
    const onNames = await assembledToolNames({ TDMCP_RAG_APPLY_CARD: "1" });
    const offNames = await assembledToolNames({ TDMCP_RAG_APPLY_CARD: "0" });

    expectOnlyApplyCardDiff(offNames, onNames);
  });

  it("keeps an unrelated sentinel secret out of generated output and logs", () => {
    const secretKey = "TDMCP_METADATA_SENTINEL_SECRET";
    const secretValue = "sentinel-value-must-never-leak-7f92e4";
    const result = runGenerator(["--check"], { [secretKey]: secretValue });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    const capturedOutput = `${result.stdout}\n${result.stderr}`;
    const generatedOutput = readFileSync(GENERATED_METADATA_PATH, "utf8");
    for (const secret of [secretKey, secretValue]) {
      expect(capturedOutput).not.toContain(secret);
      expect(generatedOutput).not.toContain(secret);
    }
  });

  it.each([
    { args: [] },
    { args: ["--write", "--check"] },
    { args: ["--unknown"] },
  ])("exits 2 unless exactly one documented mode is provided: $args", ({ args }) => {
    const result = runGenerator(args);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
  });
});
