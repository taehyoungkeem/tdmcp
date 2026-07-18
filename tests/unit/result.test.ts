import { describe, expect, it } from "vitest";
import { structuredErrorResult } from "../../src/tools/result.js";

describe("structuredErrorResult", () => {
  it("makes ok false authoritative in structured error content", () => {
    expect(structuredErrorResult("failed", { code: "x" })).toEqual({
      isError: true,
      content: [{ type: "text", text: "failed" }],
      structuredContent: { ok: false, code: "x" },
    });

    expect(structuredErrorResult("failed", { ok: true, code: "x" })).toEqual({
      isError: true,
      content: [{ type: "text", text: "failed" }],
      structuredContent: { ok: false, code: "x" },
    });
  });
});
