import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";

process.env.SUPPORTBRIDGE_API_KEY = "sb_test_demo_vendor";
process.env.SUPPORTBRIDGE_URL = "https://supportbridge-service.invalid";
globalThis.fetch = async () => Response.json({});

async function connectedClient() {
  const { server } = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "pitch-fork-test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

test("exposes the business tools and SDK-managed assistance tools", async () => {
  const { client, server } = await connectedClient();
  try {
    assert.match(client.getInstructions() ?? "", /offer_assistance/);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
      "confirm_assistance",
      "decline_assistance",
      "fetch",
      "get_company",
      "list_companies",
      "list_industries",
      "offer_assistance",
      "request_assistance",
      "search",
      "support_end_session",
      "support_get_messages",
      "support_get_offer",
      "support_send_message",
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("attaches an offered assistance card to a successful matching business result", async () => {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({
      url,
      authorization: new Headers(init?.headers).get("authorization"),
    });
    if (url.endsWith("/v1/offers/intent")) {
      return Response.json({
        offer: {
          id: "offer-pricing-1",
          intent: "pricing",
          intentLabel: "Pricing",
          issueSummary: "Customer asked about pricing or plans.",
          representativeName: "Sarah",
          representativeRole: "account executive",
          vendorName: "Pitch Fork",
          expiresAt: "2026-09-28T21:00:00.000Z",
        },
      });
    }
    return Response.json({});
  };

  const { client, server } = await connectedClient();
  try {
    const result = await client.callTool({
      name: "search",
      arguments: { query: "What pricing plans do you offer?" },
    });
    assert.equal(result.isError, undefined);
    const structuredContent = result.structuredContent as
      | { offered?: boolean; offerId?: string }
      | undefined;
    assert.equal(structuredContent?.offered, true);
    assert.equal(structuredContent?.offerId, "offer-pricing-1");
    assert.equal(result._meta?.["openai/outputTemplate"], "ui://supportbridge/intent-offer");
    assert.match(JSON.stringify(result.content), /Optional live assistance/);
    assert.ok(requests.some(({ url }) => url === "https://supportbridge-service.invalid/v1/offers/intent"));
    assert.ok(requests.every(({ authorization }) => authorization === "Bearer sb_test_demo_vendor"));
  } finally {
    globalThis.fetch = async () => Response.json({});
    await client.close();
    await server.close();
  }
});

test("business tools keep their schemas and results", async () => {
  const { client, server } = await connectedClient();
  try {
    const result = await client.callTool({ name: "get_company", arguments: { id: "co-001" } });
    assert.equal(result.isError, undefined);
    assert.match(JSON.stringify(result.content), /co-001/);
    const industries = await client.callTool({ name: "list_industries", arguments: {} });
    assert.equal(industries.isError, undefined);
    assert.match(JSON.stringify(industries.content), /fintech/);
  } finally {
    await client.close();
    await server.close();
  }
});
