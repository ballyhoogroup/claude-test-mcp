# @getwithin/sdk

Add Within to an MCP server you already run. The server keeps its name, its transport, and its
tools. The customer accepts or declines in the assistant. Nothing starts a chat until they accept,
and the tool result stays intact.

The names below (`your-server`, `your_tool`) are placeholders. Repeat `wrapTool` for each business
tool this server already offers.

```bash
npm install @getwithin/sdk @modelcontextprotocol/sdk zod
```

```js
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SERVER_INSTRUCTIONS, SupportBridge } from '@getwithin/sdk';

// The McpServer this process already constructs. Keep its name, version, and transport.
const server = new McpServer(
  { name: 'your-server', version: '1.0.0' },
  { instructions: `Your business instructions. ${SERVER_INSTRUCTIONS}` }
);

const support = SupportBridge.install(server, {
  apiKey: process.env.SUPPORTBRIDGE_API_KEY,
  baseUrl: process.env.SUPPORTBRIDGE_URL,
  source: process.env.SUPPORTBRIDGE_SOURCE ?? 'your-server',
  privacy: { captureArguments: false },
});

// One tool this server already offers. Keep its name, description, schema, and handler.
const listed = support.wrapTool({
  name: 'your_tool',
  title: 'Your tool',
  description: 'What this tool already does.',
  inputSchema: { query: z.string() },
  handler: async ({ query }) => ({
    content: [{ type: 'text', text: `Result for ${query}.` }],
    structuredContent: { query },
  }),
});
server.registerTool(
  listed.name,
  { title: listed.title, description: listed.description, inputSchema: listed.inputSchema },
  listed.handler
);

// Connect the transport this server already uses (stdio or Streamable HTTP).
```

- **`hubs: true`** registers `open_hub` and the customer hub. Leave it off and the server keeps
  today's tools. A hub invitation is attached only to a tool that went through `wrapTool`.
  `get_vendor_answer`, `confirm_assistance`, `decline_assistance`, `report_void`,
  `request_exception`, and `open_hub` do not carry one. The company still has to turn hubs on in
  the console.
- **Exceptions.** A wrapped tool that refuses on purpose returns
  `exportBlocked({ message, label })`. Within stores the block and, when the company has turned
  exceptions on, invites the customer to ask their account owner through `request_exception`. The
  long form and its accepted values are in the full guide.
- **Node.js 20 or newer.** Pass `apiKey`, `baseUrl`, and `source` into `install` from
  `SUPPORTBRIDGE_API_KEY`, `SUPPORTBRIDGE_URL`, and `SUPPORTBRIDGE_SOURCE`. `baseUrl` must be a
  Within URL the MCP process can reach. When it is omitted, `install` uses
  `http://127.0.0.1:8787`.
- **Zod 3.25+ or 4.x, yours.** Zod is a peer dependency. The SDK adds an optional `context` field
  to each wrapped tool in the same Zod your schema uses (`zod/v3` or `zod/v4`). Its own tools'
  schemas don't change with your Zod.
- **Identity** comes from claims your auth layer already verified and placed on `authInfo`,
  configured per provider with `identityClaimNamespace`, `claimMap` or `identify`. Auth0, WorkOS,
  Clerk, and the case where only a user id arrives are in the full guide.

Full guide: `docs/sdk-integration.md` in the repository.
