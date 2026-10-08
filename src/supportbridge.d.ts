declare module "*.mjs" {
  export const SERVER_INSTRUCTIONS: string;
  export const SupportBridge: any;
  export function argumentPreview(args: unknown): string;
  export function identifyFromContext(context: unknown): {
    userId: string;
    sessionId: string;
    displayName: string;
  };
}
