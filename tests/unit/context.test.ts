import { describe, expect, it } from "vitest";
import { buildToolContext } from "../../src/server/context.js";
import { loadConfig } from "../../src/utils/config.js";
import { silentLogger } from "../../src/utils/logger.js";

describe("buildToolContext", () => {
  it("maps dynamic-toolset mode, limits, and KiB metadata budget into runtime values", () => {
    const config = loadConfig({
      TDMCP_DYNAMIC_TOOLSETS: "on",
      TDMCP_TOOL_MAX_ACTIVE: "80",
      TDMCP_TOOL_METADATA_BUDGET_KB: "192",
    });

    const ctx = buildToolContext(config, { logger: silentLogger });

    expect(ctx.toolProfile).toBe("full");
    expect(ctx.dynamicToolsets).toBe(true);
    expect(ctx.toolMaxActive).toBe(80);
    expect(ctx.toolMetadataBudgetBytes).toBe(196608);
  });
});
