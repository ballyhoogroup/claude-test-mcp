import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";

export class CompanyAccess {
  constructor(private path = process.env.COMPANY_ACCESS_STORE_PATH ?? resolve(".data/company-access.json")) {}
  select<T extends { id: string }>(items: T[], context: any) {
    const claims = context?.authInfo?.extra;
    const userId = claims?.sub ?? claims?.user_id;
    if (typeof userId !== "string" || !userId.trim()) throw new Error("Sign in to view companies. Your allowance is tied to your signed-in account.");
    const overrides = JSON.parse(process.env.COMPANY_ACCESS_LIMITS_JSON ?? "{}");
    const configured = Object.hasOwn(overrides, userId) ? overrides[userId] : 10;
    if (configured !== "unlimited" && (!Number.isSafeInteger(configured) || configured < 0)) throw new Error("Company allowance configuration is invalid.");
    const limit = configured === "unlimited" ? null : configured as number;
    let state: Record<string, string[]> = {};
    try { state = JSON.parse(readFileSync(this.path, "utf8")); }
    catch (error: any) { if (error.code !== "ENOENT") throw error; }
    const seen = new Set<string>(Object.hasOwn(state, userId) ? state[userId] : []);
    const selected: T[] = [];
    for (const item of items) {
      if (seen.has(item.id) || limit === null || seen.size < limit) { selected.push(item); seen.add(item.id); }
    }
    // Synchronous update prevents overlapping requests from exceeding the allowance in this process.
    Object.defineProperty(state, userId, { value: [...seen], enumerable: true, configurable: true, writable: true });
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(`${this.path}.tmp`, JSON.stringify(state), { mode: 0o600 });
    renameSync(`${this.path}.tmp`, this.path);
    const remaining = limit === null ? null : Math.max(0, limit - seen.size);
    return { selected, access: { limit, viewed: seen.size, remaining,
      ...(remaining === 0 ? { message: "Company allowance reached. You can revisit previously viewed companies. Contact Pitch-Fork to request a higher allowance." } : {}) } };
  }
}
const access = new CompanyAccess();
const companyTools = new Set(["search", "fetch", "list_companies", "get_company"]);
export function withCompanyAccess(name: string, handler: (args: any, context: any) => any) {
  if (!companyTools.has(name)) return handler;
  return async (args: any, context: any) => {
    try {
      const result = await handler(args, context);
      if (result.isError) return result;
      const document = JSON.parse(result.content[0].text);
      const rows = name === "search" ? document.results : name === "list_companies" ? document.companies : [document];
      const { selected, access: allowance } = access.select(rows, context);
      if (!selected.length && rows.length) return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: "company_limit_reached", access: allowance }) }] };
      const output = name === "search" ? { ...document, results: selected, access: allowance }
        : name === "list_companies" ? { ...document, companies: selected, count: selected.length, access: allowance }
        : { ...document, access: allowance };
      return { ...result, content: [{ type: "text", text: JSON.stringify(output) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Company access unavailable." }] };
    }
  };
}
