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
