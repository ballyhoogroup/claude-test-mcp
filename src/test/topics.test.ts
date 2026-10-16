import assert from "node:assert/strict";
import test from "node:test";
// @ts-ignore Vendored JavaScript topic helpers.
import { ASSISTANCE_INTENT_IDS, matchAssistanceIntent } from "../../within/intents.mjs";
test("SDK supports twelve commercial topics and legacy topic aliases", () => {
  assert.deepEqual(ASSISTANCE_INTENT_IDS, ["pricing", "upgrade", "demo", "trial", "enterprise", "security", "implementation", "billing", "cancellation", "renewal", "competitive", "buying_process"]);
  for (const [oldId, newId] of Object.entries({ purchase: "upgrade", security_compliance: "security", billing_payment: "billing", cancellation_downgrade: "cancellation" })) {
    assert.equal(matchAssistanceIntent(oldId), newId);
  }
  assert.equal(matchAssistanceIntent("demo_or_pilot", "show me a demo"), "demo");
  assert.equal(matchAssistanceIntent("demo_or_pilot", "start a trial"), "trial");
});
