import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

/**
 * OAuth 2.1 resource-server support for this MCP server, using WorkOS AuthKit
 * as the authorization server. See https://workos.com/docs/authkit/mcp
 *
 * Auth is opt-in: it only activates once both AUTHKIT_DOMAIN and
 * MCP_RESOURCE_URL are set (e.g. as Render env vars). With neither set, the
 * server behaves exactly as before (fully open) so existing deployments and
 * local dev aren't broken by this change.
 */

function normalizeIssuer(domain: string): string {
  const withScheme = domain.startsWith("http") ? domain : `https://${domain}`;
  return withScheme.replace(/\/$/, "");
}

const rawAuthkitDomain = process.env.AUTHKIT_DOMAIN;
const resourceUrl = process.env.MCP_RESOURCE_URL?.replace(/\/$/, "");
const resourceOrigin = resourceUrl ? new URL(resourceUrl).origin : undefined;
const issuer = rawAuthkitDomain ? normalizeIssuer(rawAuthkitDomain) : undefined;

export const authEnabled = Boolean(issuer && resourceUrl);
export const workOSProfileScopes = ["openid", "profile", "email"] as const;

const jwks = issuer ? createRemoteJWKSet(new URL(`${issuer}/oauth2/jwks`)) : undefined;

if (process.env.AUTHKIT_DOMAIN && !process.env.MCP_RESOURCE_URL) {
  console.warn(
    "AUTHKIT_DOMAIN is set but MCP_RESOURCE_URL is not — OAuth stays disabled until both are set.",
  );
}

export function protectedResourceMetadataUrl(): string {
  return `${resourceOrigin}/.well-known/oauth-protected-resource`;
}

export function protectedResourceMetadata() {
  return {
    resource: resourceUrl,
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: workOSProfileScopes,
  };
}

export function bearerChallenge(): string {
  return [
    'Bearer error="unauthorized"',
    'error_description="Authorization needed"',
    `resource_metadata="${protectedResourceMetadataUrl()}"`,
    `scope="${workOSProfileScopes.join(" ")}"`,
  ].join(", ");
}

export function authorizationServerMetadataUrl(): string {
  return `${issuer}/.well-known/oauth-authorization-server`;
}

export type TokenCheck =
  | { ok: true; authInfo?: AuthInfo }
  | { ok: false; reason: string };

function stringClaim(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function tokenScopes(payload: Record<string, unknown>): string[] {
  if (typeof payload.scope === "string") {
    return payload.scope.split(" ").filter(Boolean);
  }
  if (Array.isArray(payload.scp)) {
    return payload.scp.filter((scope): scope is string => typeof scope === "string");
  }
  return [];
}

interface WorkOSUserInfo {
  sub?: unknown;
  name?: unknown;
  email?: unknown;
  email_verified?: unknown;
}

/** Fetch only approved profile fields, bound to a previously verified JWT subject. */
export async function fetchWorkOSProfile(
  accessToken: string,
  verifiedSubject: string,
  issuerUrl: string,
  request: typeof fetch = fetch,
): Promise<{ name?: string; email?: string; emailVerified: boolean }> {
  const empty = { emailVerified: false };
  try {
    const response = await request(`${issuerUrl}/oauth2/userinfo`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return empty;

    const userInfo = (await response.json()) as WorkOSUserInfo;
    if (stringClaim(userInfo.sub) !== verifiedSubject) return empty;

    return {
      name: stringClaim(userInfo.name),
      email: stringClaim(userInfo.email),
      emailVerified: userInfo.email_verified === true,
    };
  } catch {
    // Profile enrichment is optional; validated identifier-based auth still works.
    return empty;
  }
}

export async function verifyBearerToken(authorizationHeader: string | undefined): Promise<TokenCheck> {
  if (!authEnabled) {
    return { ok: true };
  }
  if (!authorizationHeader?.startsWith("Bearer ")) {
    return { ok: false, reason: "missing_bearer_token" };
  }

  const token = authorizationHeader.slice("Bearer ".length).trim();
  try {
    // WorkOS issues the configured Resource Indicator as the access token's
    // `aud` claim. Checking it prevents a token minted for another service in
    // the same WorkOS environment from being replayed against this MCP.
    const { payload } = await jwtVerify(token, jwks!, { issuer, audience: resourceUrl });
    const subject = stringClaim(payload.sub);
    if (!subject) return { ok: false, reason: "invalid_token" };
    const clientId = stringClaim(payload.client_id) ?? stringClaim(payload.azp) ?? "unknown-client";
    const scopes = tokenScopes(payload);
    console.log("WorkOS: profile scopes granted", {
      openid: scopes.includes("openid"),
      profile: scopes.includes("profile"),
      email: scopes.includes("email"),
    });
    const profile = await fetchWorkOSProfile(token, subject, issuer!);

    return {
      ok: true,
      authInfo: {
        token,
        clientId,
        scopes,
        expiresAt: payload.exp,
        resource: new URL(resourceUrl!),
        extra: {
          subject,
          sessionId: stringClaim(payload.sid),
          organizationId: stringClaim(payload.org_id),
          name: profile.name,
          email: profile.email,
          emailVerified: profile.emailVerified,
        },
      },
    };
  } catch {
    return { ok: false, reason: "invalid_token" };
  }
}
