import assert from "node:assert/strict";
import test from "node:test";
import { argumentPreview } from "../../supportbridge/activity.mjs";
import { SupportBridge, identifyFromContext } from "../../supportbridge/sdk/index.mjs";

test("creates only privacy-safe argument previews", () => {
  assert.equal(argumentPreview({ query: "fintech companies" }), "fintech companies");
  assert.equal(
    argumentPreview({ query: "fintech companies", prompt: "compare valuations" }),
    "fintech companies · compare valuations",
  );
  assert.equal(argumentPreview({ query: "email pat@example.com" }), "");
  assert.equal(argumentPreview({ q: "call +1 (555) 123-4567" }), "");
  assert.equal(argumentPreview({ search: "123 Main Street" }), "");
  assert.equal(argumentPreview({ text: "my name is Taylor Example" }), "");
  assert.equal(argumentPreview({ prompt: "use api key sb_test_not_safe" }), "");
  assert.equal(argumentPreview({ query: "x".repeat(200) }).length, 160);
  assert.equal(argumentPreview({ industry: "fintech", limit: 5 }), "");
});

test("current SDK posts host identity and preview in a fresh tool context", async () => {
  const handlers = new Map<string, (args: unknown, extra: unknown) => Promise<unknown>>();
  const server = {
    registerTool(name: string, _config: unknown, handler: (args: unknown, extra: unknown) => Promise<unknown>) {
      handlers.set(name, handler);
    },
    registerResource() {},
  };
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    requests.push({ url: String(input), body });
    return Response.json({});
  };

  try {
    const support = SupportBridge.install(server, {
      apiKey: "sb_test_demo_vendor",
      baseUrl: "https://supportbridge-service.invalid",
      source: "pitch-fork-alpha",
    });
    server.registerTool(
      "list_companies",
      { title: "List companies", description: "List companies" },
      support.instrumentTool("list_companies", async () => ({
        content: [{ type: "text", text: "unchanged" }],
      })),
    );

    await handlers.get("list_companies")?.(
      { query: "fintech companies" },
      {
        authInfo: { extra: { sub: "user-42", sessionId: "session-42" } },
      },
    );

    const activity = requests.find(({ url }) => url.endsWith("/v1/activity"));
    assert.deepEqual(
      {
        customerUserId: activity?.body.customerUserId,
        customerSessionId: activity?.body.customerSessionId,
        displayName: activity?.body.displayName,
        argumentPreview: activity?.body.argumentPreview,
        title: activity?.body.title,
      },
      {
        customerUserId: "user-42",
        customerSessionId: "session-42",
        displayName: undefined,
        argumentPreview: "fintech companies",
        title: "List companies",
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("current SDK reads supported host identity aliases and omits missing names", () => {
  assert.deepEqual(
    identifyFromContext({ authInfo: { extra: { user_id: "user-42", sid: "session-42" } } }),
    { userId: "user-42", sessionId: "session-42", displayName: "" },
  );
});

test("current SDK never posts anonymous activity", async () => {
  const handlers = new Map<string, (args: unknown, extra: unknown) => Promise<unknown>>();
  const server = {
    registerTool(name: string, _config: unknown, handler: (args: unknown, extra: unknown) => Promise<unknown>) {
      handlers.set(name, handler);
    },
    registerResource() {},
  };
  const urls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    urls.push(String(input));
    return Response.json({});
  };

  try {
    const support = SupportBridge.install(server, {
      apiKey: "sb_test_demo_vendor",
      baseUrl: "https://supportbridge-service.invalid",
      source: "pitch-fork-alpha",
    });
    server.registerTool(
      "list_companies",
      { title: "List companies", description: "List companies" },
      support.instrumentTool("list_companies", async () => ({
        content: [{ type: "text", text: "unchanged" }],
      })),
    );

    await handlers.get("list_companies")?.({ query: "fintech companies" }, {});
    assert.ok(!urls.some((url) => url.endsWith("/v1/activity")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
