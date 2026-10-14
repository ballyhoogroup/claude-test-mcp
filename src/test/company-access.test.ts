import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompanyAccess, withCompanyAccess } from "../company-access.js";

const identity = (sub: string) => ({ authInfo: { extra: { sub } } });
const rows = Array.from({ length: 20 }, (_, i) => ({ id: `company-${i}` }));
test("unique company allowance persists across instances, isolates users, allows revisits and private increases", () => {
  const dir = mkdtempSync(join(tmpdir(), "pitch-access-"));
  const path = join(dir, "access.json");
  const old = process.env.COMPANY_ACCESS_LIMITS_JSON;
  delete process.env.COMPANY_ACCESS_LIMITS_JSON;
  try {
    const store = new CompanyAccess(path);
    assert.equal(store.select(rows, identity("a")).selected.length, 10);
    assert.equal(new CompanyAccess(path).select(rows.slice(10), identity("a")).selected.length, 0);
    assert.equal(store.select(rows.slice(0, 1), identity("a")).selected.length, 1);
    assert.equal(store.select(rows, identity("b")).selected.length, 10);
    assert.throws(() => store.select(rows, { _meta: { sub: "a" } }), /Sign in/);
    process.env.COMPANY_ACCESS_LIMITS_JSON = JSON.stringify({ a: 15, b: "unlimited" });
    assert.equal(store.select(rows, identity("a")).selected.length, 15);
    assert.equal(store.select(rows, identity("b")).selected.length, 20);
  } finally {
    if (old === undefined) delete process.env.COMPANY_ACCESS_LIMITS_JSON; else process.env.COMPANY_ACCESS_LIMITS_JSON = old;
    rmSync(dir, { recursive: true, force: true });
  }
});
test("all company-returning tools require trusted identity and expose no records when blocked", async () => {
  for (const name of ["search", "fetch", "list_companies", "get_company"]) {
    const data = name === "search" ? { results: rows } : name === "list_companies" ? { companies: rows } : rows[0];
    const handler = withCompanyAccess(name, async () => ({ content: [{ type: "text", text: JSON.stringify(data) }] }));
    const result = await handler({}, {});
    assert.equal(result.isError, true);
    assert.doesNotMatch(JSON.stringify(result), /company-0/);
  }
});
