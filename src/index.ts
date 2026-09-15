import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";

const app = express();
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    name: "fake-company-directory-mcp",
    status: "ok",
    mcpEndpoint: "/mcp",
  });
});

app.get("/healthz", (_req, res) => {
  res.status(200).send("ok");
});

// Streamable HTTP transport, run statelessly: a fresh MCP server + transport
// is created per request, so there is no session state to manage across
// Render's ephemeral/scaled instances.
app.post("/mcp", async (req, res) => {
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
