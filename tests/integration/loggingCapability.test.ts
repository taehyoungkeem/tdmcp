import { afterEach, describe, expect, it } from "vitest";
import { closeSessions, connectConfiguredClient, type ResourceClientSession } from "./helpers.js";

describe("integration: MCP logging capability", () => {
  const sessions: ResourceClientSession[] = [];

  afterEach(async () => {
    await closeSessions(sessions);
  });

  it("advertises logging and accepts a session logging level", async () => {
    const session = await connectConfiguredClient("logging-capability", {});
    sessions.push(session);

    expect(session.client.getServerCapabilities()?.logging).toEqual({});
    await expect(session.client.setLoggingLevel("info")).resolves.toEqual({});
  });
});
