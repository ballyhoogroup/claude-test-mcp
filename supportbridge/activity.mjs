/** Shared MCP activity redaction, safe argument tokens, and descriptor lead lines. */

const SECRET_KEY = /secret|password|token|api[-_]?key|authorization|cookie|email|phone|ssn|card|cvv|cvc|pan/i;
const FREE_TEXT_KEY = /^(query|q|prompt|text|message|content|body|issuesummary|issue_summary|search|input|notes?|comment|description|name|fullname|address|subject)$/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SECRET_VALUE = /\b(?:sk-[A-Za-z0-9_-]{8,}|sb_[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/-]+=*)\b/gi;
const CARD = /\b(?:\d[ -]*?){13,19}\b/g;
const SHORT_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,31}$/;

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

function isSafeTokenValue(value) {
  if (typeof value === "boolean") return true;
  if (typeof value === "number") {
    return Number.isFinite(value) && Number.isInteger(value) && Math.abs(value) <= 1_000_000;
  }
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text || text === "[redacted]" || text === "[truncated]") return false;
  if (/\s/.test(text)) return false;
  if (EMAIL.test(text)) {
    EMAIL.lastIndex = 0;
    return false;
  }
  EMAIL.lastIndex = 0;
  if (SECRET_VALUE.test(text)) {
    SECRET_VALUE.lastIndex = 0;
    return false;
  }
  SECRET_VALUE.lastIndex = 0;
  return SHORT_TOKEN.test(text);
}

/** Safe argument tokens only: enums/booleans/small ints/short tokens. Drops free text. */
export function safeArgumentTokens(args) {
  if (args == null || typeof args !== "object" || Array.isArray(args)) return {};
  const redacted = redact(args);
  if (!redacted || typeof redacted !== "object" || Array.isArray(redacted)) return {};
  const tokens = {};
  for (const [key, value] of Object.entries(redacted)) {
    if (SECRET_KEY.test(key) || FREE_TEXT_KEY.test(key)) continue;
    if (value == null || value === "" || value === "[redacted]" || value === "[truncated]") continue;
    if (typeof value === "object") continue;
    if (!isSafeTokenValue(value)) continue;
    tokens[key] = typeof value === "string" ? value.trim() : value;
    if (Object.keys(tokens).length >= 12) break;
  }
  return tokens;
}

/** @deprecated Prefer safeArgumentTokens. Kept for callers that want a string. */
export function summarizeArguments(args) {
  const tokens = safeArgumentTokens(args);
  const parts = [];
  for (const [key, value] of Object.entries(tokens)) {
    parts.push(`${key}: ${value}`);
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

export function cleanToolTitle(value) {
  if (value == null) return "";
  return String(value).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 120);
}

export function cleanToolDescription(value) {
  if (value == null) return "";
  return String(value).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 500);
}

/** Human descriptor: description, else title, else tool name. Long model copy is shortened to the first sentence. */
export function activityDescriptor(row) {
  const description = String(row?.description ?? "").trim();
  if (description) {
    if (description.length <= 96) return description;
    const first = description.match(/^(.+?[.!?])(?:\s|$)/)?.[1]?.trim();
    if (first && first.length <= 120) return first.replace(/[.!?]$/, "") || first;
    return description.slice(0, 96).trim();
  }
  const title = String(row?.title ?? "").trim();
  if (title) return title;
  const toolName = String(row?.toolName ?? "").trim();
  return toolName || "tool";
}

export function activityFingerprint(row) {
  const toolName = String(row?.toolName ?? "");
  const tokens = row?.tokens && typeof row.tokens === "object" && !Array.isArray(row.tokens)
    ? row.tokens
    : {};
  const parts = Object.keys(tokens).sort().map(key => `${key}=${String(tokens[key])}`);
  return `${toolName}|${parts.join("&")}`;
}

function errorClass(row) {
  const text = `${row?.error ?? ""} ${row?.summary ?? ""}`.toLowerCase();
  if (row?.outcome === "timeout" || /\btimeout\b|\btimed out\b/.test(text)) return "timeout";
  if (/\brate[- ]?limit|\b429\b|\btoo many requests\b/.test(text)) return "rate_limited";
  if (/\bauth|\bunauthoriz|\bforbidden|\b401\b|\b403\b|\bcredential/.test(text)) return "auth_error";
  if (row?.outcome === "error") return "error";
  return "ok";
}

/** Optional humanized status line from approved design-guide templates. */
export function humanizedActivityLine(row) {
  const tool = activityDescriptor(row);
  const klass = errorClass(row);
  const count = Math.max(1, Number(row?.count) || 1);
  const durationMs = Math.max(0, Number(row?.durationMs) || 0);
  if (klass === "timeout") {
    const seconds = Math.max(1, Math.round(durationMs / 1000) || 1);
    return `${tool} timed out after ${seconds}s`;
  }
  if (klass === "auth_error") return `${tool} rejected the session's credentials`;
  if (klass === "rate_limited") return `${tool} is rate limiting this session`;
  if (klass === "error" && count > 1) {
    const duration = durationMs >= 1000
      ? `${Math.round(durationMs / 1000)}s`
      : `${Math.max(1, durationMs)}ms`;
    return `${tool} failed ${count} times in ${duration}`;
  }
  return "";
}

function joinDescriptors(phrases) {
  if (!phrases.length) return "No recent tool activity.";
  if (phrases.length === 1) return `${phrases[0]}.`;
  if (phrases.length === 2) {
    const second = phrases[1];
    const lowered = second.charAt(0).toLowerCase() + second.slice(1);
    return `${phrases[0]}, then ${lowered}.`;
  }
  const head = phrases.slice(0, -1).join(", ");
  const last = phrases[phrases.length - 1];
  const lowered = last.charAt(0).toLowerCase() + last.slice(1);
  return `${head}, then ${lowered}.`;
}

/** Collapse consecutive same tool + safe-token fingerprint into beats with count. */
export function collapseActivityBeats(activity) {
  const rows = Array.isArray(activity) ? activity.filter(Boolean) : [];
  const beats = [];
  for (const row of rows) {
    const fingerprint = activityFingerprint(row);
    const last = beats[beats.length - 1];
    if (last && last.fingerprint === fingerprint) {
      last.count += 1;
      last.at = row.at ?? last.at;
      last.outcome = row.outcome ?? last.outcome;
      last.durationMs = row.durationMs ?? last.durationMs;
      if (row.error) last.error = row.error;
      continue;
    }
    beats.push({
      toolName: row.toolName,
      title: row.title || undefined,
      description: row.description || undefined,
      outcome: row.outcome,
      durationMs: row.durationMs ?? 0,
      at: row.at,
      tokens: row.tokens && typeof row.tokens === "object" ? { ...row.tokens } : {},
      summary: row.summary ?? "",
      error: row.error,
      count: 1,
      fingerprint
    });
  }
  return beats;
}

/** Deterministic one-line lead from descriptors (not snake_case tool names). */
export function activityIntentSentence(activity) {
  const beats = collapseActivityBeats(activity);
  if (!beats.length) return "No recent tool activity.";
  const recent = beats.slice(-6);
  const phrases = recent.map(beat => humanizedActivityLine(beat) || activityDescriptor(beat));
  return joinDescriptors(phrases);
}

export function publicActivityEvent(event) {
  if (!event) return null;
  const tokens = event.tokens && typeof event.tokens === "object" && !Array.isArray(event.tokens)
    ? { ...event.tokens }
    : {};
  const row = {
    toolName: event.toolName,
    outcome: event.outcome,
    durationMs: event.durationMs ?? 0,
    at: event.at,
    tokens,
    summary: event.summary ?? summarizeArguments(tokens),
    description: event.description || undefined,
    title: event.title || undefined,
    count: Math.max(1, Number(event.count) || 1)
  };
  if (event.error) row.error = event.error;
  return row;
}

/** Public activity as collapsed beats for Context UI and lead lines. */
export function publicActivityBeats(activity) {
  return collapseActivityBeats(activity)
    .map(beat => {
      const row = publicActivityEvent(beat);
      if (!row) return null;
      row.count = beat.count;
      return row;
    })
    .filter(Boolean);
}
