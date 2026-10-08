import assert from "node:assert/strict";
import test from "node:test";
import { bearerChallenge, fetchWorkOSProfile, protectedResourceMetadata } from "../auth.js";

const issuer = "https://workos.example.invalid";
const token = "synthetic-test-token";
const subject = "user_test";

test("OAuth metadata and challenge request profile and email scopes", () => {
  assert.deepEqual(protectedResourceMetadata().scopes_supported, ["openid", "profile", "email"]);
  assert.match(bearerChallenge(), /scope="openid profile email"/);
});

test("matching WorkOS UserInfo returns only approved, verified profile fields", async () => {
  const profile = await fetchWorkOSProfile(token, subject, issuer, async (input, init) => {
    assert.equal(input, `${issuer}/oauth2/userinfo`);
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${token}`);
    return Response.json({ sub: subject, name: "Test User", email: "test.user@example.invalid", email_verified: true, picture: "not approved" });
  });
  assert.deepEqual(profile, { name: "Test User", email: "test.user@example.invalid", emailVerified: true });
});

test("unverified email remains marked unverified", async () => {
  const profile = await fetchWorkOSProfile(token, subject, issuer, async () =>
    Response.json({ sub: subject, name: "Test User", email: "test.user@example.invalid", email_verified: false }),
  );
  assert.deepEqual(profile, { name: "Test User", email: "test.user@example.invalid", emailVerified: false });
});

test("subject mismatch, UserInfo failure, and exceptions do not enrich the profile", async () => {
  const mismatched = await fetchWorkOSProfile(token, subject, issuer, async () =>
    Response.json({ sub: "other_user", name: "Wrong User", email: "wrong@example.invalid", email_verified: true }),
  );
  const failed = await fetchWorkOSProfile(token, subject, issuer, async () => new Response(null, { status: 503 }));
  const threw = await fetchWorkOSProfile(token, subject, issuer, async () => { throw new Error("offline"); });
  for (const profile of [mismatched, failed, threw]) assert.deepEqual(profile, { emailVerified: false });
});
