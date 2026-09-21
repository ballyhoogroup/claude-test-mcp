import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { HttpTelemetryTransport, SDK_VERSION } from "@supportbridge/sdk";
import { identifyWorkOSUser } from "../auth.js";
import { createServer } from "../server.js";

test("authenticated WorkOS AuthInfo is converted to SupportBridge identity", () => {
  const identity = identifyWorkOSUser({
    authInfo: {
      token: "test-only-verified-token",
      clientId: "test-client",
      scopes: [],
      extra: {
        subject: "user_01TEST",
        organizationId: "org_01TEST",
        sessionId: "session_01TEST",
        name: "Test User",
        email: "test.user@example.invalid",
        emailVerified: true,
      },
    },
  });

  assert.deepEqual(identity, {
    userId: "oauth:user_01TEST",
    organizationId: "org_01TEST",
    accountId: "workos:org_01TEST",
    sessionId: "session_01TEST",
    traits: {
      name: "Test User",
      email: "test.user@example.invalid",
    },
  });
});

test("missing WorkOS AuthInfo produces no SupportBridge identity", () => {
  assert.equal(identifyWorkOSUser({}), undefined);
});

async function connectedClient(options: Parameters<typeof createServer>[0] = {}) {
  const { server, support } = createServer(options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "pitch-fork-test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server, support };
}

test("uses the pinned SupportBridge SDK with required capabilities", async () => {
  assert.equal(SDK_VERSION, "0.12.1-dev.91dbd0be7e08");
  let headers: Headers | undefined;
  const transport = new HttpTelemetryTransport({
    endpoint: "https://supportbridge.invalid/v1/events",
    apiKey: "test-only-secret",
    deploymentId: "deployment-test",
    fetch: async (_input, init) => {
      headers = new Headers(init?.headers);
      return new Response(null, { status: 202 });
    },
  });
  await transport.send([{
    id: "event-test",
    type: "sdk_diagnostic",
    timestamp: new Date().toISOString(),
    source: "test",
    sdkName: "@supportbridge/sdk",
    sdkVersion: SDK_VERSION,
    code: "delivery_failed",
    message: "test",
  }]);
  assert.equal(headers?.get("x-supportbridge-sdk-version"), SDK_VERSION);
  assert.equal(headers?.get("x-supportbridge-deployment-id"), "deployment-test");
  const capabilities = headers?.get("x-supportbridge-capabilities")?.split(",") ?? [];
  assert.ok(capabilities.includes("optional-assistance-v1"));
  assert.ok(capabilities.includes("durable-offer-delivery-v1"));
});

test("original business tools keep their schemas and results", async () => {
  const { client, server, support } = await connectedClient();
  try {
    const tools = await client.listTools();
    for (const name of ["search", "fetch", "list_companies", "get_company", "list_industries"]) {
      assert.ok(tools.tools.some((tool) => tool.name === name), `${name} should remain registered`);
    }

    const result = await client.callTool({ name: "get_company", arguments: { id: "co-001" } });
    assert.equal(result.isError, undefined);
    assert.match(JSON.stringify(result.content), /co-001/);
  } finally {
    await client.close();
    if (support) await support.close();
    await server.close();
  }
});

test("business tools fail open when SupportBridge is not configured", async () => {
  const { client, server, support } = await connectedClient();
  try {
    assert.equal(support, undefined);
    const result = await client.callTool({ name: "list_industries", arguments: {} });
    assert.equal(result.isError, undefined);
    assert.match(JSON.stringify(result.content), /fintech/);
  } finally {
    await client.close();
    await server.close();
  }
});

test("instrumented business tools fail open during a control-plane outage", async () => {
  const { client, server, support } = await connectedClient({
    env: {
      SUPPORTBRIDGE_URL: "https://supportbridge.invalid",
      SUPPORTBRIDGE_API_KEY: "test-only-secret",
      SUPPORTBRIDGE_SOURCE: "claude-test-mcp",
    },
    supportBridgeFetch: async () => {
      throw new Error("simulated network outage");
    },
  });
  try {
    assert.ok(support, "SupportBridge should be installed for this test");
    const result = await client.callTool({ name: "get_company", arguments: { id: "co-001" } });
    assert.equal(result.isError, undefined);
    assert.match(JSON.stringify(result.content), /co-001/);
  } finally {
    await client.close();
    if (support) await support.close();
    await server.close();
  }
});

test("SupportBridge uses the default control plane when required identity is configured", async () => {
  const { server, support } = createServer({
    env: {
      SUPPORTBRIDGE_API_KEY: "test-only-secret",
      SUPPORTBRIDGE_SOURCE: "claude-test-mcp",
    },
    supportBridgeFetch: async () => {
      throw new Error("simulated network outage");
    },
  });
  try {
    assert.ok(support, "SupportBridge should be installed with only its API key");
  } finally {
    if (support) await support.close();
    await server.close();
  }
});
