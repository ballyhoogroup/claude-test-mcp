import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";
import { authEnabled, protectedResourceMetadata, protectedResourceMetadataUrl, verifyBearerToken } from "./auth.js";

const app = express();
app.use(express.json());

// Permissive CORS: MCP clients (ChatGPT, Claude, browser-based tools) call
// this cross-origin, and the OAuth flow needs the WWW-Authenticate header
// readable by the client.
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id");
  res.header("Access-Control-Expose-Headers", "WWW-Authenticate, Mcp-Session-Id");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get("/", (_req, res) => {
  res.json({
    name: "fake-company-directory-mcp",
    status: "ok",
    mcpEndpoint: "/mcp",
    authEnabled,
  });
});

app.get("/healthz", (_req, res) => {
  res.status(200).send("ok");
});

// RFC 9728 Protected Resource Metadata — lets OAuth-aware MCP clients (e.g.
// ChatGPT, Claude) discover that WorkOS AuthKit is the authorization server
// for this resource. Only served once auth is actually configured.
app.get("/.well-known/oauth-protected-resource", (_req, res) => {
  if (!authEnabled) {
    res.status(404).json({ error: "oauth_not_configured" });
    return;
  }
  res.json(protectedResourceMetadata());
});

function sendUnauthorized(res: express.Response, reason: string) {
  res
    .status(401)
    .set("WWW-Authenticate", `Bearer resource_metadata="${protectedResourceMetadataUrl()}"`)
    .json({
      jsonrpc: "2.0",
      error: { code: -32001, message: `Unauthorized: ${reason}` },
      id: null,
    });
}

// Streamable HTTP transport, run statelessly: a fresh MCP server + transport
// is created per request, so there is no session state to manage across
// Render's ephemeral/scaled instances.
app.post("/mcp", async (req, res) => {
  const tokenCheck = await verifyBearerToken(req.header("authorization"));
  if (!tokenCheck.ok) {
    sendUnauthorized(res, tokenCheck.reason);
    return;
  }

  const server = createServer();
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// The stateless Streamable HTTP transport only supports POST; GET/DELETE are
// used by clients for SSE streaming / session teardown, neither of which
// this server needs.
app.get("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed: this server is stateless." },
    id: null,
  });
});

app.delete("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed: this server is stateless." },
    id: null,
  });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`Fake company directory MCP server listening on port ${PORT}`);
});
