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
      "support_send_message",
    ]);
  } finally {
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
