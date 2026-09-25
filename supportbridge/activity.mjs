/** Shared MCP activity redaction, argument summaries, and deterministic intent copy. */

const SECRET_KEY = /secret|password|token|api[-_]?key|authorization|cookie|email|phone|ssn|card|cvv|cvc|pan/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SECRET_VALUE = /\b(?:sk-[A-Za-z0-9_-]{8,}|sb_[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/-]+=*)\b/gi;
const CARD = /\b(?:\d[ -]*?){13,19}\b/g;

const TOOL_PHRASE = {
  search_companies: "Searching companies",
  list_companies: "Listing companies",
  list_industries: "Browsing industries",
  get_company: "Looking up a company",
  get_pricing: "Asked about pricing",
  get_plans: "Asked about plans"
};

export function redact(value, depth = 0) {
  if (depth > 2) return "[truncated]";
  if (typeof value === "string") {
    const cleaned = value
      .replace(EMAIL, "[redacted]")
      .replace(SECRET_VALUE, "[redacted]")
      .replace(CARD, "[redacted]");
    return cleaned.length > 200 ? `${cleaned.slice(0, 200)}…` : cleaned;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map(item => redact(item, depth + 1));
  if (!value || typeof value !== "object") return value ?? null;
  const out = {};
  for (const [key, child] of Object.entries(value).slice(0, 30)) {
    out[key] = SECRET_KEY.test(key) ? "[redacted]" : redact(child, depth + 1);
  }
  return out;
}

/** Short human summary of tool args. Omits secret keys and redacted values. Never returns raw JSON. */
export function summarizeArguments(args) {
  if (args == null) return "";
  if (typeof args === "string") {
    const cleaned = String(redact(args)).trim();
    return cleaned.slice(0, 160);
  }
  const redacted = redact(args);
  if (!redacted || typeof redacted !== "object" || Array.isArray(redacted)) {
    const text = String(redacted ?? "").trim();
    return text.slice(0, 160);
  }
  const parts = [];
  for (const [key, value] of Object.entries(redacted)) {
    if (SECRET_KEY.test(key)) continue;
    if (value == null || value === "" || value === "[redacted]" || value === "[truncated]") continue;
    if (typeof value === "object") continue;
    const text = String(value).trim();
    if (!text || text === "[redacted]") continue;
    parts.push(`${key}: ${text.slice(0, 80)}`);
    if (parts.join(", ").length >= 140) break;
  }
  return parts.join(", ").slice(0, 160);
}

export function sanitizeError(message) {
  if (message == null) return "";
  return String(redact(String(message)))
    .replace(/[\u0000-\u001f]/g, " ")
    .trim()
    .slice(0, 160);
}

function phraseForTool(toolName) {
  const key = String(toolName ?? "");
  if (TOOL_PHRASE[key]) return TOOL_PHRASE[key];
  const words = key.replace(/[_-]+/g, " ").trim();
  if (!words) return "Used a tool";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function phraseForRow(row) {
  const summary = String(row?.summary ?? "").toLowerCase();
  let phrase = phraseForTool(row?.toolName);
  if (/pric|plan|cost|quote/.test(summary) && !/pric|plan/i.test(phrase)) {
    phrase = "Asked about pricing";
  } else if (/demo|pilot|trial/.test(summary) && !/demo|pilot/i.test(phrase)) {
    phrase = "Asked about a demo";
  } else if (/secur|compliance|soc|hipaa/.test(summary) && !/secur/i.test(phrase)) {
    phrase = "Asked about security";
  }
  const failed = row?.outcome === "error" || row?.outcome === "timeout";
  if (failed) {
    const lower = phrase.charAt(0).toLowerCase() + phrase.slice(1);
    if (lower.startsWith("searching") || lower.startsWith("listing") || lower.startsWith("browsing") || lower.startsWith("looking")) {
      return `${lower} failed`;
    }
    if (lower.startsWith("asked")) return `${lower} (failed)`;
    return `${lower} failed`;
  }
  return phrase;
}

/** Deterministic one-line intent from recent activity rows. Works with no API key. */
export function activityIntentSentence(activity) {
  const rows = Array.isArray(activity) ? activity.filter(Boolean) : [];
  if (!rows.length) return "No recent tool activity.";
  const recent = rows.slice(-6);
  const phrases = [];
  for (const row of recent) {
    const phrase = phraseForRow(row);
    if (!phrases.length || phrases[phrases.length - 1] !== phrase) phrases.push(phrase);
  }
  if (phrases.length === 1) return `${phrases[0]}.`;
  if (phrases.length === 2) return `${phrases[0]}, then ${phrases[1].charAt(0).toLowerCase()}${phrases[1].slice(1)}.`;
  const head = phrases.slice(0, -1).join(", ");
  const last = phrases[phrases.length - 1];
  return `${head}, then ${last.charAt(0).toLowerCase()}${last.slice(1)}.`;
}

export function publicActivityEvent(event) {
  if (!event) return null;
  const row = {
    toolName: event.toolName,
    outcome: event.outcome,
    durationMs: event.durationMs ?? 0,
    at: event.at,
    summary: event.summary ?? ""
  };
  if (event.error) row.error = event.error;
  return row;
}
