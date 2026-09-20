import assert from "node:assert/strict";
import test from "node:test";
import { bearerChallenge, fetchWorkOSProfile, identifyWorkOSUser, protectedResourceMetadata } from "../auth.js";

const issuer = "https://workos.example.invalid";
const token = "synthetic-test-token";
const subject = "user_test";

test("OAuth metadata and challenge request profile and email scopes", () => {
  assert.deepEqual(protectedResourceMetadata().scopes_supported, ["openid", "profile", "email"]);
  assert.match(bearerChallenge(), /scope="openid profile email"/);
});

test("matching WorkOS UserInfo passes only approved, verified profile fields", async () => {
  let called = false;
  const profile = await fetchWorkOSProfile(token, subject, issuer, async (input, init) => {
    called = true;
    assert.equal(input, `${issuer}/oauth2/userinfo`);
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${token}`);
    return Response.json({
      sub: subject,
      name: "Test User",
      email: "test.user@example.invalid",
      email_verified: true,
      picture: "not approved",
    });
  });
  assert.equal(called, true);
  assert.deepEqual(profile, {
    name: "Test User",
    email: "test.user@example.invalid",
    emailVerified: true,
  });
  assert.deepEqual(identifyWorkOSUser({ authInfo: {
    token,
    clientId: "test-client",
    scopes: ["openid", "profile", "email"],
    extra: { subject, organizationId: "org_test", sessionId: "session_test", ...profile },
  } }), {
    userId: "oauth:user_test",
    organizationId: "org_test",
    accountId: "workos:org_test",
    sessionId: "session_test",
    traits: { name: "Test User", email: "test.user@example.invalid" },
  });
});

test("unverified email is excluded by the WorkOS adapter", async () => {
  const profile = await fetchWorkOSProfile(token, subject, issuer, async () =>
    Response.json({ sub: subject, name: "Test User", email: "test.user@example.invalid", email_verified: false }),
  );
  const identity = identifyWorkOSUser({ authInfo: {
    token, clientId: "test-client", scopes: [], extra: { subject, ...profile },
  } });
  assert.deepEqual(identity?.traits, { name: "Test User" });
});

test("subject mismatch, UserInfo failure, and exceptions do not enrich identity", async () => {
  const mismatched = await fetchWorkOSProfile(token, subject, issuer, async () =>
    Response.json({ sub: "other_user", name: "Wrong User", email: "wrong@example.invalid", email_verified: true }),
  );
  const failed = await fetchWorkOSProfile(token, subject, issuer, async () => new Response(null, { status: 503 }));
  const threw = await fetchWorkOSProfile(token, subject, issuer, async () => { throw new Error("offline"); });
  for (const profile of [mismatched, failed, threw]) {
    assert.deepEqual(profile, { emailVerified: false });
    const identity = identifyWorkOSUser({ authInfo: {
      token, clientId: "test-client", scopes: [], extra: { subject, ...profile },
    } });
    assert.equal(identity?.userId, "oauth:user_test");
    assert.equal(identity?.traits, undefined);
  }
});

test("missing AuthInfo returns no identity", () => {
  assert.equal(identifyWorkOSUser({}), undefined);
});
