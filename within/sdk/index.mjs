import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  cleanToolDescription,
  cleanToolTitle,
  argumentPreview,
  resultText,
  safeArgumentTokens,
  sanitizeError,
  summarizeArguments
} from "../activity.mjs";
import {
  ASSISTANCE_INTENT_IDS,
  STANDARD_ASSISTANCE_INTENTS,
  intentById,
  normalizeAssistanceArgs,
  normalizeOfferArgs
} from "../intents.mjs";
import { companyQuestionEvents, invitationFields, stampConversation } from "../company-agent.mjs";

export {
  STANDARD_ASSISTANCE_INTENTS,
  ASSISTANCE_INTENT_IDS,
  normalizeAssistanceArgs,
  normalizeOfferArgs
} from "../intents.mjs";

/** Optional field that never schema-rejects (null, numbers, extras handled in normalizers). */
const looseField = (description) => z.any().optional().describe(description);

/** Loose connect-tool schema: offerId or offer_id, extras ignored (ChatGPT hosts reject strict schemas). */
const OFFER_CONNECT_INPUT = z.object({
  offer_id: looseField("Offer id from the assistance card or invitation"),
  offerId: looseField("Offer id (camelCase). Same as offer_id.")
}).passthrough();

const AGENT_CHAT_INPUT = z.object({
  offer_id: looseField("Offer id from the vendor assistant card"),
  offerId: looseField("Offer id (camelCase). Same as offer_id."),
  text: looseField("The customer's message to the vendor assistant")
}).passthrough();

/** Loose offer_assistance schema: synonyms, missing summary, and extras (name/email) are fine. */
const OFFER_ASSISTANCE_INPUT = z.object({
  intent: looseField(`Business intent id or free text. Preferred ids: ${ASSISTANCE_INTENT_IDS.join(", ")}. Synonyms like Pricing or support are accepted.`),
  issueSummary: looseField("Short summary of the user request for the consent card. Optional; a default is used when omitted.")
}).passthrough();

export const CHAT_RESOURCE = "ui://supportbridge/chat";
export const INTENT_OFFER_RESOURCE = "ui://supportbridge/intent-offer";
export const APP_MIME = "text/html;profile=mcp-app";

/** Surface forms the host matches literally. A wildcard such as prices* is not evaluated. */
const INTENT_WORDING = STANDARD_ASSISTANCE_INTENTS
  .map(intent => `${intent.label} (${intent.words.join(", ")})`)
  .join("; ");

export const SERVER_INSTRUCTIONS = `Call ask_company when the user asks about pricing or any topic it covers. That call creates the consent card and is the answer. offer_assistance is the same call for hosts that cannot call ask_company. Search, list, and fetch return catalog records and do not create the card. The call does not contact anyone until the user agrees on the card. If a tool result includes an \`assistance\` object with a suggested message, relay that message. That offer is text, and the user replies in text. When the user accepts, call accept_invitation with its offerId. When the user accepts a manual offer in text, call request_person with its offerId. When the user declines, call decline_invitation with its offerId. ask_company covers: ${INTENT_WORDING}.`;
export const DISPLAY_INSTRUCTIONS = SERVER_INSTRUCTIONS;
export const RESULT_HINT_SENTENCE = "Pricing and commercial questions are answered by ask_company.";

export function askCompanyDescription(vendorName) {
  const company = String(vendorName || "").trim() || "the company";
  return `Ask ${company} about ${INTENT_WORDING}. This call creates the consent card and is the answer. It does not contact anyone, and it does not need a card to be showing already. Pass intent (${ASSISTANCE_INTENT_IDS.join(", ")}) and an optional short issueSummary.`;
}

export const OFFER_ASSISTANCE_DESCRIPTION = `Fallback when ask_company is unavailable. Call this tool when the user asks about ${INTENT_WORDING}. This call creates the consent card and is the answer. It does not contact anyone, and it does not need a card to be showing already. Pass intent (${ASSISTANCE_INTENT_IDS.join(", ")}) and an optional short issueSummary.`;

export function offerAssistanceDescription(vendorName) {
  const company = String(vendorName || "").trim();
  return company ? `${OFFER_ASSISTANCE_DESCRIPTION} Company: ${company}.` : OFFER_ASSISTANCE_DESCRIPTION;
}

export function talkToVendorAgentDescription(vendorName) {
  const company = String(vendorName || "").trim() || "the company";
  return `Talk with ${company}'s vendor assistant after the customer chooses Talk to the assistant. Pass offerId and text. A person is not contacted.`;
}

export const CONFIRM_ASSISTANCE_DESCRIPTION = "Starts the live chat for an assistance card the user accepted. Pass the offerId from that card. Returns the conversation status.";
export const REQUEST_ASSISTANCE_DESCRIPTION = "Opens the live chat after the user accepts a manual offer in text. Pass the offerId from the assistance object on the earlier tool result. Also opens the chat after the user accepts an assistance card, using the offerId from that card.";
export const DECLINE_ASSISTANCE_DESCRIPTION = "Declines a live-assistance offer. Pass the offerId. Does not contact anyone.";

/** Copy a vendor tool without rewriting its description. Result interception stays on the installed wrapper. */
export function wrapTool(tool, options = {}) {
  const source = tool && typeof tool === "object" ? tool : {};
  const description = options.appendResultHint === true
    ? appendResultHint(source.description)
    : source.description;
  return { ...source, description };
}

function appendResultHint(description) {
  if (typeof description !== "string" || description.length === 0) return RESULT_HINT_SENTENCE;
  return description.endsWith(" ")
    ? `${description}${RESULT_HINT_SENTENCE}`
    : `${description} ${RESULT_HINT_SENTENCE}`;
}

function indefiniteArticle(phrase) {
  return /^[aeiou]/i.test(String(phrase ?? "").trim()) ? "an" : "a";
}

export function suggestedAssistanceMessage(offer) {
  const name = String(offer?.representativeName ?? "").trim();
  const role = String(offer?.representativeRole ?? "").trim();
  const vendor = String(offer?.vendorName ?? "").trim();
  if (name && role && vendor) {
    return `${name}, ${indefiniteArticle(role)} ${role} at ${vendor}, is available to help with this now. Want to connect?`;
  }
  if (name && vendor) return `${name} at ${vendor} is available to help with this now. Want to connect?`;
  if (name) return `${name} is available to help with this now. Want to connect?`;
  return "A representative is available to help with this now. Want to connect?";
}

export function invitationText(offer) {
  return suggestedAssistanceMessage(offer);
}

const INTENT_TOPIC = {
  pricing: "pricing",
  purchase: "purchasing",
  demo_or_pilot: "a demo or pilot",
  enterprise: "enterprise terms",
  implementation: "implementation",
  security_compliance: "security and compliance",
  billing_payment: "billing",
  cancellation_downgrade: "cancellation"
};

function topicPhrase(intent, label) {
  return INTENT_TOPIC[intent] || String(label || "this request").toLowerCase();
}

export function liveOfferCopy(offer) {
  const topic = topicPhrase(offer.intent, offer.intentLabel);
  const name = offer.representativeName || "A representative";
  const vendor = offer.vendorName || "the vendor";
  const summary = String(offer.issueSummary || "").trim();
  return {
    cardEyebrow: `${vendor} support available`,
    cardTitle: `${name} can help with ${topic}.`,
    cardNote: summary
      ? `${summary} Nothing is sent until you choose Chat with support.`
      : "Nothing is sent until you choose Chat with support.",
    acceptLabel: "Chat with support",
    declineLabel: "Not now",
    acceptTool: "accept_invitation",
    declineTool: "decline_invitation",
    suggestedMessage: `${name} can help with ${topic} now. Want to connect?`
  };
}

function agentOfferCopy(offer) {
  const company = offer.vendorName || "the company";
  return {
    kind: "agent",
    acceptTool: "talk_to_vendor_agent",
    declineTool: "decline_invitation",
    acceptLabel: "Talk to the assistant",
    declineLabel: "Not now",
    suggestedMessage: `Nobody from ${company} is available. The card can open a chat with the vendor assistant. Nothing starts until the user chooses Talk to the assistant.`,
    cardEyebrow: "VENDOR ASSISTANT",
    cardTitle: "Talk with the vendor assistant?",
    cardNote: offer.answer || "The assistant answers from the company's saved reply.",
    cardEyebrowTone: "neutral"
  };
}

const DRAFT_ASK = {
  pricing: "Can you share current plans and rates?",
  purchase: "Can you help them with a purchase?",
  demo_or_pilot: "Can you arrange a demo or pilot?",
  enterprise: "Can you share enterprise terms?",
  implementation: "Can you help with implementation?",
  security_compliance: "Can you share your security and compliance details?",
  billing_payment: "Can you look into a billing question?",
  cancellation_downgrade: "Can you help with a cancellation?"
};

export function assistanceDraft(note) {
  const topic = topicPhrase(note.intent, note.intentLabel);
  const vendor = note.vendorName || "the vendor";
  const summary = String(note.issueSummary || "").trim();
  const leaked = /^(user|the user|customer|the customer)\b/i.test(summary);
  const ask = !summary || leaked
    ? (DRAFT_ASK[note.intent] || "Can you follow up?")
    : (/[.?!]$/.test(summary) ? summary : `${summary}.`);
  return `A customer is asking about ${topic} for the ${vendor} connector. ${ask}`;
}

function answerSentences(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=[A-Z])/).map(part => part.trim()).filter(Boolean);
}

function clipDirect(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= 90) return text;
  const cut = text.slice(0, 90);
  const space = cut.lastIndexOf(" ");
  return (space > 40 ? cut.slice(0, space) : cut).replace(/[.,;:]$/, "").trim();
}

export function splitVendorAnswer(text) {
  const full = String(text ?? "").replace(/\s+/g, " ").trim();
  const sentences = answerSentences(full);
  const direct = clipDirect(sentences[0] || full);
  const supporting = sentences.filter(sentence => sentence !== direct && !direct.includes(sentence));
  return {
    direct_answer: direct,
    context: supporting.join(" "),
    full_answer: full
  };
}

export function nameInitials(name) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function titleCaseRole(role) {
  return String(role ?? "").trim().split(/\s+/).filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function repCard(name, role, available) {
  const cleaned = String(name ?? "").trim();
  if (!cleaned) return undefined;
  const first = cleaned.split(/\s+/)[0];
  const titled = titleCaseRole(role);
  return {
    name: cleaned,
    first_name: first,
    role: titled,
    title: titled,
    initials: nameInitials(cleaned),
    available: available === true
  };
}

function vendorCardFields(answerText, subject = {}) {
  const intentLabel = subject.intentLabel || "";
  const topic = subject.topic || (intentLabel ? intentLabel.toLowerCase() : "");
  const rep = repCard(subject.representativeName, subject.representativeRole, subject.available);
  return {
    ...splitVendorAnswer(answerText),
    source_label: intentLabel ? `${intentLabel} docs` : "Vendor docs",
    vendor_name: subject.vendorName || "",
    vendor_initials: nameInitials(subject.vendorName),
    topic,
    ...(rep ? { rep } : {}),
    user_question: subject.userQuestion || "",
    offer_id: subject.offerId || ""
  };
}

function answerTextOf(value) {
  if (value && typeof value === "object") return String(value.text ?? value.answer ?? "").trim();
  return String(value ?? "").trim();
}

export function vendorAnswerResult(payload = {}) {
  const answer = answerTextOf(payload.answer ?? payload.offer?.answer ?? payload.escalation?.answer);
  if (payload.escalation && !payload.offer) {
    const note = payload.escalation;
    const copy = asyncEscalationCopy(note);
    const topic = topicPhrase(note.intent, note.intentLabel);
    const fields = vendorCardFields(answer, {
      vendorName: note.vendorName,
      intentLabel: note.intentLabel,
      topic,
      userQuestion: note.issueSummary,
      offerId: note.id,
      representativeName: payload.contact?.name,
      representativeRole: payload.contact?.role,
      available: false
    });
    const known = fields.rep && fields.rep.available === false ? fields.rep : null;
    if (known) copy.acceptLabel = `Send note to ${known.first_name}`;
    return {
      content: [
        { type: "text", text: copy.suggestedMessage }
      ],
      structuredContent: {
        ...fields,
        answer,
        kind: "escalation",
        status: "awaiting_consent",
        offered: true,
        chatStarted: false,
        mode: "async_note",
        offerId: note.id,
        offer_id: note.id,
        escalationOfferId: note.id,
        intent: note.intent,
        intentLabel: note.intentLabel,
        issueSummary: note.issueSummary,
        vendorName: note.vendorName,
        expiresAt: note.expiresAt,
        ...copy,
        escalation: note
      },
      _meta: uiMeta(INTENT_OFFER_RESOURCE)
    };
  }
  if (payload.offer?.source === "agent") {
    const offer = payload.offer;
    const topic = topicPhrase(offer.intent, offer.intentLabel);
    const fields = vendorCardFields(answer, {
      vendorName: offer.vendorName,
      intentLabel: offer.intentLabel,
      topic,
      userQuestion: offer.issueSummary,
      offerId: offer.id
    });
    const suggestedMessage = `Nobody from ${offer.vendorName || "the vendor"} is available. The card can open a chat with the vendor assistant. Nothing starts until the user chooses Talk to the assistant.`;
    const answerLead = fields.direct_answer ? `${fields.direct_answer} ${suggestedMessage}` : suggestedMessage;
    return {
      content: [
        { type: "text", text: answerLead }
      ],
      structuredContent: {
        ...fields,
        answer: offer.answer || answer,
        kind: "agent",
        status: "offered",
        offered: true,
        chatStarted: false,
        offerId: offer.id,
        offer_id: offer.id,
        intent: offer.intent,
        intentLabel: offer.intentLabel,
        issueSummary: offer.issueSummary,
        vendorName: offer.vendorName,
        expiresAt: offer.expiresAt,
        acceptTool: "talk_to_vendor_agent",
        declineTool: "decline_invitation",
        acceptLabel: "Talk to the assistant",
        declineLabel: "Not now",
        suggestedMessage
      },
      _meta: uiMeta(INTENT_OFFER_RESOURCE)
    };
  }
  if (payload.offer) {
    const offer = payload.offer;
    const copy = liveOfferCopy(offer);
    const firstName = String(offer.representativeName || "").trim().split(/\s+/)[0];
    const topic = topicPhrase(offer.intent, offer.intentLabel);
    const fields = vendorCardFields(answer, {
      vendorName: offer.vendorName,
      representativeName: offer.representativeName,
      representativeRole: offer.representativeRole,
      intentLabel: offer.intentLabel || intentById(offer.intent)?.label || "",
      topic,
      userQuestion: offer.issueSummary,
      offerId: offer.id,
      available: true
    });
    const pointing = firstName
      ? `${firstName} can help with ${topic} now. The card is where they ask ${firstName}.`
      : copy.suggestedMessage;
    const answerLead = fields.direct_answer ? `${fields.direct_answer} ${pointing}` : pointing;
    return {
      content: [
        { type: "text", text: answerLead }
      ],
      structuredContent: {
        ...fields,
        answer,
        kind: "live",
        status: "offered",
        offered: true,
        chatStarted: false,
        offerId: offer.id,
        offer_id: offer.id,
        intent: offer.intent,
        intentLabel: offer.intentLabel,
        issueSummary: offer.issueSummary,
        representativeName: offer.representativeName,
        representativeRole: offer.representativeRole,
        vendorName: offer.vendorName,
        expiresAt: offer.expiresAt,
        ...copy
      },
      _meta: {
        ...uiMeta(INTENT_OFFER_RESOURCE),
        "supportbridge/offer": {
          offerId: offer.id,
          offer_id: offer.id,
          vendorName: offer.vendorName,
          representativeName: offer.representativeName,
          representativeRole: offer.representativeRole
        }
      }
    };
  }
  const fields = vendorCardFields(answer, {
    vendorName: payload.vendorName,
    intentLabel: payload.intentLabel,
    topic: payload.topic,
    userQuestion: payload.user_question
  });
  return {
    content: [{ type: "text", text: fields.direct_answer || answer }],
    structuredContent: { ...fields, answer, offered: false, chatStarted: false }
  };
}

export function asyncEscalationCopy(note) {
  const topic = topicPhrase(note.intent, note.intentLabel);
  const vendor = note.vendorName || "the vendor";
  return {
    cardEyebrow: "Human follow-up",
    cardEyebrowTone: "neutral",
    cardTitle: `Ask ${vendor} about ${topic}`,
    cardNote: "They'll reply usually within a business day. Nothing is sent until you confirm.",
    draftNote: assistanceDraft(note),
    acceptLabel: "Send note",
    declineLabel: "No thanks",
    acceptTool: "leave_note",
    declineTool: "decline_invitation",
    sentTitle: `Sent to ${vendor}.`,
    suggestedMessage: "I've drafted a note you can send with the button above."
  };
}

export function assistanceFromOffer(offer) {
  const assistance = { offerId: offer.id };
  if (offer.intent) assistance.intent = offer.intent;
  assistance.representative = {
    name: offer.representativeName || "",
    role: offer.representativeRole || ""
  };
  assistance.vendor = offer.vendorName || "";
  assistance.status = "available";
  assistance.suggestedMessage = suggestedAssistanceMessage(offer);
  return assistance;
}

const STALE_PRICE_LIST = /This connector has no public price list\.[\s\S]*$/;
const PREVIOUS_CALL_INSTRUCTION = /Call offer_assistance when the user asks about a topic it covers\.[\s\S]*$/;
const PREVIOUS_PRICING_INSTRUCTION = /Call offer_assistance when the user asks about pricing or any topic it covers\.[\s\S]*$/;

function publishServerInstructions(server) {
  const protocol = server?.server;
  if (!protocol || typeof protocol !== "object") return;
  let current = typeof protocol._instructions === "string" ? protocol._instructions.trim() : "";
  if (current.includes(SERVER_INSTRUCTIONS)) return;
  if (STALE_PRICE_LIST.test(current)) current = current.replace(STALE_PRICE_LIST, "").trim();
  if (PREVIOUS_CALL_INSTRUCTION.test(current)) current = current.replace(PREVIOUS_CALL_INSTRUCTION, "").trim();
  if (PREVIOUS_PRICING_INSTRUCTION.test(current)) current = current.replace(PREVIOUS_PRICING_INSTRUCTION, "").trim();
  if (!current) {
    protocol._instructions = SERVER_INSTRUCTIONS;
    return;
  }
  if (/next tool call|Do not call|Do not ask|Do not say|Do not mention/.test(current)) {
    protocol._instructions = SERVER_INSTRUCTIONS;
    return;
  }
  protocol._instructions = `${current} ${SERVER_INSTRUCTIONS}`;
}

export function SupportBridge() {}

SupportBridge.install = function install(server, options) {
  if (!options?.apiKey) throw new Error("api_key_required");
  publishServerInstructions(server);
  const baseUrl = (options.baseUrl ?? "http://127.0.0.1:8787").replace(/\/$/, "");
  const identify = options.identify ?? identifyFromContext;
  const resolveIdentity = bindIdentity(identify, options.host ?? options.source ?? "mcp");
  const appHtml = options.appHtml ?? {};
  const toolMetaByName = new Map();
  if (typeof server.registerTool === "function") {
    const registerTool = server.registerTool.bind(server);
    server.registerTool = (name, config, handler) => {
      const toolName = String(name ?? "");
      if (toolName) {
        const title = cleanToolTitle(config?.title);
        const description = cleanToolDescription(config?.description);
        toolMetaByName.set(toolName, {
          ...(title ? { title } : {}),
          ...(description ? { description } : {})
        });
      }
      return registerTool(name, config, handler);
    };
  }

  const chatMeta = uiMeta(CHAT_RESOURCE);
  const appOnlyChatMeta = appOnlyMeta();
  const vendorName = String(options.vendorName || "").trim();
  const askHandler = async (args, extra) => createIntentOffer(baseUrl, options.apiKey, await resolveIdentity(extra), normalizeAssistanceArgs(args));
  const acceptHandler = async (args, extra) => confirmAssistance(baseUrl, options.apiKey, await resolveIdentity(extra), normalizeOfferArgs(args).offerId);
  const requestHandler = async (args, extra) => requestAssistance(baseUrl, options.apiKey, await resolveIdentity(extra), normalizeOfferArgs(args).offerId);
  const declineHandler = async (args, extra) => declineInvitation(baseUrl, options.apiKey, await resolveIdentity(extra), normalizeOfferArgs(args).offerId);
  const noteHandler = async (args, extra) => fileEscalation(
    baseUrl,
    options.apiKey,
    await resolveIdentity(extra),
    normalizeOfferArgs(args).offerId,
    String(args?.note ?? "").trim()
  );
  const agentHandler = async (args, extra) => talkToVendorAgent(baseUrl, options.apiKey, await resolveIdentity(extra), args);
  const readHandler = async (args, extra) => pollMessages(baseUrl, options.apiKey, await resolveIdentity(extra), args);
  const sendHandler = async (args, extra) => sendCustomerMessage(baseUrl, options.apiKey, await resolveIdentity(extra), args);
  const endHandler = async (args, extra) => endCustomerConversation(baseUrl, options.apiKey, await resolveIdentity(extra), args?.conversation_id);
  const offerReadHandler = async (args, extra) => readCustomerOffer(baseUrl, options.apiKey, await resolveIdentity(extra), normalizeOfferArgs(args).offerId);
  const registerAlias = (name, primary, config, handler) => {
    server.registerTool(name, {
      ...config,
      description: `Deprecated. Call ${primary} instead.`
    }, handler);
  };

  // No tool-level UI. Claude files a tool with a card template under Interactive and then skips it.
  // The consent card stays on the tool result, which is how get_vendor_answer used to be called.
  server.registerTool("ask_company", {
    title: "Pricing and commercial questions",
    description: askCompanyDescription(vendorName),
    inputSchema: OFFER_ASSISTANCE_INPUT
  }, askHandler);

  server.registerTool("offer_assistance", {
    title: "Pricing and commercial questions",
    description: offerAssistanceDescription(vendorName),
    inputSchema: OFFER_ASSISTANCE_INPUT
  }, askHandler);

  server.registerTool("accept_invitation", {
    title: "Accept invitation",
    description: CONFIRM_ASSISTANCE_DESCRIPTION,
    inputSchema: OFFER_CONNECT_INPUT,
    _meta: chatMeta
  }, acceptHandler);
  registerAlias("confirm_assistance", "accept_invitation", {
    title: "Confirm assistance",
    inputSchema: OFFER_CONNECT_INPUT,
    _meta: chatMeta
  }, acceptHandler);

  server.registerTool("request_person", {
    title: "Request a person",
    description: REQUEST_ASSISTANCE_DESCRIPTION,
    inputSchema: OFFER_CONNECT_INPUT,
    _meta: chatMeta
  }, requestHandler);
  registerAlias("request_assistance", "request_person", {
    title: "Request assistance",
    inputSchema: OFFER_CONNECT_INPUT,
    _meta: chatMeta
  }, requestHandler);

  server.registerTool("decline_invitation", {
    title: "Decline invitation",
    description: DECLINE_ASSISTANCE_DESCRIPTION,
    inputSchema: OFFER_CONNECT_INPUT
  }, declineHandler);
  registerAlias("decline_assistance", "decline_invitation", {
    title: "Decline assistance",
    inputSchema: OFFER_CONNECT_INPUT
  }, declineHandler);
  registerAlias("decline_escalation", "decline_invitation", {
    title: "Decline escalation",
    inputSchema: OFFER_CONNECT_INPUT,
    _meta: appOnlyMeta()
  }, declineHandler);

  server.registerTool("leave_note", {
    title: "Leave a note",
    description: "Files an async note the customer agreed to send when no representative was available. Pass the escalationOfferId from that offer. Does not start a chat.",
    inputSchema: OFFER_CONNECT_INPUT,
    _meta: appOnlyMeta()
  }, noteHandler);
  registerAlias("file_escalation", "leave_note", {
    title: "File escalation",
    inputSchema: OFFER_CONNECT_INPUT,
    _meta: appOnlyMeta()
  }, noteHandler);

  server.registerTool("talk_to_vendor_agent", {
    title: "Talk to the vendor assistant",
    description: talkToVendorAgentDescription(options.vendorName),
    inputSchema: AGENT_CHAT_INPUT,
    _meta: appOnlyMeta()
  }, agentHandler);

  const readSchema = {
    conversation_id: z.string(),
    after: z.number().optional()
  };
  const sendSchema = {
    conversation_id: z.string(),
    text: z.string(),
    client_message_id: z.string()
  };
  server.registerTool("read_conversation", {
    title: "Read conversation",
    description: "Reads assistance chat messages after a cursor. Used by the open chat.",
    inputSchema: readSchema,
    _meta: appOnlyChatMeta
  }, readHandler);
  registerAlias("support_get_messages", "read_conversation", {
    title: "Get assistance messages",
    inputSchema: readSchema,
    _meta: appOnlyChatMeta
  }, readHandler);

  server.registerTool("send_to_person", {
    title: "Send to person",
    description: "Sends a customer message in an accepted assistance conversation. Used by the open chat.",
    inputSchema: sendSchema,
    _meta: appOnlyChatMeta
  }, sendHandler);
  registerAlias("support_send_message", "send_to_person", {
    title: "Send assistance message",
    inputSchema: sendSchema,
    _meta: appOnlyChatMeta
  }, sendHandler);

  server.registerTool("end_conversation", {
    title: "End conversation",
    description: "Ends an assistance conversation. Used by the open chat.",
    inputSchema: { conversation_id: z.string() },
    _meta: appOnlyChatMeta
  }, endHandler);
  registerAlias("support_end_session", "end_conversation", {
    title: "End assistance session",
    inputSchema: { conversation_id: z.string() },
    _meta: appOnlyChatMeta
  }, endHandler);

  server.registerTool("get_invitation", {
    title: "Get invitation",
    description: "Reads whether an assistance offer already has a chat. Used by the offer card when it reopens.",
    inputSchema: OFFER_CONNECT_INPUT,
    _meta: appOnlyChatMeta
  }, offerReadHandler);
  registerAlias("support_get_offer", "get_invitation", {
    title: "Get assistance offer",
    inputSchema: OFFER_CONNECT_INPUT,
    _meta: appOnlyChatMeta
  }, offerReadHandler);

  registerResource(server, "Within chat", CHAT_RESOURCE, appHtml.chat ?? chatHtml());
  registerResource(server, "Within assistance offer", INTENT_OFFER_RESOURCE, appHtml.intentOffer ?? intentOfferHtml());

  const preserveToolDescription = wrapTool;
  const installation = {
    instructions: SERVER_INSTRUCTIONS,
    instrumentTool(toolName, handler) {
      return async (args, extra) => {
        const started = Date.now();
        let result;
        let identity;
        let outcome = "success";
        let errorText = "";
        try {
          result = await handler(args, extra);
          if (result?.isError) {
            outcome = "error";
            const part = Array.isArray(result.content) ? result.content.find(row => row?.type === "text" && row.text) : null;
            errorText = sanitizeError(part?.text ?? "tool_error");
          }
        } catch (cause) {
          outcome = "error";
          errorText = sanitizeError(cause?.message ?? "error");
          throw cause;
        } finally {
          identity = await resolveIdentity(extra);
          if (hasHostSession(identity)) {
            const meta = toolMetaByName.get(String(toolName)) ?? {};
            const tokens = safeArgumentTokens(args);
            const preview = argumentPreview(args);
            const reply = outcome === "success" ? resultText(result) : "";
            await reportActivity(baseUrl, options.apiKey, {
              source: options.source ?? "mcp",
              ...identity,
              toolName,
              outcome,
              durationMs: Date.now() - started,
              tokens,
              summary: summarizeArguments(tokens),
              ...(preview ? { argumentPreview: preview } : {}),
              ...(reply ? { resultText: reply } : {}),
              ...(meta.title ? { title: meta.title } : {}),
              ...(meta.description ? { description: meta.description } : {}),
              ...(errorText ? { error: errorText } : {})
            });
          }
        }
        if (result?.isError) return result;
        if (!hasHostSession(identity)) return result;
        // Business-intent cards come only from offer_assistance. Do not scan
        // tool arguments here or attach an intent card onto a business result.
        const delivered = await deliverOffer(baseUrl, options.apiKey, identity);
        if (!delivered?.offer) return result;
        // Skip re-attach when deliver reports an already-presented offer (new servers).
        // Older servers omit newlyPresented; treat that as "attach once" like before.
        if (delivered.newlyPresented === false) return result;
        return attachInvitation(result, delivered.offer);
      };
    },
    wrapTool(tool, wrapOptions = {}) {
      const defined = preserveToolDescription(tool, wrapOptions);
      if (tool && typeof tool.handler === "function") {
        defined.handler = installation.instrumentTool(String(tool.name ?? ""), tool.handler);
      }
      return defined;
    }
  };
  return installation;
};

/** Manual offer: one text line plus structured assistance. No card and no buttons. */
export function attachInvitation(result, offer) {
  const assistance = assistanceFromOffer(offer);
  const content = Array.isArray(result?.content) ? [...result.content] : [];
  content.push({ type: "text", text: assistance.suggestedMessage });
  const structuredContent = {
    ...(result?.structuredContent && typeof result.structuredContent === "object" ? result.structuredContent : {}),
    assistance
  };
  const next = { ...result, content, structuredContent };
  // Keep the vendor tool's own UI metadata. Do not attach a support card here.
  if (result?._meta == null) delete next._meta;
  return next;
}

function uiMeta(resourceUri) {
  return {
    ui: { resourceUri, visibility: ["model", "app"] },
    "ui/resourceUri": resourceUri,
    "openai/outputTemplate": resourceUri,
    "openai/widgetAccessible": true
  };
}

/** Callable from the open chat, with no transcript card of its own. */
function appOnlyMeta() {
  return {
    ui: { visibility: ["app"] },
    "openai/widgetAccessible": true
  };
}

function registerResource(server, name, uri, html) {
  const meta = resourceMeta(uri);
  server.registerResource(name, uri, {
    mimeType: APP_MIME,
    description: name,
    _meta: meta
  }, async () => ({
    contents: [{
      uri,
      mimeType: APP_MIME,
      text: html,
      _meta: meta
    }]
  }));
}

function resourceMeta(resourceUri) {
  const frame = { width: 480, height: 520 };
  return {
    ui: { preferredFrameSize: frame, prefersBorder: true },
    "ui/resourceUri": resourceUri,
    "openai/outputTemplate": resourceUri,
    "openai/widgetAccessible": true,
    "openai/widgetPrefersBorder": true
  };
}

const PLACEHOLDER_IDS = new Set(["anonymous", "customer-from-your-auth", "session-from-your-auth"]);

function hasHostSession(identity) {
  const id = String(identity?.customerSessionId ?? "").trim().toLowerCase();
  return Boolean(id) && !PLACEHOLDER_IDS.has(id);
}
const PLACEHOLDER_NAMES = new Set(["customer name"]);

/** Read the signed-in person from an MCP tool context. A missing name stays unset. */
export function identifyFromContext(context) {
  const extra = context && typeof context === "object" ? context : {};
  const authExtra = extra.authInfo?.extra && typeof extra.authInfo.extra === "object" ? extra.authInfo.extra : {};
  const meta = extra._meta && typeof extra._meta === "object" ? extra._meta : {};
  const metaUser = meta["openai/user"] && typeof meta["openai/user"] === "object" ? meta["openai/user"] : {};
  return {
    userId: firstText([authExtra.sub, authExtra.user_id, authExtra.userId, metaUser.id, meta["openai/subject"]]),
    sessionId: firstText([extra.sessionId, meta.sessionId]),
    displayName: firstText([authExtra.name, authExtra.preferred_username, metaUser.name])
  };
}

function firstText(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function usableIdentity(value, placeholders) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || placeholders.has(text.toLowerCase())) return "";
  return text;
}

function bindIdentity(identify, host) {
  const recordedHost = String(host ?? "mcp").trim().slice(0, 80) || "mcp";
  let mintedUser = "";
  let mintedSession = "";
  return async (context) => {
    const identity = await identityOf(identify, context);
    const userGiven = usableIdentity(identity.customerUserId, PLACEHOLDER_IDS);
    const sessionGiven = hasHostSession(identity) ? identity.customerSessionId : "";
    if (!userGiven && !mintedUser) mintedUser = `cus_${randomBytes(9).toString("hex")}`;
    if (!sessionGiven && !mintedSession) mintedSession = `ses_${randomBytes(9).toString("hex")}`;
    const next = {
      customerUserId: userGiven || mintedUser,
      customerSessionId: sessionGiven || mintedSession,
      host: recordedHost
    };
    if (identity.displayName) next.displayName = identity.displayName;
    return next;
  };
}

async function identityOf(identify, context) {
  const provided = await identify(context ?? {}) ?? {};
  const fromContext = identify === identifyFromContext ? {} : identifyFromContext(context);
  const displayName = usableIdentity(provided.displayName, PLACEHOLDER_NAMES) || fromContext.displayName;
  return {
    customerUserId: usableIdentity(provided.userId ?? provided.customerUserId, PLACEHOLDER_IDS) || fromContext.userId || "anonymous",
    customerSessionId: usableIdentity(provided.sessionId ?? provided.customerSessionId, PLACEHOLDER_IDS) || fromContext.sessionId || "anonymous",
    ...(displayName ? { displayName } : {})
  };
}

async function reportActivity(baseUrl, apiKey, body) {
  await serviceFetch(baseUrl, apiKey, "/v1/activity", { method: "POST", body });
}

async function deliverOffer(baseUrl, apiKey, identity) {
  return serviceFetch(baseUrl, apiKey, "/v1/offers/deliver", { method: "POST", body: identity });
}

export function toMcpResult(base, serviceResult) {
  const events = companyQuestionEvents(serviceResult || {});
  const conversation = serviceResult?.conversation?.id
    ? serviceResult.conversation
    : (serviceResult?.id && (serviceResult.phase || serviceResult.sessionId) && !serviceResult.offer ? serviceResult : null);
  let structuredContent = { ...(base?.structuredContent || {}) };
  if (conversation?.id) structuredContent = stampConversation(structuredContent, conversation);
  const invitation = invitationFields(events.find(event => event.type === "invitation" || event.type === "note"));
  if (invitation) structuredContent.invitation = invitation;
  const connected = events.find(event => event.type === "already_connected");
  if (connected && !structuredContent.conversation_id) {
    structuredContent.conversation_id = connected.conversation_id;
    structuredContent.responder = connected.responder ?? null;
    structuredContent.conversation = {
      ...(structuredContent.conversation && typeof structuredContent.conversation === "object" ? structuredContent.conversation : {}),
      id: connected.conversation_id,
      status: connected.status,
      responder: connected.responder ?? null
    };
  }
  return { ...base, structuredContent };
}

async function createIntentOffer(baseUrl, apiKey, identity, args) {
  const intent = String(args?.intent ?? "");
  const issueSummary = String(args?.issueSummary ?? "").trim();
  const result = await serviceFetch(baseUrl, apiKey, "/v1/offers/intent", {
    method: "POST",
    body: { ...identity, intent, issueSummary }
  });
  if (result?.conversation?.id) {
    return toMcpResult({
      content: [{
        type: "text",
        text: `You already have a live chat with ${result.conversation.representativeName || "support"}. Opening that conversation.`
      }],
      structuredContent: {
        status: "accepted",
        offered: false,
        chatStarted: true,
        conversationId: result.conversation.id,
        representativeName: result.conversation.representativeName
      },
      _meta: uiMeta(CHAT_RESOURCE)
    }, result);
  }
  if (result?.offer?.source === "agent") {
    return toMcpResult(vendorAnswerResult(result), result);
  }
  if (result?.reason === "manual_offer" && result?.offer?.source === "manual") {
    const offer = result.offer;
    return {
      content: [{ type: "text", text: suggestedAssistanceMessage(offer) }],
      structuredContent: {
        status: "offered",
        offered: true,
        chatStarted: false,
        assistance: assistanceFromOffer(offer)
      }
    };
  }
  if (result?.escalation) {
    return toMcpResult(vendorAnswerResult(result), result);
  }
  if (!result?.offer) {
    const reason = result?.reason ?? result?.error ?? "assistance_unavailable";
    return toMcpResult({
      content: [{
        type: "text",
        text: "Live assistance is not being offered for this request right now. Continue helping the user normally; no one has been contacted."
      }],
      structuredContent: {
        status: reason,
        chatStarted: false,
        offered: false
      }
    }, result);
  }
  return toMcpResult(vendorAnswerResult(result), result);
}

async function acceptOffer(baseUrl, apiKey, identity, offerId) {
  const result = await serviceFetch(baseUrl, apiKey, `/v1/offers/${encodeURIComponent(offerId)}/accept`, {
    method: "POST",
    body: identity
  });
  if (!result?.conversation) {
    const status = result?.error ?? "offer_not_active";
    return {
      content: [{
        type: "text",
        text: status === "representative_unavailable"
          ? "No representative is available right now. No chat has started."
          : status === "offer_expired"
            ? "That assistance offer has expired. No chat has started. Ask to connect again if you still want support."
            : status === "offer_not_found"
              ? "That assistance offer was not found. No chat has started."
              : "The assistance offer could not be accepted. No chat has started."
      }],
      structuredContent: { status, chatStarted: false },
      isError: true
    };
  }
  return toMcpResult({
    content: [{
      type: "text",
      text: `You are connected with ${result.offer.representativeName || result.offer.vendorName || "support"}. Conversation ${result.conversation.id}. The chat UI opens when this host supports MCP Apps.`
    }],
    structuredContent: {
      status: "accepted",
      chatStarted: true,
      conversationId: result.conversation.id,
      representativeName: result.offer.representativeName,
      representativeRole: result.offer.representativeRole || result.conversation.representativeRole,
      vendorName: result.offer.vendorName || result.conversation.vendorName,
      messages: []
    }
  }, result);
}

function needsOfferAssistanceResult(message) {
  return {
    content: [{ type: "text", text: message }],
    structuredContent: { status: "offer_required", chatStarted: false, offered: false }
  };
}

async function confirmAssistance(baseUrl, apiKey, identity, offerId) {
  if (!offerId) {
    return needsOfferAssistanceResult(
      "No offer id was provided. Call offer_assistance with a matching intent and issueSummary first to show the consent card. Do not start a chat without an offer."
    );
  }
  return acceptOffer(baseUrl, apiKey, identity, offerId);
}

async function requestAssistance(baseUrl, apiKey, identity, offerId) {
  if (offerId) return acceptOffer(baseUrl, apiKey, identity, offerId);
  const delivered = await deliverOffer(baseUrl, apiKey, identity);
  const open = delivered?.offer;
  if (open && (open.status === "pending" || open.status === "presented") && open.source === "manual") {
    return acceptOffer(baseUrl, apiKey, identity, open.id);
  }
  return needsOfferAssistanceResult(
    "No pending assistance offer was found for this session. For a business-intent support request, call offer_assistance with a matching intent and issueSummary first. Then confirm with that offer id."
  );
}

async function readCustomerOffer(baseUrl, apiKey, identity, offerId) {
  if (!offerId) {
    return { structuredContent: { status: "offer_id_required", chatStarted: false } };
  }
  const result = await serviceFetch(
    baseUrl,
    apiKey,
    `/v1/offers/${encodeURIComponent(offerId)}?customerSessionId=${encodeURIComponent(identity.customerSessionId)}&customerUserId=${encodeURIComponent(identity.customerUserId)}`
  );
  const conversation = result?.conversation;
  return toMcpResult({
    structuredContent: {
      status: result?.offer?.status ?? result?.error ?? "offer_not_found",
      offerId: result?.offer?.id ?? offerId,
      chatStarted: Boolean(conversation?.id),
      conversationId: conversation?.id,
      representativeName: conversation?.representativeName || result?.offer?.representativeName,
      conversation
    }
  }, result);
}

async function declineOffer(baseUrl, apiKey, identity, offerId) {
  if (!offerId) {
    return {
      content: [{
        type: "text",
        text: "An offer id is required to decline assistance. Pass offerId or offer_id from the assistance card."
      }],
      structuredContent: { status: "offer_id_required", chatStarted: false }
    };
  }
  const result = await serviceFetch(baseUrl, apiKey, `/v1/offers/${encodeURIComponent(offerId)}/decline`, {
    method: "POST",
    body: identity
  });
  if (!result?.offer || result.offer.status !== "declined") {
    return {
      content: [{ type: "text", text: "The assistance offer could not be declined." }],
      structuredContent: { status: result?.error ?? "offer_not_active", chatStarted: false },
      isError: true
    };
  }
  return toMcpResult({
    content: [{ type: "text", text: "Assistance declined. No chat was started." }],
    structuredContent: { status: "declined", chatStarted: false }
  }, { offer: result.offer });
}

async function fileEscalation(baseUrl, apiKey, identity, escalationId, noteText = "") {
  if (!escalationId) {
    return {
      content: [{ type: "text", text: "An escalation offer id is required to send the note." }],
      structuredContent: { status: "offer_id_required", chatStarted: false }
    };
  }
  const note = String(noteText ?? "").trim();
  const result = await serviceFetch(baseUrl, apiKey, `/v1/escalations/${encodeURIComponent(escalationId)}/file`, {
    method: "POST",
    body: note ? { ...identity, note } : identity
  });
  if (result?.escalation?.status === "pending") {
    return toMcpResult({
      content: [{ type: "text", text: "Note sent. No chat was started." }],
      structuredContent: { status: "pending", chatStarted: false, mode: "async_note", escalation: result.escalation }
    }, { escalation: result.escalation });
  }
  const status = result?.error ?? "escalation_not_active";
  return {
    content: [{
      type: "text",
      text: status === "escalation_expired"
        ? "That note offer has expired. No note was sent."
        : "The note could not be sent."
    }],
    structuredContent: { status, chatStarted: false },
    isError: true
  };
}

async function declineEscalation(baseUrl, apiKey, identity, escalationId) {
  if (!escalationId) {
    return {
      content: [{ type: "text", text: "An escalation offer id is required to decline the note." }],
      structuredContent: { status: "offer_id_required", chatStarted: false }
    };
  }
  const result = await serviceFetch(baseUrl, apiKey, `/v1/escalations/${encodeURIComponent(escalationId)}/decline`, {
    method: "POST",
    body: identity
  });
  if (result?.escalation?.status === "declined") {
    return toMcpResult({
      content: [{ type: "text", text: "Note declined. No one was contacted." }],
      structuredContent: { status: "declined", chatStarted: false, mode: "async_note" }
    }, { escalation: result.escalation });
  }
  return {
    content: [{ type: "text", text: "The note offer could not be declined." }],
    structuredContent: { status: result?.error ?? "escalation_not_active", chatStarted: false },
    isError: true
  };
}

async function declineInvitation(baseUrl, apiKey, identity, id) {
  if (!id) {
    return {
      content: [{ type: "text", text: "An offer id is required to decline." }],
      structuredContent: { status: "offer_id_required", chatStarted: false }
    };
  }
  const offer = await declineOffer(baseUrl, apiKey, identity, id);
  if (!offer?.isError) return offer;
  const note = await declineEscalation(baseUrl, apiKey, identity, id);
  if (!note?.isError) return note;
  return offer;
}

async function pollMessages(baseUrl, apiKey, identity, args) {
  const after = Number(args?.after) || 0;
  const result = await serviceFetch(
    baseUrl,
    apiKey,
    `/v1/conversations/${encodeURIComponent(args.conversation_id)}/messages?after=${after}&customerSessionId=${encodeURIComponent(identity.customerSessionId)}&customerUserId=${encodeURIComponent(identity.customerUserId)}`
  );
  const structuredContent = {
    ...(result ?? { status: "unavailable" }),
    conversationId: args.conversation_id
  };
  if (result?.conversation?.id) {
    structuredContent.chatStarted = true;
    if (!structuredContent.representativeName && result.conversation.representativeName) {
      structuredContent.representativeName = result.conversation.representativeName;
    }
    if (!structuredContent.representativeRole && result.conversation.representativeRole) {
      structuredContent.representativeRole = result.conversation.representativeRole;
    }
    if (!structuredContent.vendorName && result.conversation.vendorName) {
      structuredContent.vendorName = result.conversation.vendorName;
    }
    if (!structuredContent.status && result.conversation.status) {
      structuredContent.status = result.conversation.status;
    }
  }
  return toMcpResult({
    content: [{ type: "text", text: transcript(result) }],
    structuredContent
  }, result);
}

async function talkToVendorAgent(baseUrl, apiKey, identity, args) {
  const offerId = args?.offerId || args?.offer_id;
  const result = await serviceFetch(baseUrl, apiKey, "/v1/agent-chat", {
    method: "POST",
    body: { ...identity, offerId, text: args?.text }
  });
  if (!result || result.error) {
    return {
      content: [{ type: "text", text: "The assistant did not reply." }],
      isError: true,
      structuredContent: { status: result?.error ?? "not_sent", kind: "agent", offerId }
    };
  }
  const lines = (result.messages ?? []).map(row => `${row.role === "assistant" ? "Assistant" : "You"}: ${row.text}`);
  if (result.configured === false) lines.push("Repeating the saved answer. No model key is set on this service.");
  return {
    content: [{ type: "text", text: lines.join("\n") || result.reply }],
    structuredContent: {
      status: "agent_chat",
      kind: "agent",
      acceptTool: "talk_to_vendor_agent",
      offerId: result.offerId,
      offer_id: result.offerId,
      reply: result.reply,
      configured: result.configured === true,
      messages: result.messages ?? []
    }
  };
}

async function sendCustomerMessage(baseUrl, apiKey, identity, args) {
  const result = await serviceFetch(baseUrl, apiKey, `/v1/conversations/${encodeURIComponent(args.conversation_id)}/messages`, {
    method: "POST",
    body: { ...identity, text: args.text, clientMessageId: args.client_message_id }
  });
  if (!result?.message) {
    return {
      content: [{ type: "text", text: "The message was not sent." }],
      isError: true,
      structuredContent: { status: result?.error ?? "not_sent" }
    };
  }
  return toMcpResult({
    content: [{ type: "text", text: "Message sent." }],
    structuredContent: { status: "sent", message: result.message, created: result.created, conversationId: args.conversation_id }
  }, result);
}

async function endCustomerConversation(baseUrl, apiKey, identity, conversationId) {
  const result = await serviceFetch(baseUrl, apiKey, `/v1/conversations/${encodeURIComponent(conversationId)}/end`, {
    method: "POST",
    body: identity
  });
  const endedStatus = result?.conversation?.status
    ?? (typeof result?.status === "string" ? result.status : null)
    ?? result?.error
    ?? "ended";
  return toMcpResult({
    content: [{ type: "text", text: "The conversation has ended." }],
    structuredContent: { status: endedStatus, conversationId }
  }, result);
}

function transcript(result) {
  if (!result?.messages) return "No conversation is available.";
  if (!result.messages.length) return "No new messages.";
  return result.messages.map(message => `${message.sender}: ${message.text}`).join("\n");
}

async function serviceFetch(baseUrl, apiKey, path, { method = "GET", body } = {}) {
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return { error: payload.error ?? "request_failed", status: response.status };
    return payload;
  } catch {
    return null;
  }
}

function chatPanelStyles() {
  return `#header{
  display:flex;align-items:center;gap:12px;flex:none;
  padding:16px 16px 12px;border-bottom:1px solid #E8E8E2;background:#FAFAF7;
}
.presence{
  width:8px;height:8px;border-radius:50%;flex:none;background:#2F7D4F;
  box-shadow:0 0 0 3px rgba(47,125,79,.16);
}
.presence.ended{background:#9A9A91;box-shadow:none}
.header-copy{min-width:0;flex:1}
#title{
  margin:0;font:600 15px/20px Inter,"Segoe UI",system-ui,sans-serif;
  letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
#subtitle{
  margin:2px 0 0;color:#6B6B62;font:400 12px/16px Inter,"Segoe UI",system-ui,sans-serif;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
#end{
  flex:none;margin:0;padding:6px 8px;border:0;background:transparent;
  color:#6B6B62;font:500 13px/18px Inter,"Segoe UI",system-ui,sans-serif;cursor:pointer;
}
#end:hover:not(:disabled){color:#1C1C19}
#end:disabled{opacity:.45;cursor:not-allowed}
#log{
  flex:1;min-height:320px;overflow:auto;overscroll-behavior:contain;
  padding:16px;display:flex;flex-direction:column;gap:0;
}
.chat-empty{
  margin:auto;max-width:28ch;text-align:center;color:#6B6B62;
  font:400 14px/20px Inter,"Segoe UI",system-ui,sans-serif;
}
.message{display:flex;width:fit-content;max-width:78%;margin:0 0 12px}
.message.representative{margin-left:auto}
.message.system{width:100%;max-width:none;margin:16px 0;justify-content:center}
.message-content{display:flex;flex-direction:column;min-width:0;max-width:100%}
.message-who,.message-time{
  color:#6B6B62;font:400 12px/16px Inter,"Segoe UI",system-ui,sans-serif;
}
.message-who{margin:0 0 4px}
.message-time{margin:4px 0 0}
.message.representative .message-content{align-items:flex-end}
.bubble{
  width:fit-content;max-width:100%;margin:0;padding:10px 12px;
  border-radius:4px 16px 16px 16px;border:1px solid #E4D9C4;
  background:#FBF6EC;color:#1C1C19;white-space:pre-wrap;overflow-wrap:anywhere;
  font:400 14px/20px Inter,"Segoe UI",system-ui,sans-serif;
}
.message.representative .bubble{
  border:0;border-radius:16px 4px 16px 16px;background:#2F7D4F;color:#fff;
}
.system-line{
  display:flex;align-items:center;gap:8px;width:100%;
  color:#6B6B62;text-align:center;
  font:400 12px/16px Inter,"Segoe UI",system-ui,sans-serif;
}
.system-line::before,.system-line::after{content:"";flex:1;min-width:16px;height:1px;background:#E8E8E2}
.system-line span{max-width:70%;overflow-wrap:anywhere}
#composer{
  flex:none;padding:12px 16px 16px;border-top:1px solid #E8E8E2;background:#FAFAF7;
}
.composer-shell{
  display:flex;align-items:center;gap:8px;
  padding:4px 4px 4px 14px;border:1px solid #D5D5CD;border-radius:999px;background:#fff;
  transition:border-color .15s ease,box-shadow .15s ease;
}
.composer-shell:focus-within{border-color:#2F7D4F;box-shadow:0 0 0 3px rgba(47,125,79,.12)}
.composer-shell.disabled{opacity:.55;background:#F4F4F0}
#text{
  flex:1;min-width:0;margin:0;padding:8px 0;border:0;outline:0;background:transparent;
  color:#1C1C19;font:400 14px/20px Inter,"Segoe UI",system-ui,sans-serif;
}
#text::placeholder{color:#9A9A91}
#text:disabled{cursor:not-allowed}
#send{
  flex:none;display:inline-grid;place-items:center;width:36px;height:36px;margin:0;padding:0;
  border:0;border-radius:50%;background:#1C1C19;color:#fff;cursor:pointer;
}
#send:hover:not(:disabled){background:#3A3A35}
#send:disabled{opacity:.4;cursor:not-allowed}
#send svg{display:block}
:where(button,input):focus-visible{outline:2px solid #2F7D4F;outline-offset:2px}`;
}

function chatMarkup() {
  return `<header id="header">
  <span id="presence" class="presence" aria-hidden="true"></span>
  <div class="header-copy">
    <h1 id="title">Live chat</h1>
    <p id="subtitle">Connecting…</p>
  </div>
  <button id="end" type="button">End</button>
</header>
<div id="log" role="log" aria-live="polite"></div>
<form id="composer" autocomplete="off">
  <div class="composer-shell" id="shell">
    <input id="text" name="text" autocomplete="off" placeholder="Write a message" aria-label="Message">
    <button id="send" type="submit" aria-label="Send">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
  </div>
</form>`;
}

function chatClientScript() {
  return `
let conversationId="";
let cursor=0;
let representativeName="";
let representativeRole="";
let vendorName="";
let ended=false;
let chatStarted=false;
let pollTimer=null;
let logEl,titleEl,subtitleEl,presenceEl,textEl,sendEl,endEl,shellEl;
function bindChatElements(){
  logEl=document.getElementById("log");
  titleEl=document.getElementById("title");
  subtitleEl=document.getElementById("subtitle");
  presenceEl=document.getElementById("presence");
  textEl=document.getElementById("text");
  sendEl=document.getElementById("send");
  endEl=document.getElementById("end");
  shellEl=document.getElementById("shell");
}
function stopPolling(){
  if(pollTimer){clearInterval(pollTimer);pollTimer=null;}
}
function escapeText(value){
  return String(value==null?"":value);
}
function formatTime(value){
  if(!value)return "";
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return "";
  return date.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});
}
function headerSubtitle(){
  if(ended)return "Conversation ended";
  if(!representativeName)return "Connecting…";
  const role=String(representativeRole||"").trim();
  const company=String(vendorName||"").trim();
  const roleLabel=role?role.charAt(0).toUpperCase()+role.slice(1):"";
  if(roleLabel&&company)return roleLabel+" | "+company;
  if(roleLabel)return roleLabel;
  if(company)return company;
  return "Live assistance";
}
function rememberPerson(source){
  if(!source)return;
  if(source.representativeName)representativeName=source.representativeName;
  if(source.representativeRole)representativeRole=source.representativeRole;
  if(source.vendorName)vendorName=source.vendorName;
}
function setHeader(){
  titleEl.textContent=representativeName||"Live chat";
  subtitleEl.textContent=headerSubtitle();
  presenceEl.classList.toggle("ended",ended);
}
function setComposerEnabled(enabled){
  textEl.disabled=!enabled;
  sendEl.disabled=!enabled;
  endEl.disabled=!enabled||!conversationId;
  shellEl.classList.toggle("disabled",!enabled);
  textEl.placeholder=enabled?"Write a message":"Conversation ended";
}
function paint(messages){
  logEl.replaceChildren();
  const rows=Array.isArray(messages)?messages:[];
  if(!rows.length){
    const empty=document.createElement("p");
    empty.className="chat-empty";
    empty.textContent=representativeName?"You're connected. Send a message to begin.":"No messages yet.";
    logEl.append(empty);
    return;
  }
  for(const message of rows){
    const sender=message.sender||"";
    if(sender==="system"){
      const row=document.createElement("div");
      row.className="message system";
      const line=document.createElement("div");
      line.className="system-line";
      const span=document.createElement("span");
      span.textContent=escapeText(String(message.text||"").replace(/^(.*? is connected)\. No messages were sent before you accepted\. You can end this chat at any time\.$/,"$1."));
      line.append(span);
      row.append(line);
      logEl.append(row);
      continue;
    }
    const isRep=sender==="representative";
    const previous=rows[rows.indexOf(message)-1];
    const next=rows[rows.indexOf(message)+1];
    const sameSender=(other)=>other&&other.sender===sender&&other.sender!=="system";
    const row=document.createElement("div");
    row.className="message "+(isRep?"representative":"customer");
    const content=document.createElement("div");
    content.className="message-content";
    if(!sameSender(previous)){
      const who=document.createElement("div");
      who.className="message-who";
      who.textContent=escapeText(message.senderName)||(isRep?(representativeName||"Sarah"):"You");
      content.append(who);
    }
    const bubble=document.createElement("div");
    bubble.className="bubble";
    bubble.textContent=escapeText(message.text);
    content.append(bubble);
    if(!sameSender(next)){
      const time=formatTime(message.createdAt);
      if(time){
        const stamp=document.createElement("div");
        stamp.className="message-time";
        stamp.textContent=time;
        content.append(stamp);
      }
    }
    row.append(content);
    logEl.append(row);
  }
  logEl.scrollTop=logEl.scrollHeight;
}
function applyResult(data){
  const payload=data||{};
  conversationId=payload.conversationId||payload.conversation&&payload.conversation.id||conversationId;
  rememberPerson(payload);
  rememberPerson(payload.conversation);
  const phase=payload.conversation&&payload.conversation.phase||"";
  const status=payload.status||payload.conversation&&payload.conversation.status||"";
  if(status==="ended"||status==="closed"||phase==="closed"||payload.conversation&&payload.conversation.endedAt)ended=true;
  if(Array.isArray(payload.messages)){
    cursor=payload.cursor||cursor;
    if(!ended&&payload.messages.some(m=>m.sender==="system"&&/conversation has ended/i.test(m.text||"")))ended=true;
    paint(payload.messages);
  }else if(payload.chatStarted && logEl && !logEl.childElementCount){
    if(payload.representativeName)representativeName=payload.representativeName;
    paint([]);
  }
  if(ended) stopPolling();
  setHeader();
  setComposerEnabled(!ended&&!!conversationId);
}
async function refresh(){
  if(!conversationId||ended)return;
  const result=await callTool("read_conversation",{conversation_id:conversationId,after:0});
  applyResult(result.structuredContent||result);
}
function startChatSession(initial){
  if(chatStarted){
    applyResult(initial||{});
    return;
  }
  chatStarted=true;
  bindChatElements();
  document.getElementById("composer").onsubmit=async event=>{
    event.preventDefault();
    const text=textEl.value.trim();
    if(!text||!conversationId||ended)return;
    textEl.value="";
    await callTool("send_to_person",{conversation_id:conversationId,text,client_message_id:crypto.randomUUID()});
    await refresh();
  };
  endEl.onclick=async()=>{
    if(!conversationId||ended)return;
    stopPolling();
    await callTool("end_conversation",{conversation_id:conversationId});
    ended=true;
    setHeader();
    setComposerEnabled(false);
    await refresh();
  };
  onToolResult(result=>applyResult(result.structuredContent||result));
  setHeader();
  setComposerEnabled(false);
  applyResult(initial||{});
  requestFrame(520);
  stopPolling();
  if(!ended&&conversationId) pollTimer=setInterval(refresh,2000);
}
`;
}

/** Offer card for business intents. The chat resource starts already in the chat. */
function supportAppHtml(startInChat = false) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Within assistance</title>
<style>
*{box-sizing:border-box}
html,body{margin:0;background:transparent}
body{
  padding:4px 2px 8px;color:#1C1C19;
  font:400 15px/22px Inter,"Segoe UI",system-ui,sans-serif;
  -webkit-font-smoothing:antialiased;
}
#offer-root.card{
  width:100%;padding:16px 16px 14px;border:1px solid #E6E6E6;border-radius:16px;background:#fff;
}
.eyebrow{
  margin:0 0 8px;color:#1F7A4D;letter-spacing:.04em;text-transform:uppercase;
  font:700 12px/16px Inter,"Segoe UI",system-ui,sans-serif;
}
.eyebrow.neutral{color:#6B6B62}
#offer-root h1{margin:0 0 8px;font:500 16px/22px Inter,"Segoe UI",system-ui,sans-serif}
.note{margin:0;color:#8A8A82;font:400 13px/18px Inter,"Segoe UI",system-ui,sans-serif}
#draft{
  display:none;margin:12px 0 0;padding:10px 12px;border:0;border-left:3px solid #E0E0E0;
  background:#F6F6F4;color:#3F3F38;font:400 13px/18px Inter,"Segoe UI",system-ui,sans-serif;
}
#draft.visible{display:block}
.actions{display:flex;gap:8px;margin-top:14px}
#offer-root button{
  flex:none;min-height:36px;margin:0;padding:8px 14px;border-radius:8px;
  font:600 14px/20px Inter,"Segoe UI",system-ui,sans-serif;cursor:pointer;
}
#accept{border:1px solid #1F7A4D;background:#1F7A4D;color:#fff}
#accept:hover:not(:disabled){background:#18693F}
#decline{border:1px solid #E0E0E0;background:#fff;color:#1C1C19}
#decline:hover:not(:disabled){background:#F6F6F4}
#offer-root button:disabled{opacity:.5;cursor:not-allowed}
#status{margin:8px 0 0;min-height:0;color:#6B6B62;font:400 12px/16px Inter,"Segoe UI",system-ui,sans-serif}
#status:empty{display:none}
#status.error{color:#A32D2D}
#chat-root{display:none}
body.sb-chat-mode{
  display:flex;flex-direction:column;height:520px;min-height:520px;padding:0;overflow:hidden;
  background:#FAFAF7;color:#1C1C19;
  font:400 14px/20px Inter,"Segoe UI",system-ui,sans-serif;
}
body.sb-chat-mode #offer-root,body.sb-chat-mode #vendor-card{display:none}
body.sb-chat-mode #chat-root{
  display:flex;flex-direction:column;flex:1;height:520px;min-height:520px;overflow:hidden;
}
${chatPanelStyles()}
:where(button):focus-visible{outline:2px solid #2F7D4F;outline-offset:2px}
.agent-chat{display:grid;gap:10px;margin-top:12px}
.agent-chat[hidden]{display:none}
.agent-thread{display:grid;gap:8px;margin:0;padding:0;list-style:none}
.agent-thread li{margin:0;font-size:14px;line-height:1.45}
.agent-chat textarea{width:100%;min-height:72px;resize:vertical;border:1px solid #c5cdd6;border-radius:6px;padding:8px;font:inherit}
.agent-notice{margin:0;color:#5c6770;font-size:13px}
#vendor-card{
  --va-bg:#fff; --va-text:#1f2a24; --va-border:#e3e6e4; --va-offer:#f3f8f5; --va-green:#176b43; --va-on:#fff;
  display:block; width:100%; overflow:hidden; border:1px solid var(--va-border); border-radius:12px;
  background:var(--va-bg); color:var(--va-text);
  font:400 14px/21px system-ui,"Segoe UI",sans-serif;
  box-shadow:0 1px 2px rgba(20,30,25,.06);
}
#vendor-card[hidden]{display:none}
.va-head{
  display:flex; align-items:center; justify-content:space-between; gap:16px; min-height:44px; margin:0; padding:0 24px;
  background:#fafbfa; border-bottom:1px solid #eceeed;
}
.va-brand{display:flex; align-items:center; gap:8px; min-width:0}
.va-badge{
  display:grid; place-items:center; width:22px; height:22px; border-radius:6px; background:var(--va-green); color:var(--va-on);
  font:600 11px/1 system-ui,"Segoe UI",sans-serif;
}
.va-brand strong{font:600 14px/20px system-ui,"Segoe UI",sans-serif}
.va-kicker{color:#6b776f; font:400 13px/18px system-ui,"Segoe UI",sans-serif}
.va-source{display:flex; align-items:center; gap:6px; margin:0; color:#6b776f; font:400 13px/18px system-ui,"Segoe UI",sans-serif; white-space:nowrap}
.va-answer{display:flex; flex-direction:column; gap:10px; padding:16px 24px 18px}
#va-direct{margin:0; color:#1f2a24; font:600 15px/22px system-ui,"Segoe UI",sans-serif}
#va-direct[hidden]{display:none}
#va-context{margin:0; color:#3d4a43; font:400 14px/21px system-ui,"Segoe UI",sans-serif}
#va-context{
  display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:3; overflow:hidden;
}
#va-context.is-open{display:block; -webkit-line-clamp:unset; overflow:visible}
#va-context[hidden],#va-more[hidden]{display:none}
#va-more{
  display:inline-flex; align-items:center; gap:4px; margin:0; padding:0; border:0; background:transparent;
  color:var(--va-green); font:500 13px/18px system-ui,"Segoe UI",sans-serif; cursor:pointer;
}
.va-offer{
  display:flex; flex-direction:column; gap:12px; margin:0; padding:16px 24px 18px; border-top:1px solid #eceeed;
  background:var(--va-offer);
}
.va-offer.is-note{background:#f6f6f3}
.va-offer[hidden]{display:none}
.va-rep{display:flex; align-items:flex-start; gap:12px}
.va-avatar-wrap{position:relative; flex:none; width:40px; height:40px}
.va-avatar{
  display:grid; place-items:center; width:40px; height:40px; border-radius:20px; background:#d9e9df; color:#176b43;
  font:600 14px/1 system-ui,"Segoe UI",sans-serif;
}
.va-offer.is-note .va-avatar{background:#e6e8e3; color:#4f5d56}
#va-bubble{display:none}
.va-offer.is-note .va-avatar:not(.has-initials) #va-bubble{display:block}
.va-dot{
  position:absolute; right:-1px; bottom:-1px; width:12px; height:12px; border:2px solid #f3f8f5; border-radius:6px; background:#1f9d5a;
}
.va-dot.is-offline{background:#fff; border:2px solid #9aa49e}
.va-dot[hidden]{display:none}
#va-rep-heading{margin:0; color:#1f2a24; font:600 15px/22px system-ui,"Segoe UI",sans-serif}
#va-rep-sub{margin:2px 0 0; color:#4f5d56; font:400 13px/18px system-ui,"Segoe UI",sans-serif}
.va-question{margin:0; padding:9px 12px; border:1px solid #dfe8e2; border-radius:8px; background:#fff}
.va-question[hidden]{display:none}
.va-offer.is-note .va-question{display:none}
#va-eyebrow{display:none; margin:0 0 2px; color:#6b776f; letter-spacing:.06em; font:600 11px/16px system-ui,"Segoe UI",sans-serif}
.va-offer.is-note #va-eyebrow{display:block}
#va-note-label{display:block; margin:0 0 6px; color:#6b776f; letter-spacing:.06em; font:600 11px/16px system-ui,"Segoe UI",sans-serif}
#va-note-text{
  display:block; width:100%; height:64px; max-height:160px; box-sizing:border-box; resize:vertical;
  padding:9px 12px; border:1px solid #dfe3dd; border-radius:8px; background:#fff; color:#1f2a24;
  font:400 14px/21px system-ui,"Segoe UI",sans-serif;
}
.va-note{display:none}
.va-offer.is-note .va-note{display:block}
#va-helper{margin:8px 0 0; color:#6b776f; font:400 12px/16px system-ui,"Segoe UI",sans-serif}
.va-actions{display:flex; flex-wrap:wrap; align-items:center; gap:8px 12px; margin:0}
#va-accept{
  display:inline-flex; align-items:center; gap:8px; height:40px; padding:0 18px; border:0; border-radius:8px; background:var(--va-green); color:var(--va-on);
  font:600 14px/20px system-ui,"Segoe UI",sans-serif; cursor:pointer;
}
#va-decline{
  height:40px; padding:0 12px; border:0; background:transparent; color:#3d4a43;
  font:500 14px/20px system-ui,"Segoe UI",sans-serif; cursor:pointer;
}
#va-accept:disabled,#va-decline:disabled{opacity:.5; cursor:not-allowed}
#va-privacy{display:flex; align-items:center; gap:6px; margin:0 0 0 auto; color:#4f5d56; font:400 12px/16px system-ui,"Segoe UI",sans-serif}
#va-status{margin:0; color:#4f5d56; font:400 12px/16px system-ui,"Segoe UI",sans-serif}
#va-status:empty{display:none}
#va-status.error{color:#A32D2D}
#va-agent[hidden]{display:none}
#va-agent{display:flex; flex-direction:column; gap:10px; margin-top:4px}
#va-agent-log{display:flex; flex-direction:column; gap:8px}
.va-agent-line{margin:0}
#va-agent-form{display:flex; gap:8px}
#va-agent-input{flex:1; min-width:0; height:40px; margin:0; padding:0 10px; border:1px solid #e3e6e4; border-radius:8px; font:400 14px/20px system-ui,"Segoe UI",sans-serif}
#va-agent-send{height:40px; margin:0; padding:0 14px; border:1px solid #176b43; border-radius:8px; background:#176b43; color:#fff; font:500 14px/20px system-ui,"Segoe UI",sans-serif; cursor:pointer}
#va-agent-foot{margin:0; color:#6b776f; font:400 12px/16px system-ui,"Segoe UI",sans-serif}
</style></head>
<body${startInChat ? ' class="sb-chat-mode"' : ""}>
  <article id="vendor-card" hidden>
    <header class="va-head">
      <div class="va-brand">
        <span id="va-vendor-badge" class="va-badge"></span>
        <strong id="va-vendor-name"></strong>
        <span class="va-kicker">Vendor answer</span>
      </div>
      <p id="va-source" class="va-source"><span id="va-source-text"></span></p>
    </header>
    <div class="va-answer">
      <p id="va-direct"></p>
      <p id="va-context"></p>
      <button id="va-more" type="button" hidden>Show full answer</button>
    </div>
    <section id="va-offer" class="va-offer" hidden>
      <div class="va-rep">
        <span class="va-avatar-wrap"><span id="va-avatar" class="va-avatar"><span id="va-initials"></span><svg id="va-bubble" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M3.2 4.2h11.6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H8.4L5 14.6V12.2H3.2a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg></span><span id="va-dot" class="va-dot" hidden></span></span>
        <div>
          <p id="va-eyebrow" hidden>HUMAN FOLLOW-UP</p>
          <h2 id="va-rep-heading"></h2>
          <p id="va-rep-sub"></p>
        </div>
      </div>
      <div id="va-question" class="va-question" hidden><span id="va-question-label"></span><em id="va-question-text"></em></div>
      <div id="va-note" class="va-note" hidden>
        <label id="va-note-label" for="va-note-text">YOUR NOTE, EDIT IF YOU LIKE</label>
        <textarea id="va-note-text"></textarea>
        <p id="va-helper"></p>
      </div>
      <div class="va-actions">
        <button id="va-accept" type="button"><span id="va-accept-label">Chat with support</span></button>
        <button id="va-decline" type="button">Not now</button>
        <p id="va-privacy"><span id="va-privacy-text"></span></p>
      </div>
      <p id="va-status" role="status"></p>
      <div id="va-agent" hidden>
        <div id="va-agent-log"></div>
        <form id="va-agent-form">
          <label for="va-agent-input">Follow-up</label>
          <input id="va-agent-input" type="text" maxlength="2000" placeholder="Ask a follow-up">
          <button id="va-agent-send" type="submit">Send</button>
        </form>
        <p id="va-agent-foot">A person is not in this chat.</p>
      </div>
    </section>
  </article>
  <section id="offer-root" class="card" aria-labelledby="offer-title">
    <p class="eyebrow" id="eyebrow">Support available</p>
    <h1 id="offer-title">Support is available to review this result. Would you like to connect?</h1>
    <p class="note" id="note">Nothing is sent until you choose Chat with support.</p>
    <blockquote id="draft" hidden></blockquote>
    <div class="actions" id="actions">
      <button id="accept" type="button">Chat with support</button>
      <button id="decline" type="button">Not now</button>
    </div>
    <form class="agent-chat" id="agent-chat" hidden>
      <ol class="agent-thread" id="agent-thread"></ol>
      <p class="agent-notice" id="agent-notice" hidden>Repeating the saved answer. No model key is set on this service.</p>
      <label for="agent-text">Message</label>
      <textarea id="agent-text" name="text" maxlength="2000" required></textarea>
      <button id="agent-send" type="submit">Send</button>
    </form>
    <p id="status" role="status" aria-live="polite"></p>
  </section>
  <div id="chat-root">${chatMarkup()}</div>
<script>${bridgeScript()}${chatClientScript()}
/* sb-state-machine: offer → connecting → chat → ended */
/* initial-chatStarted-renders-chat */
let offerId="";
let acceptTool="accept_invitation";
let declineTool="decline_invitation";
let noteOffer=false;
let agentOffer=false;
let sentTitle="";
let settled=false;
let pendingAction=false;
let offerClosed=false;
const eyebrowEl=document.getElementById("eyebrow");
const offerTitleEl=document.getElementById("offer-title");
const noteEl=document.getElementById("note");
const draftEl=document.getElementById("draft");
const actionsEl=document.getElementById("actions");
const statusEl=document.getElementById("status");
const acceptEl=document.getElementById("accept");
const declineEl=document.getElementById("decline");
const agentChatEl=document.getElementById("agent-chat");
const agentThreadEl=document.getElementById("agent-thread");
const agentNoticeEl=document.getElementById("agent-notice");
const agentTextEl=document.getElementById("agent-text");
const offerRootEl=document.getElementById("offer-root");
const vaCard=document.getElementById("vendor-card");
const vaVendorBadge=document.getElementById("va-vendor-badge");
const vaVendorName=document.getElementById("va-vendor-name");
const vaSourceText=document.getElementById("va-source-text");
const vaDirect=document.getElementById("va-direct");
const vaContext=document.getElementById("va-context");
const vaMore=document.getElementById("va-more");
const vaOffer=document.getElementById("va-offer");
const vaAvatar=document.getElementById("va-avatar");
const vaInitials=document.getElementById("va-initials");
const vaDot=document.getElementById("va-dot");
const vaEyebrow=document.getElementById("va-eyebrow");
const vaRepHeading=document.getElementById("va-rep-heading");
const vaRepSub=document.getElementById("va-rep-sub");
const vaQuestion=document.getElementById("va-question");
const vaQuestionLabel=document.getElementById("va-question-label");
const vaQuestionText=document.getElementById("va-question-text");
const vaNote=document.getElementById("va-note");
const vaNoteLabel=document.getElementById("va-note-label");
const vaNoteText=document.getElementById("va-note-text");
const vaHelper=document.getElementById("va-helper");
const vaAccept=document.getElementById("va-accept");
const vaAcceptLabel=document.getElementById("va-accept-label");
const vaDecline=document.getElementById("va-decline");
const vaPrivacyText=document.getElementById("va-privacy-text");
const vaStatus=document.getElementById("va-status");
const vaAgent=document.getElementById("va-agent");
const vaAgentLog=document.getElementById("va-agent-log");
const vaAgentForm=document.getElementById("va-agent-form");
const vaAgentInput=document.getElementById("va-agent-input");
let vaShort="";
let vaFull="";
let vaContextText="";
let vaUserQuestion="";
function renderAgentThread(payload){
  agentOffer=true;
  agentChatEl.hidden=false;
  actionsEl.hidden=true;
  agentThreadEl.replaceChildren();
  for(const row of payload.messages||[]){
    const item=document.createElement("li");
    item.textContent=(row.role==="assistant"?"Assistant: ":"You: ")+String(row.text||"");
    agentThreadEl.append(item);
  }
  agentNoticeEl.hidden=payload.configured!==false;
  statusEl.textContent="";
  fitFrame();
}
function resultBags(result){
  if(!result||typeof result!=="object")return [];
  return [result.structuredContent,result.toolOutput,result.toolResponseMetadata,result.result,result].filter(bag=>bag&&typeof bag==="object");
}
function conversationIdOf(result){
  for(const bag of resultBags(result)){
    const id=bag.conversationId||bag.conversation&&bag.conversation.id;
    if(id)return String(id);
  }
  return "";
}
function chatStartedOf(result){
  for(const bag of resultBags(result)){
    if(bag.chatStarted===true)return true;
  }
  return false;
}
function statusOf(result){
  for(const bag of resultBags(result)){
    if(typeof bag.status==="string"&&bag.status)return bag.status;
  }
  return "";
}
function mountPayload(result){
  const bags=resultBags(result);
  return Object.assign({},...bags.reverse());
}
function mountChat(payload){
  settled=true;
  document.body.classList.add("sb-chat-mode");
  startChatSession(payload||{});
  requestFrame(520);
}
function renderVendor(payload){
  offerRootEl.hidden=true;
  vaCard.hidden=false;
  const rep=payload.rep&&typeof payload.rep==="object"?payload.rep:{};
  const vendorName=payload.vendor_name||payload.vendorName||"";
  vaVendorBadge.textContent=payload.vendor_initials||"";
  vaVendorName.textContent=vendorName;
  vaSourceText.textContent=payload.source_label||((payload.intentLabel||"Vendor")+" docs");
  vaShort=payload.direct_answer||"";
  vaContextText=payload.context||"";
  vaFull=payload.full_answer||vaShort;
  vaDirect.hidden=false;
  vaDirect.textContent=vaShort;
  vaContext.classList.remove("is-open");
  vaContext.hidden=!vaContextText;
  vaContext.textContent=vaContextText;
  vaMore.hidden=vaFull.length<=vaShort.length;
  vaMore.textContent="Show full answer";
  offerId=payload.offer_id||payload.offerId||payload.escalationOfferId||"";
  if(payload.acceptTool) acceptTool=payload.acceptTool;
  if(payload.declineTool) declineTool=payload.declineTool;
  if(payload.sentTitle) sentTitle=payload.sentTitle;
  const kind=payload.kind||(acceptTool==="talk_to_vendor_agent"?"agent":(acceptTool==="leave_note"||acceptTool==="file_escalation"||payload.mode==="async_note"?"escalation":"live"));
  const note=kind==="escalation"&&Boolean(offerId);
  agentOffer=kind==="agent";
  noteOffer=note;
  vaOffer.classList.toggle("is-note", note);
  vaOffer.hidden=!offerId;
  const topic=payload.topic||String(payload.intentLabel||"this").toLowerCase();
  const known=note&&rep.name&&rep.available===false;
  vaUserQuestion=payload.user_question||"";
  vaAgent.hidden=true;
  vaAccept.hidden=false;
  vaDecline.hidden=false;
  if(kind==="agent"){
    vaEyebrow.hidden=false;
    vaEyebrow.textContent="VENDOR ASSISTANT";
    vaNote.hidden=true;
    vaQuestion.hidden=true;
    vaAvatar.classList.add("has-initials");
    vaInitials.textContent=payload.vendor_initials||"A";
    vaDot.hidden=true;
    vaRepHeading.textContent="Vendor assistant";
    vaRepSub.textContent="No one from the team is taking this. The assistant answers from the saved context.";
    vaAcceptLabel.textContent=payload.acceptLabel||"Talk to the assistant";
    vaDecline.textContent=payload.declineLabel||"Not now";
    vaPrivacyText.textContent="Nothing starts until you choose Talk to the assistant.";
  }else if(note){
    const first=rep.first_name||String(rep.name||"").split(" ")[0];
    vaEyebrow.hidden=false;
    vaEyebrow.textContent="HUMAN FOLLOW-UP";
    vaNote.hidden=false;
    vaQuestion.hidden=true;
    vaAvatar.classList.toggle("has-initials", Boolean(known));
    vaInitials.textContent=known?(rep.initials||""):"";
    vaDot.hidden=!known;
    vaDot.classList.toggle("is-offline", Boolean(known));
    vaRepHeading.textContent=known?("Leave "+rep.name+" a note about "+topic):("Ask "+(vendorName||"the vendor")+" about "+topic);
    vaRepSub.textContent=known
      ?(first+" is offline right now.")
      :("No one on the "+topic+" team is online right now. They usually reply within a business day.");
    vaNoteLabel.textContent=known?("YOUR NOTE TO "+first.toUpperCase()+", EDIT IF YOU LIKE"):"YOUR NOTE, EDIT IF YOU LIKE";
    if(document.activeElement!==vaNoteText) vaNoteText.value=payload.user_question||payload.issueSummary||"";
    vaHelper.textContent=(known?first:(vendorName||"The vendor"))+" sees this note and your name from this session. They don't see the rest of your chat.";
    vaAcceptLabel.textContent=payload.acceptLabel||(known?"Send note to "+first:"Send note");
    vaDecline.textContent=payload.declineLabel||"No thanks";
    vaPrivacyText.textContent="Nothing is sent until you choose "+(vaAcceptLabel.textContent||"Send note");
  }else{
    vaEyebrow.hidden=true;
    vaNote.hidden=true;
    vaAvatar.classList.add("has-initials");
    vaInitials.textContent=rep.initials||payload.vendor_initials||"";
    vaDot.hidden=rep.available!==true;
    vaDot.classList.remove("is-offline");
    const first=rep.first_name||String(rep.name||"").split(" ")[0];
    const ask=first?"Ask "+first:(payload.acceptLabel||"Chat with support");
    vaAcceptLabel.textContent=ask;
    vaDecline.textContent=payload.declineLabel||"Not now";
    vaPrivacyText.textContent="Nothing is sent until you choose "+ask+".";
    vaRepHeading.textContent=rep.name?rep.name+" can help with "+topic:"Support can help with "+topic;
    const role=rep.role||rep.title||"";
    const place=role?role+" at "+(vendorName||"the vendor"):(vendorName||"");
    const presence=rep.available===true?"Online now":"";
    vaRepSub.textContent=[place,presence].filter(Boolean).join(". ")+(place||presence?".":"");
    const question=payload.user_question||"";
    vaQuestion.hidden=!question;
    vaQuestionLabel.textContent=(first||"SUPPORT").toUpperCase()+" WILL SEE";
    vaQuestionText.textContent=question?'"'+question+'"':"";
  }
  if(!pendingAction) setBusy(false);
  fitFrame();
}
function apply(data){
  const payload=flattenAssistance(data||{});
  if(payload.direct_answer){
    renderVendor(payload);
    if(conversationIdOf(payload)&&chatStartedOf(payload)){
      mountChat(mountPayload(payload));
    }
    return;
  }
  if((payload.kind==="agent"||payload.acceptTool==="talk_to_vendor_agent")&&Array.isArray(payload.messages)){
    offerId=payload.offerId||payload.offer_id||offerId;
    renderAgentThread(payload);
    setBusy(false);
    return;
  }
  if(conversationIdOf(payload)&&(chatStartedOf(payload)||Array.isArray(payload.messages)||(payload.conversation&&payload.conversation.id))){
    mountChat(mountPayload(payload));
    return;
  }
  if(payload.status==="representative_unavailable"||payload.available===false){
    settled=true;
    offerClosed=true;
    offerId="";
    eyebrowEl.textContent="SUPPORT UNAVAILABLE";
    offerTitleEl.textContent="No representative is available right now.";
    noteEl.textContent="Nothing was sent. Try again later.";
    statusEl.classList.add("error");
    statusEl.textContent="No one is available.";
    setBusy(true);
    fitFrame();
    return;
  }
  offerId=payload.offerId||payload.offer_id||payload.escalationOfferId||offerId;
  if(payload.acceptTool) acceptTool=payload.acceptTool;
  if(payload.declineTool) declineTool=payload.declineTool;
  agentOffer=payload.kind==="agent"||acceptTool==="talk_to_vendor_agent";
  noteOffer=!agentOffer&&(payload.mode==="async_note"||acceptTool==="leave_note"||acceptTool==="file_escalation"||declineTool==="decline_escalation");
  if(payload.cardTitle){
    eyebrowEl.textContent=payload.cardEyebrow||eyebrowEl.textContent;
    eyebrowEl.classList.toggle("neutral", payload.cardEyebrowTone==="neutral");
    offerTitleEl.textContent=payload.cardTitle;
    if(payload.cardNote) noteEl.textContent=payload.cardNote;
    if(payload.draftNote){
      draftEl.hidden=false;
      draftEl.classList.add("visible");
      draftEl.textContent=payload.draftNote;
    }else{
      draftEl.hidden=true;
      draftEl.classList.remove("visible");
      draftEl.textContent="";
    }
    if(payload.acceptLabel) acceptEl.textContent=payload.acceptLabel;
    if(payload.declineLabel) declineEl.textContent=payload.declineLabel;
    if(payload.sentTitle) sentTitle=payload.sentTitle;
    if(!pendingAction) setBusy(false);
    fitFrame();
    return;
  }
  const vendor=payload.vendorName||"";
  if(vendor){
    eyebrowEl.textContent=(vendor+" support available").toUpperCase();
    offerTitleEl.textContent=vendor+" support is available to review this result. Would you like to connect?";
  }
  const who=payload.representativeName?(payload.representativeName+(payload.representativeRole?", "+payload.representativeRole:"")):(vendor||"the representative");
  if(payload.representativeName||vendor) noteEl.textContent="Starting a chat contacts "+who+". Nothing is sent until you choose Chat with support.";
  if(!pendingAction) setBusy(false);
  fitFrame();
}
function setBusy(busy){
  pendingAction=busy;
  const locked=busy||settled||offerClosed||!offerId;
  acceptEl.disabled=locked;
  declineEl.disabled=locked;
  vaAccept.disabled=locked;
  vaDecline.disabled=locked;
}
vaMore.onclick=()=>{
  const open=vaContext.classList.toggle("is-open");
  if(open){
    vaDirect.hidden=true;
    vaContext.hidden=false;
    vaContext.textContent=vaFull;
    vaMore.textContent="Show less";
  }else{
    vaDirect.hidden=false;
    vaContext.classList.remove("is-open");
    vaContext.hidden=!vaContextText;
    vaContext.textContent=vaContextText;
    vaMore.textContent="Show full answer";
  }
  fitFrame();
};
function paintAgentMessages(payload){
  const messages=Array.isArray(payload.messages)?payload.messages:[];
  vaAgentLog.replaceChildren();
  for(const message of messages){
    const line=document.createElement("p");
    line.className="va-agent-line";
    line.textContent=(message.role==="user"?"You: ":"Assistant: ")+String(message.text||"");
    vaAgentLog.append(line);
  }
  vaAgent.hidden=false;
  vaAccept.hidden=true;
  vaDecline.hidden=true;
  vaQuestion.hidden=true;
  vaNote.hidden=true;
  vaPrivacyText.textContent="";
  vaStatus.classList.remove("error");
  vaStatus.textContent=payload.configured===false?"Repeating the saved answer. No model key is set on this service.":"";
  vaCard.hidden=false;
  offerRootEl.hidden=true;
  setBusy(false);
  fitFrame();
}
async function sendAgent(text){
  const cleaned=String(text||"").trim();
  if(!cleaned){
    vaStatus.classList.add("error");
    vaStatus.textContent="Type a message first.";
    setBusy(false);
    return;
  }
  const result=await callTool("talk_to_vendor_agent",{offer_id:offerId,offerId:offerId,text:cleaned});
  paintAgentMessages(mountPayload(result));
  vaAgentInput.value="";
}
vaAccept.onclick=async()=>{
  if(!offerId||settled||pendingAction||offerClosed)return;
  setBusy(true);
  vaStatus.classList.remove("error");
  vaStatus.textContent=noteOffer?"Sending…":"Connecting…";
  try{
    if(acceptTool==="talk_to_vendor_agent"){
      vaAgent.hidden=false;
      vaAccept.hidden=true;
      vaDecline.hidden=true;
      vaStatus.textContent="";
      setBusy(false);
      vaAgentInput.focus();
      fitFrame();
      return;
    }
    const args={offer_id:offerId,offerId:offerId};
    if(acceptTool==="leave_note"||acceptTool==="file_escalation") args.note=vaNoteText.value.trim();
    const result=await callTool(acceptTool,args);
    if(noteOffer||acceptTool==="leave_note"||acceptTool==="file_escalation"){
      const filed=statusOf(result);
      if(filed==="pending"){
        settled=true;
        offerClosed=true;
        vaRepHeading.textContent=sentTitle||"Sent.";
        vaNote.hidden=true;
        vaAccept.hidden=true;
        vaDecline.hidden=true;
        vaPrivacyText.textContent="";
        vaStatus.textContent="";
        setBusy(true);
        fitFrame();
        return;
      }
      vaStatus.classList.add("error");
      vaStatus.textContent=filed==="escalation_expired"?"This note offer has expired. Ask again if you still want to send it.":"Could not send this note.";
      setBusy(false);
      return;
    }
    const conversationId=conversationIdOf(result);
    if(chatStartedOf(result)&&conversationId){
      mountChat(Object.assign(mountPayload(result),{conversationId:conversationId,chatStarted:true}));
      return;
    }
    vaStatus.classList.add("error");
    vaStatus.textContent="Could not start this chat.";
    setBusy(false);
  }catch(error){
    vaStatus.classList.add("error");
    vaStatus.textContent=error.message||"Could not start this chat.";
    setBusy(false);
  }
};
vaDecline.onclick=async()=>{
  if(!offerId||settled||pendingAction||offerClosed)return;
  setBusy(true);
  vaStatus.classList.remove("error");
  vaStatus.textContent="Declining…";
  try{
    await callTool(declineTool,{offer_id:offerId,offerId:offerId});
    settled=true;
    offerClosed=true;
    stopPolling();
    vaStatus.textContent=noteOffer||declineTool==="decline_escalation"?"Not sent.":"Declined. No one was contacted.";
  }catch(error){
    vaStatus.classList.add("error");
    vaStatus.textContent=error.message||"Could not decline this offer.";
    setBusy(false);
  }
};
vaAgentForm.onsubmit=async(event)=>{
  event.preventDefault();
  if(!offerId||pendingAction)return;
  setBusy(true);
  try{
    await sendAgent(vaAgentInput.value);
  }catch(error){
    vaStatus.classList.add("error");
    vaStatus.textContent="The assistant did not reply.";
    setBusy(false);
  }
};
function acceptFailed(status,message){
  const terminal=status==="offer_expired"||status==="offer_not_active"||status==="offer_not_found";
  statusEl.classList.add("error");
  statusEl.textContent=message||status||"Could not accept this offer.";
  if(terminal){
    offerClosed=true;
    setBusy(true);
  }else{
    setBusy(false);
  }
}
onToolResult(result=>apply(result.structuredContent||result));
readHostOutput().then(apply).then(()=>{ if(!pendingAction&&!settled) setBusy(false); return resumeAcceptedOffer(); });
async function resumeAcceptedOffer(){
  if(settled||!offerId)return;
  try{
    const result=await callTool("get_invitation",{offer_id:offerId,offerId:offerId});
    if(settled)return;
    const payload=mountPayload(result&&(result.structuredContent||result));
    const conversationId=conversationIdOf(payload);
    if(conversationId&&chatStartedOf(payload)){
      mountChat(Object.assign(payload,{conversationId:conversationId,chatStarted:true}));
    }
  }catch(error){}
}
acceptEl.onclick=async()=>{
  if(!offerId||settled||pendingAction||offerClosed)return;
  if(agentOffer){
    agentChatEl.hidden=false;
    actionsEl.hidden=true;
    statusEl.textContent="";
    setBusy(false);
    agentTextEl.focus();
    fitFrame();
    return;
  }
  setBusy(true);
  statusEl.classList.remove("error");
  statusEl.textContent=noteOffer?"Sending…":"Connecting…";
  try{
    const result=await callTool(acceptTool,{offer_id:offerId,offerId:offerId});
    if(noteOffer){
      const filed=statusOf(result);
      if(filed==="pending"){
        settled=true;
        offerClosed=true;
        offerTitleEl.textContent=sentTitle||"Sent.";
        noteEl.textContent="";
        noteEl.hidden=true;
        draftEl.hidden=true;
        draftEl.classList.remove("visible");
        actionsEl.hidden=true;
        statusEl.textContent="";
        setBusy(true);
        fitFrame();
        return;
      }
      acceptFailed(filed,filed==="escalation_expired"?"This note offer has expired. Ask again if you still want to send it.":"Could not send this note.");
      return;
    }
    const conversationId=conversationIdOf(result);
    if(chatStartedOf(result)&&conversationId){
      mountChat(Object.assign(mountPayload(result),{conversationId,chatStarted:true}));
      return;
    }
    const status=statusOf(result);
    if(status==="representative_unavailable"){
      acceptFailed(status,"No representative is available right now.");
    }else if(status==="offer_expired"){
      acceptFailed(status,"This offer has expired. Ask for help again if you still want support.");
    }else if(status==="offer_not_found"||status==="offer_not_active"){
      acceptFailed(status,"This offer is no longer available.");
    }else{
      acceptFailed(status,status||"Could not accept this offer.");
    }
  }catch(error){
    acceptFailed("",error.message||"Could not accept this offer.");
  }
};
agentChatEl.onsubmit=async(event)=>{
  event.preventDefault();
  const text=agentTextEl.value.trim();
  if(!offerId||!text||pendingAction)return;
  setBusy(true);
  statusEl.classList.remove("error");
  statusEl.textContent="";
  try{
    const result=await callTool("talk_to_vendor_agent",{offerId:offerId,offer_id:offerId,text:text});
    agentTextEl.value="";
    apply(result.structuredContent||result);
  }catch(error){
    statusEl.classList.add("error");
    statusEl.textContent="The assistant did not reply.";
    setBusy(false);
  }
};
declineEl.onclick=async()=>{
  if(!offerId||settled||pendingAction||offerClosed)return;
  setBusy(true);
  statusEl.classList.remove("error");
  statusEl.textContent="Declining…";
  try{
    await callTool(declineTool,{offer_id:offerId,offerId:offerId});
    settled=true;
    offerClosed=true;
    stopPolling();
    statusEl.textContent=noteOffer||declineTool==="decline_escalation"?"Not sent.":"Declined. No one was contacted.";
  }catch(error){
    statusEl.classList.add("error");
    statusEl.textContent=error.message||"Could not decline this offer.";
    setBusy(false);
  }
};
function fitFrame(){
  if(document.body.classList.contains("sb-chat-mode")){
    requestFrame(520);
    return;
  }
  requestFrame(Math.ceil(document.documentElement.scrollHeight));
}
setBusy(false);
fitFrame();
requestAnimationFrame(fitFrame);
</script></body></html>`;
}

function chatHtml() {
  return supportAppHtml(true);
}

function intentOfferHtml() {
  return supportAppHtml(false);
}

export function previewIntentOfferHtml(payload) {
  return intentOfferHtml().replace(
    "function readHostOutput(){\n  return Promise.resolve(hostOutput()||{});\n}",
    `function readHostOutput(){return Promise.resolve(${JSON.stringify(payload ?? {})});}\n`
  );
}

function bridgeScript() {
  return `
const pending=new Map();
let nextId=1;
let toolHandler=()=>{};
let handlerReady=false;
let pendingResult=null;
function onToolResult(fn){
  toolHandler=fn;
  handlerReady=true;
  if(pendingResult){const result=pendingResult;pendingResult=null;fn(result);}
}
function deliverResult(params){
  if(!handlerReady)pendingResult=params||{};
  else toolHandler(params||{});
}
function flattenAssistance(payload){
  if(!payload||typeof payload!=="object")return payload;
  const assistance=payload.assistance;
  if(!assistance||typeof assistance!=="object")return payload;
  const person=assistance.representative&&typeof assistance.representative==="object"?assistance.representative:{};
  return Object.assign({}, payload, {
    offerId: payload.offerId||assistance.offerId||"",
    offer_id: payload.offer_id||assistance.offerId||"",
    vendorName: payload.vendorName||assistance.vendor||"",
    representativeName: payload.representativeName||person.name||"",
    representativeRole: payload.representativeRole||person.role||""
  });
}
function payloadFrom(value){
  if(!value||typeof value!=="object")return null;
  const nested=value.structuredContent||value["supportbridge/offer"];
  const payload=flattenAssistance(nested&&typeof nested==="object"?nested:value);
  if(payload.offerId||payload.offer_id||payload.escalationOfferId||payload.cardTitle||payload.vendorName||payload.representativeName||payload.chatStarted||payload.conversationId||payload.direct_answer)return payload;
  return null;
}
function hostOutput(){
  try{
    const openai=window.openai||{};
    return payloadFrom(openai.toolOutput)||payloadFrom(openai.toolResponseMetadata)||payloadFrom(openai.toolResponse)||null;
  }catch(e){return null;}
}
function readHostOutput(){
  return Promise.resolve(hostOutput()||{});
}
window.addEventListener("openai:set_globals",(event)=>{
  const globals=event&&event.detail&&event.detail.globals;
  const output=payloadFrom(globals&&globals.toolOutput)||payloadFrom(globals&&globals.toolResponseMetadata)||hostOutput();
  if(output)deliverResult({structuredContent:output});
});
window.addEventListener("message",event=>{
  const msg=event.data;
  if(!msg||msg.jsonrpc!=="2.0")return;
  if(msg.id!=null&&pending.has(msg.id)){pending.get(msg.id)(msg);pending.delete(msg.id);return;}
  if(msg.method==="ui/notifications/tool-result")deliverResult(msg.params||{});
});
let frameHeight=0;
function requestFrame(height){
  frameHeight=height;
  const size={width:480,height};
  parent.postMessage({jsonrpc:"2.0",method:"ui/notifications/size-changed",params:size},"*");
  try{
    if(window.openai&&typeof window.openai.notifyIntrinsicHeight==="function") window.openai.notifyIntrinsicHeight(height);
  }catch(e){}
}
function rpc(method,params){
  const id=nextId++;
  return new Promise(resolve=>{pending.set(id,resolve);parent.postMessage({jsonrpc:"2.0",id,method,params},"*");});
}
async function callTool(name,args){
  try{
    if(window.openai&&typeof window.openai.callTool==="function"){
      return await window.openai.callTool(name,args);
    }
  }catch(e){}
  const response=await rpc("tools/call",{name,arguments:args});
  return response.result||{};
}
rpc("ui/initialize",{protocolVersion:"2026-01-26",appCapabilities:{availableDisplayModes:["inline"]}}).then(()=>{
  parent.postMessage({jsonrpc:"2.0",method:"ui/notifications/initialized"},"*");
  if(frameHeight) requestFrame(frameHeight);
}).catch(()=>{});
`;
}
