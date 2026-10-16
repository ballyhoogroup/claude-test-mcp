import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

test("SDK card uses one surface for live, note, and assistant offers", async () => {
  const source = readFileSync(new URL("../../within/sdk/index.mjs", import.meta.url), "utf8");
  function extract(name: string) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const rest = source.slice(start);
    const end = rest.slice(1).search(/\n(?:async )?function /);
    return end < 0 ? rest : rest.slice(0, end + 1);
  }
  const clickStart = source.indexOf("vaAccept.onclick=async()=>{");
  const click = source.slice(clickStart, source.indexOf("\n};", clickStart) + 3);
  const node = () => ({ hidden: true, textContent: "", value: "", firstChild: { textContent: "" }, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, focus() {} });
  const sandbox: any = { document: {}, offerId: "", acceptTool: "", declineTool: "", pendingAction: false, settled: false, offerClosed: false,
    renderFacts() {}, setPill() {}, fitFrame() {}, setBusy(busy: boolean) { sandbox.pendingAction = busy; } };
  for (const name of source.matchAll(/(?:const|let) (\w+)=document.getElementById/g)) sandbox[name[1]] = node();
  const context = createContext(sandbox);
  runInContext(extract("renderVendor") + "\n" + extract("openAgentChat") + "\n" + click, context);
  sandbox.renderVendor({ offer_id: "live", state: "live", vendor_name: "Pitch Fork", rep: { name: "Sarah Teller", first_name: "Sarah" }, acceptTool: "request_assistance", direct_answer: "Company answer" });
  assert.equal(sandbox.vaAcceptLabel.textContent, "Chat with Sarah");
  assert.equal(sandbox.vaNote.hidden, false);
  assert.equal(sandbox.vaCard.hidden, false);
  assert.equal(sandbox.offerRootEl.hidden, true);
  sandbox.renderVendor({ offer_id: "note", state: "async", vendor_name: "Pitch Fork", acceptTool: "file_escalation", direct_answer: "Company answer" });
  assert.equal(sandbox.vaAcceptLabel.textContent, "Send note");
  assert.equal(sandbox.vaDecline.textContent, "Not now");
  assert.equal(sandbox.vaNote.hidden, false);
  sandbox.renderVendor({ offer_id: "assistant", kind: "agent", acceptTool: "talk_to_vendor_agent", direct_answer: "Company answer" });
  assert.equal(sandbox.vaAgent.hidden, true);
  await sandbox.vaAccept.onclick();
  assert.equal(sandbox.vaAgent.hidden, false);
  assert.equal(sandbox.vaAgentForm.hidden, false);
  assert.equal(sandbox.vaActions.hidden, true);
  assert.equal(sandbox.vaAnswer.hidden, true);
  assert.equal(sandbox.vaCard.hidden, false);
  assert.equal(sandbox.offerRootEl.hidden, true);
});
