import { expect, it } from "vitest";
import { discoverToolsOutputSchema } from "../../src/tools/util/discoverTools.js";
import goldenCasesJson from "../fixtures/tool-discovery-golden.json" with { type: "json" };
import { connectConfiguredClient, type ResourceClientSession } from "../integration/helpers.js";

interface GoldenCase {
  query: string;
  expected: string;
  risk?: "any";
  forbidden?: string[];
}

const goldenCases = goldenCasesJson as GoldenCase[];

async function runGoldenCases(client: ResourceClientSession["client"]) {
  const outputs = [];

  for (const testCase of goldenCases) {
    const risk = testCase.risk ?? "safe_mutation";
    const result = await client.callTool({
      name: "discover_tools",
      arguments: {
        query: testCase.query,
        risk,
        limit: 5,
      },
    });

    expect(result.isError, testCase.query).not.toBe(true);
    const output = discoverToolsOutputSchema.parse(result.structuredContent);
    expect(output.candidates.length, testCase.query).toBeLessThanOrEqual(5);
    const names = output.candidates.map((candidate) => candidate.name);
    expect(names, testCase.query).toContain(testCase.expected);
    for (const forbidden of testCase.forbidden ?? []) {
      expect(names, testCase.query).not.toContain(forbidden);
    }
    if (risk === "safe_mutation") {
      expect(
        output.candidates.every(
          (candidate) => candidate.risk === "read_only" || candidate.risk === "safe_mutation",
        ),
        testCase.query,
      ).toBe(true);
    }
    outputs.push(output);
  }

  return outputs;
}

it("retrieves every bilingual golden tool deterministically without network access", async () => {
  expect(goldenCases).toHaveLength(25);
  expect(new Set(goldenCases.map((testCase) => testCase.query)).size).toBe(25);

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  let session: ResourceClientSession | undefined;

  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    fetchCalls += 1;
    throw new Error(`Unexpected network request: ${String(args[0])}`);
  }) as typeof fetch;

  try {
    session = await connectConfiguredClient("tool-discovery-golden", {
      TDMCP_TOOL_PROFILE: "core",
      TDMCP_DYNAMIC_TOOLSETS: "on",
    });

    const firstRun = await runGoldenCases(session.client);
    const secondRun = await runGoldenCases(session.client);

    expect(secondRun).toEqual(firstRun);
    expect(fetchCalls).toBe(0);
  } finally {
    globalThis.fetch = originalFetch;
    await session?.close();
  }
});
