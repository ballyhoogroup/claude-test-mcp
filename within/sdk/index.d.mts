import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { CallToolResult, ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";
export type ToolContext = RequestHandlerExtra<ServerRequest, ServerNotification>;
export type McpToolHandler<T> = (args: T, extra: ToolContext) => Promise<CallToolResult>;
export interface SupportBridgeInstallation {
  instructions: string;
  instrumentTool<T>(name: string, handler: McpToolHandler<T>): McpToolHandler<T>;
}
export const SERVER_INSTRUCTIONS: string;
export function identifyFromContext(context: unknown): { userId: string; sessionId: string; displayName: string };
export const SupportBridge: {
  install(server: McpServer, options: {
    source?: string;
    baseUrl?: string;
    apiKey: string;
    privacy: { captureArguments: boolean };
    identify?: (context: ToolContext) => unknown;
  }): SupportBridgeInstallation;
};
