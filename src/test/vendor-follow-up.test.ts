import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

test("assistant consent click stays open through a tool-result repaint and restored widget state", async () => {
  const source = readFileSync(new URL("../../within/sdk/index.mjs", import.meta.url), "utf8");
  const stateCode = source.slice(source.indexOf("function widgetAgentOffer(){"), source.indexOf("function resultBags(result){"));
  const renderStart = source.indexOf("function renderVendor(payload){");
  const renderCode = source.slice(renderStart, source.indexOf("\nfunction ", renderStart + 1));
  const clickStart = source.indexOf("vaAccept.onclick=async()=>{");
  const clickCode = source.slice(clickStart, source.indexOf("\n};", clickStart) + 3);
  const node = () => ({ hidden: true, textContent: "", firstChild: { textContent: "" }, classList: { add() {}, remove() {}, toggle() {} }, focus() {} });
  const sandbox: any = { window: { openai: { widgetState: {}, setWidgetState(state: unknown) { sandbox.window.openai.widgetState = state; } } },
    agentFollowUpOffer: "", offerId: "", acceptTool: "", declineTool: "", pendingAction: false, settled: false, offerClosed: false,
    fitFrame() {}, setBusy(busy: boolean) { sandbox.pendingAction = busy; } };
  for (const name of source.matchAll(/(?:const|let) (\w+)=document.getElementById/g)) sandbox[name[1]] = node();
  const context = createContext(sandbox);
  runInContext(stateCode + "\n" + renderCode + "\n" + clickCode, context);
  const payload = { offer_id: "offer-one", kind: "agent", acceptTool: "talk_to_vendor_agent", direct_answer: "Saved company answer" };
  sandbox.renderVendor(payload);
  assert.equal(sandbox.vaAgent.hidden, true);
  await sandbox.vaAccept.onclick();
  assert.equal(sandbox.vaAgent.hidden, false);
  assert.equal(sandbox.window.openai.widgetState.agentFollowUpOffer, "offer-one");
  sandbox.renderVendor(payload);
  assert.equal(sandbox.vaAgent.hidden, false);
  assert.equal(sandbox.vaAccept.hidden, true);
  sandbox.agentFollowUpOffer = "";
  sandbox.renderVendor(payload);
  assert.equal(sandbox.vaAgent.hidden, false);
  sandbox.renderVendor({ ...payload, offer_id: "different-offer" });
  assert.equal(sandbox.vaAgent.hidden, true);
});
