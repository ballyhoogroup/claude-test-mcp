/** Standard business intents for optional live-assistance offers. */
export const STANDARD_ASSISTANCE_INTENTS = [
  { id: "pricing", label: "Pricing", description: "Prices, plans, discounts, and plan inclusions" },
  { id: "purchase", label: "Purchase", description: "Buying, quotes, procurement, contracts, or speaking with sales" },
  { id: "demo_or_pilot", label: "Demo or pilot", description: "Demos, trials, evaluations, pilots, and walkthroughs" },
  { id: "enterprise", label: "Enterprise", description: "Enterprise plans, volume, SLAs, custom terms, or larger deployments" },
  { id: "implementation", label: "Implementation", description: "Setup, onboarding, migration, training, or professional services" },
  { id: "security_compliance", label: "Security and compliance", description: "SOC 2, ISO 27001, HIPAA, GDPR, SSO, DPAs, and security reviews" },
  { id: "billing_payment", label: "Billing and payment", description: "Charges, invoices, refunds, taxes, or payment problems" },
  { id: "cancellation_downgrade", label: "Cancellation or downgrade", description: "Cancellation, downgrades, reducing seats, or closing an account" }
];

export const ASSISTANCE_INTENT_IDS = STANDARD_ASSISTANCE_INTENTS.map(intent => intent.id);

export function intentById(id) {
  return STANDARD_ASSISTANCE_INTENTS.find(intent => intent.id === id);
}

export function defaultIntentToggles(enabled) {
  return Object.fromEntries(ASSISTANCE_INTENT_IDS.map(id => [id, Boolean(enabled)]));
}

const DEFAULT_SUMMARIES = {
  pricing: "Customer asked about pricing or plans.",
  purchase: "Customer asked to talk with support or sales.",
  demo_or_pilot: "Customer asked about a demo or pilot.",
  enterprise: "Customer asked about enterprise options.",
  implementation: "Customer asked about implementation or onboarding.",
  security_compliance: "Customer asked about security or compliance.",
  billing_payment: "Customer asked about billing or payment.",
  cancellation_downgrade: "Customer asked about cancellation or downgrade."
};

/**
 * Normalize host/model tool args into a known intent id and issue summary.
 * Accepts loose values like "Pricing", "support", missing summaries, and extra fields.
 */
export function normalizeAssistanceArgs(args = {}) {
  const rawIntent = String(args.intent ?? args.Intent ?? "").trim();
  const rawSummary = String(args.issueSummary ?? args.issue_summary ?? args.summary ?? "").trim().slice(0, 2_000);
  const haystack = `${rawIntent} ${rawSummary}`.toLowerCase();
  const intent = resolveAssistanceIntent(rawIntent, haystack);
  const issueSummary = rawSummary || DEFAULT_SUMMARIES[intent] || "Customer asked for live assistance.";
  return { intent, issueSummary };
}

/**
 * Normalize connect/decline tool args to a single offer id.
 * Accepts offerId or offer_id; ignores name, email, user id, and other extras.
 */
export function normalizeOfferArgs(args = {}) {
  const raw = args.offerId ?? args.offer_id ?? args.offerID ?? "";
  const offerId = typeof raw === "string" ? raw.trim() : String(raw ?? "").trim();
  return { offerId };
}

function resolveAssistanceIntent(rawIntent, haystack) {
  const normalized = rawIntent.toLowerCase().replace(/[\s-]+/g, "_");
  if (intentById(normalized)) return normalized;

  if (/\b(pric|plan|cost|discount|quote)\b/.test(haystack) || /pric|plan|cost|discount/.test(normalized)) return "pricing";
  if (/\b(purchas|buy|procure|contract|sales)\b/.test(haystack) || /purchas|buy|procure/.test(normalized)) return "purchase";
  if (/\b(demo|pilot|trial|evaluat|walkthrough)\b/.test(haystack) || /demo|pilot|trial/.test(normalized)) return "demo_or_pilot";
  if (/\b(enterprise|volume|sla)\b/.test(haystack) || /enterprise/.test(normalized)) return "enterprise";
  if (/\b(implement|onboard|migrat|train|professional.?service)\b/.test(haystack) || /implement|onboard/.test(normalized)) return "implementation";
  if (/\b(secur|complian|soc|hipaa|gdpr|sso|dpa)\b/.test(haystack) || /secur|complian/.test(normalized)) return "security_compliance";
  if (/\b(bill|invoice|refund|tax|payment)\b/.test(haystack) || /bill|invoice|payment/.test(normalized)) return "billing_payment";
  if (/\b(cancel|downgrad|close.?account|churn)\b/.test(haystack) || /cancel|downgrad/.test(normalized)) return "cancellation_downgrade";
  if (/\b(support|talk|speak|chat|help|human|representative|agent|person)\b/.test(haystack) || /support|talk|help/.test(normalized)) {
    return "purchase";
  }
  return ASSISTANCE_INTENT_IDS[0];
}

