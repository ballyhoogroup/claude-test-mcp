import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

test("choice card shows a named online representative and clears them for the assistant", () => {
  const source = readFileSync(new URL("../../within/sdk/index.mjs", import.meta.url), "utf8");
  function extract(name: string) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const rest = source.slice(start);
    const end = rest.slice(1).search(/\n(?:async )?function /);
    return end < 0 ? rest : rest.slice(0, end + 1);
  }
  const node = () => ({ hidden: true, textContent: "", value: "", scrollHeight: 0, clientHeight: 0, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, focus() {} });
  const sandbox: any = { document: {}, pendingAction: false, acceptTool: "", declineTool: "", offerId: "", renderFacts() {}, fitFrame() {}, setBusy() {}, requestAnimationFrame(callback: () => void) { callback(); }, setPill(_mode: string, text: string) { sandbox.pill = text; } };
  for (const match of source.matchAll(/(?:const|let) (\w+)=document.getElementById/g)) sandbox[match[1]] = node();
  const context = createContext(sandbox);
  runInContext(extract("renderVendor") + "\n" + extract("openAgentChat"), context);
  sandbox.renderVendor({ offer_id: "choice-offer", kind: "choice", state: "choice", vendor_name: "Pitch Fork", rep: { name: "Sarah Teller" }, representativeName: "Sarah Teller", acceptLabel: "Speak with Sarah Teller", topic: "pricing", direct_answer: "Company answer" });
  assert.equal(sandbox.vaAcceptLabel.textContent, "Speak with Sarah Teller");
  assert.equal(sandbox.vaRepHeading.textContent, "Sarah Teller");
  assert.equal(sandbox.pill, "Online");
  assert.equal(sandbox.vaRepSub.textContent, "Representative at Pitch Fork, can help with pricing");
  sandbox.openAgentChat();
  assert.equal(sandbox.vaRepHeading.textContent, "Pitch Fork assistant");
  assert.equal(sandbox.vaDot.hidden, true);
  assert.equal(sandbox.vaAgent.hidden, false);
  assert.equal(sandbox.vaAgentForm.hidden, false);
  assert.equal(sandbox.vaCard.hidden, false);
});
