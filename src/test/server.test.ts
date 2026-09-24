import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  HttpTelemetryTransport,
  instrumentMcpTool,
  parseSupportOffer,
  SDK_VERSION,
} from "@supportbridge/sdk";
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
  assert.equal(SDK_VERSION, "0.10.3");
  let headers: Headers | undefined;
  const transport = new HttpTelemetryTransport({
    endpoint: "https://supportbridge.invalid/v1/events",
    apiKey: "test-only-secret",
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
  assert.equal(headers?.get("user-agent"), `supportbridge-sdk/${SDK_VERSION}`);
});

test("manual app-card offers tell ChatGPT to display the offer without starting chat", async () => {
  const triggerId = "trigger-manual-offer-123";
  const originalStructuredContent = { company: { id: "co-001", name: "LedgerLeap" } };
  const client = {
    privacy: { captureAgentContent: false },
    instrumentTool: async (_invocation: unknown, handler: () => Promise<unknown>) => ({
      kind: "result",
      value: await handler(),
      offer: {
        triggerId,
        reason: "Optional assistance is available",
        blocking: false,
        requiresAcknowledgement: false,
        retryOriginalRequestAfterDecision: false,
        optionalAssistance: {
          version: "optional-assistance-v1",
          offerId: "stale-notice-offer-id",
          vendorName: "Alpha",
          reasonCode: "interpret_results",
          expiresAt: "2099-01-01T00:00:00.000Z",
          disclosureVersion: "v1",
          disclosure: "Support is optional.",
          acceptanceRequired: true,
          deliveryMode: "ask_for_choice",
          mediumPresentation: "app_card",
          context: {
            eventId: "event-123",
            toolName: "get_company",
            outcome: "success",
            at: "2026-09-24T00:00:00.000Z",
          },
        },
      },
    }),
  };
  const handler = instrumentMcpTool(
    client as never,
    "get_company",
    async () => ({
      content: [{ type: "text", text: "LedgerLeap (co-001)" }],
      structuredContent: originalStructuredContent,
      isError: false,
    }),
    {
      identify: () => undefined,
      offerCardToolEnabled: true,
      offerCardDisplayTool: "offer_assistance",
    },
  );

  const result = await handler({});
  const primaryText = result.content[0];
  assert.equal(primaryText.type, "text");
  assert.match(primaryText.text, /^LedgerLeap \(co-001\)[\s\S]+Optional live support:/);
  assert.match(primaryText.text, new RegExp(`call offer_assistance[\\s\\S]+${triggerId}`));

  const displayBlock = result.content.find(
    (block) => block.annotations?.audience?.length === 1 && block.annotations.audience[0] === "assistant",
  );
  assert.ok(displayBlock);
  assert.deepEqual(JSON.parse(displayBlock.text), {
    "supportbridge/offer": {
      offerId: triggerId,
      display_tool: "offer_assistance",
      display_arguments: { offer_id: triggerId },
      displayOnly: true,
      chatStarted: false,
      chatAcceptanceRequired: true,
    },
  });
  assert.deepEqual(result.structuredContent, originalStructuredContent);
  assert.equal(result.isError, false);
  assert.deepEqual(result._meta?.["supportbridge/optional-assistance"], {
    version: "optional-assistance-v1",
    offerId: "stale-notice-offer-id",
    vendorName: "Alpha",
    reasonCode: "interpret_results",
    expiresAt: "2099-01-01T00:00:00.000Z",
    disclosureVersion: "v1",
    disclosure: "Support is optional.",
    acceptanceRequired: true,
    deliveryMode: "ask_for_choice",
    mediumPresentation: "app_card",
    context: {
      eventId: "event-123",
      toolName: "get_company",
      outcome: "success",
      at: "2026-09-24T00:00:00.000Z",
    },
    triggerId,
    chatStarted: false,
  });
  assert.equal(result._meta?.["openai/outputTemplate"], undefined);
});

test("app-card presentation survives SupportBridge offer parsing", () => {
  const parsed = parseSupportOffer({
    triggerId: "trigger-parsed-app-card",
    reason: "Optional assistance is available",
    blocking: false,
    requiresAcknowledgement: false,
    message: "Optional assistance is available.",
    retryOriginalRequestAfterDecision: false,
    optionalAssistance: {
      version: "optional-assistance-v1",
      offerId: "offer-parsed-app-card",
      vendorName: "Alpha",
      reasonCode: "interpret_results",
      expiresAt: "2099-01-01T00:00:00.000Z",
      disclosureVersion: "v1",
      disclosure: "Support is optional.",
      acceptanceRequired: true,
      deliveryMode: "ask_for_choice",
      mediumPresentation: "app_card",
      context: {
        eventId: "event-parsed-app-card",
        toolName: "list_companies",
        outcome: "success",
        at: "2026-09-24T00:00:00.000Z",
      },
    },
  });

  assert.equal(parsed?.optionalAssistance?.mediumPresentation, "app_card");
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

test("business-intent tools are supplied by the configured SupportBridge SDK", async () => {
  const { client, server, support } = await connectedClient({
    env: {
      SUPPORTBRIDGE_API_KEY: "test-only-secret",
      SUPPORTBRIDGE_SOURCE: "claude-test-mcp",
    },
    supportBridgeFetch: async () => {
      throw new Error("simulated network outage");
    },
  });
  try {
    assert.ok(support);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "offer_assistance"));
    assert.ok(tools.tools.some((tool) => tool.name === "confirm_assistance"));
    assert.equal(support.offerCard.resourceUri.startsWith("ui://supportbridge/offer-card"), true);
  } finally {
    await client.close();
    if (support) await support.close();
    await server.close();
  }
});

test("close removes SupportBridge registrations but preserves business tools", async () => {
  const { client, server, support } = await connectedClient({
    env: {
      SUPPORTBRIDGE_API_KEY: "test-only-secret",
      SUPPORTBRIDGE_SOURCE: "claude-test-mcp",
    },
    supportBridgeFetch: async () => {
      throw new Error("simulated network outage");
    },
  });
  try {
    assert.ok(support);
    await support.close();

    const tools = await client.listTools();
    assert.equal(tools.tools.some((tool) => tool.name === "offer_assistance"), false);
    assert.ok(tools.tools.some((tool) => tool.name === "get_company"));

    const result = await client.callTool({ name: "get_company", arguments: { id: "co-001" } });
    assert.equal(result.isError, undefined);
  } finally {
    await client.close();
    if (support) await support.close();
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
