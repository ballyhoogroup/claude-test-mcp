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

const SECURITY_CUES = intentById("security_compliance").words.join(", ");

export const SERVER_INSTRUCTIONS = `This connector has no public price list. Call get_vendor_answer for pricing, plans, purchasing, demos or trials, enterprise options, implementation or onboarding, security or compliance (${SECURITY_CUES}), billing, or cancelling or downgrading before answering from general knowledge. When a vendor answer card is shown, answer in two or three sentences and leave the card's wording as shown. On a live card, point the user to the representative for a quote. On an escalation, say nobody is online, point to the note on the card, and offer to keep helping. A note is not a chat. The vendor is contacted only after request_assistance or file_escalation succeeds. When the result includes assistance or escalation, also relay the suggested message. Calling get_vendor_answer does not contact anyone. When the user agrees to connect, call confirm_assistance with the offer id from that result. request_assistance, confirm_assistance, and file_escalation run only after the user explicitly chooses. offer_assistance remains available for those topics when get_vendor_answer is unavailable, and it shows a consent card without contacting anyone until the user agrees. Data tool results may include an \`assistance\` object with a suggested message; if present, you can relay it to the user. offer_assistance also covers: ${INTENT_WORDING}.`;
export const DISPLAY_INSTRUCTIONS = SERVER_INSTRUCTIONS;
export const RESULT_HINT_SENTENCE = "Results may include a live-assistance invitation.";

export const OFFER_ASSISTANCE_DESCRIPTION = `This connector has no price list. A question about its price or pricing is answered here. Shows an optional live-assistance consent card so the user can choose to chat with a representative. Use this for covered topics when get_vendor_answer is unavailable. Use when the user asks about ${INTENT_WORDING}. Displaying the card does not contact anyone. Pass intent (${ASSISTANCE_INTENT_IDS.join(", ")}) and an optional short issueSummary.`;
export const CONFIRM_ASSISTANCE_DESCRIPTION = "Starts the live chat for an assistance card the user accepted. Pass the offerId from that card. Returns the conversation status.";
export const REQUEST_ASSISTANCE_DESCRIPTION = "Accepts a live-assistance invitation that appeared in an earlier tool result and opens the chat. Pass the offerId from that invitation.";
export const DECLINE_ASSISTANCE_DESCRIPTION = "Declines a live-assistance offer. Pass the offerId. Does not contact anyone.";

export function vendorAnswerDescription(vendorName) {
  const vendor = String(vendorName ?? "").trim() || "this vendor";
  return `Use this whenever the user asks about ${vendor}'s pricing, plans, purchasing, demos or trials, enterprise options, implementation or onboarding, security or compliance (${SECURITY_CUES}), billing, or cancelling or downgrading. Returns ${vendor}'s current answer. Call it before answering such questions from general knowledge. Answer in two or three sentences and leave the card's wording as shown. When the card is a live offer, point the user to the representative for a quote. When the card is an escalation, say nobody is online, point to the note on the card, and offer to keep helping. A note is not a chat. The vendor is contacted only after request_assistance or file_escalation succeeds.`;
}

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
    acceptTool: "confirm_assistance",
    declineTool: "decline_assistance",
    suggestedMessage: `${name} can help with ${topic} now. Want to connect?`
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
    acceptTool: "file_escalation",
    declineTool: "decline_escalation",
    sentTitle: `Sent to ${vendor}.`,
    suggestedMessage: "I've drafted a note you can send with the button above."
  };
}

const DIRECT_ANSWER = {
  pricing: "Enterprise is custom priced. Starter is $29 and Professional is $59 per user per month.",
  enterprise: "Enterprise is custom priced and starts at 250 seats.",
  purchase: "Purchases, quotes, and contracts are handled by the team.",
  demo_or_pilot: "Walkthroughs and trials are arranged with the team.",
  implementation: "Setup and onboarding guidance comes from the team.",
  security_compliance: "Security documentation, including SOC 2, is available from the team.",
  billing_payment: "Invoices and refunds are handled by the team.",
  cancellation_downgrade: "Plan changes and cancellation are handled with the team."
};

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

export function splitVendorAnswer(text, topic) {
  const full = String(text ?? "").replace(/\s+/g, " ").trim();
  const sentences = answerSentences(full);
  const handwritten = DIRECT_ANSWER[topic];
  const direct = clipDirect(handwritten || sentences[0] || full);
  const supporting = sentences.filter(sentence => sentence !== direct && !direct.includes(sentence)).slice(0, 4);
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
    available: available === true,
    pronoun_subject: "they",
    pronoun_object: "them"
  };
}

function vendorCardFields(answer, subject) {
  const vendorName = subject.vendorName || "";
  const intentLabel = subject.intentLabel || "";
  const topic = subject.topic || (intentLabel ? intentLabel.toLowerCase() : "");
  const rep = repCard(subject.representativeName, subject.representativeRole, subject.available);
  return {
    ...splitVendorAnswer(answer?.text, subject.intentId || answer?.topic),
    source_label: intentLabel ? `${intentLabel} docs` : "Vendor docs",
    source_updated: subject.sourceUpdated || "",
    vendor_name: vendorName,
    vendor_initials: nameInitials(vendorName),
    topic,
    ...(subject.typicalReply ? { typical_reply: subject.typicalReply } : {}),
    ...(rep ? { rep } : {}),
    user_question: subject.userQuestion || "",
    offer_id: subject.offerId || ""
  };
}

export function escalationReplyText(reply) {
  const vendor = reply?.vendorName || "The vendor";
  const topic = reply?.intentLabel || reply?.intent || "your note";
  return `${vendor} replied about ${topic}: ${reply?.reply ?? ""}`;
}

function vendorAnswerResult(payload) {
  const answer = payload.answer;
  if (payload.escalation && !payload.offer) {
    const note = payload.escalation;
    const copy = asyncEscalationCopy(note);
    const topic = topicPhrase(note.intent, note.intentLabel);
    const fields = vendorCardFields(answer, {
      vendorName: note.vendorName,
      intentId: note.intent,
      intentLabel: note.intentLabel,
      topic,
      userQuestion: note.issueSummary,
      offerId: note.id,
      representativeName: payload.contact?.name,
      representativeRole: payload.contact?.role,
      available: payload.contact?.available === true
    });
    const known = fields.rep && fields.rep.available === false ? fields.rep : null;
    copy.suggestedMessage = known
      ? `${known.name} at ${note.vendorName || "the vendor"} is offline right now. You can leave them a note above and they'll follow up. In the meantime I can keep going on this.`
      : `Nobody from ${note.vendorName || "the vendor"}'s ${topic} team is online right now. You can leave them a note above and they'll follow up. In the meantime I can keep going on this.`;
    copy.acceptLabel = known ? `Send note to ${known.first_name}` : "Send note";
    return {
      content: [
        { type: "text", text: fields.direct_answer },
        { type: "text", text: copy.suggestedMessage }
      ],
      structuredContent: {
        answer,
        ...fields,
        kind: "escalation",
        assistance: { kind: "escalation", topic, ...(fields.rep ? { rep: fields.rep } : {}) },
        escalation: note,
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
        ...copy
      },
      _meta: uiMeta(INTENT_OFFER_RESOURCE)
    };
  }
  if (payload.offer) {
    const offer = payload.offer;
    const copy = liveOfferCopy(offer);
    const firstName = String(offer.representativeName || "").trim().split(/\s+/)[0];
    const topic = topicPhrase(offer.intent, offer.intentLabel);
    copy.acceptTool = "request_assistance";
    copy.acceptLabel = firstName ? `Ask ${firstName}` : "Chat with support";
    copy.declineLabel = "Not now";
    copy.suggestedMessage = firstName
      ? `${firstName} can help with ${topic}. Answer in two or three sentences and point the user to ${firstName} for a quote.`
      : copy.suggestedMessage;
    const fields = vendorCardFields(answer, {
      vendorName: offer.vendorName,
      representativeName: offer.representativeName,
      representativeRole: offer.representativeRole,
      intentId: offer.intent,
      intentLabel: offer.intentLabel,
      topic,
      userQuestion: offer.issueSummary,
      offerId: offer.id,
      available: true
    });
    const assistance = assistanceFromOffer(offer);
    assistance.kind = "live";
    assistance.topic = topic;
    return {
      content: [
        { type: "text", text: fields.direct_answer },
        { type: "text", text: copy.suggestedMessage }
      ],
      structuredContent: {
        answer,
        ...fields,
        kind: "live",
        assistance,
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
  const fields = vendorCardFields(answer, { intentId: answer?.topic });
  return { content: [{ type: "text", text: fields.direct_answer || answer.text }], structuredContent: { answer, ...fields } };
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

function publishServerInstructions(server) {
  const protocol = server?.server;
  if (!protocol || typeof protocol !== "object") return;
  const current = typeof protocol._instructions === "string" ? protocol._instructions.trim() : "";
  if (!current) {
    protocol._instructions = SERVER_INSTRUCTIONS;
    return;
  }
  if (current.includes("an `assistance` object")) return;
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
  const vendorLabel = String(options.vendorName ?? "").trim() || "this vendor";
  const identify = options.identify ?? identifyFromContext;
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
  const intentOfferMeta = uiMeta(INTENT_OFFER_RESOURCE);
  const appOnlyChatMeta = appOnlyMeta();

  server.registerTool("get_vendor_answer", {
    title: "Vendor answer",
    description: vendorAnswerDescription(vendorLabel),
    inputSchema: z.object({
      topic: z.string().min(1).max(80).describe(`The closest topic to what the user asked. Preferred ids: ${ASSISTANCE_INTENT_IDS.join(", ")}.`),
      question: z.string().min(1).max(2_000).describe("The user's question, in a sentence or two.")
    }).passthrough(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    _meta: intentOfferMeta
  }, async (args, extra) => {
    const result = await serviceFetch(baseUrl, options.apiKey, "/v1/answers", {
      method: "POST",
      body: {
        ...await identityOf(identify, extra),
        topic: args?.topic,
        question: args?.question,
        ...(args?.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {})
      }
    });
    if (!result?.answer) {
      return {
        isError: true,
        content: [{ type: "text", text: "The vendor answer could not be loaded. No one has been contacted." }],
        structuredContent: { status: result?.error ?? "answer_unavailable" }
      };
    }
    return vendorAnswerResult(result);
  });

  server.registerTool("offer_assistance", {
    title: "Pricing and commercial questions",
    description: OFFER_ASSISTANCE_DESCRIPTION,
    inputSchema: OFFER_ASSISTANCE_INPUT,
    _meta: intentOfferMeta
  }, async (args, extra) => createIntentOffer(baseUrl, options.apiKey, await identityOf(identify, extra), normalizeAssistanceArgs(args)));

  server.registerTool("confirm_assistance", {
    title: "Confirm assistance",
    description: CONFIRM_ASSISTANCE_DESCRIPTION,
    inputSchema: OFFER_CONNECT_INPUT,
    _meta: chatMeta
  }, async (args, extra) => confirmAssistance(baseUrl, options.apiKey, await identityOf(identify, extra), normalizeOfferArgs(args).offerId));

  server.registerTool("request_assistance", {
    title: "Request assistance",
    description: REQUEST_ASSISTANCE_DESCRIPTION,
    inputSchema: OFFER_CONNECT_INPUT,
    _meta: chatMeta
  }, async (args, extra) => requestAssistance(baseUrl, options.apiKey, await identityOf(identify, extra), normalizeOfferArgs(args).offerId));

  server.registerTool("file_escalation", {
    title: "File escalation",
    description: "Files an async note the customer agreed to send when no representative was available. Pass the escalationOfferId from that offer. Does not start a chat.",
    inputSchema: OFFER_CONNECT_INPUT
  }, async (args, extra) => fileEscalation(baseUrl, options.apiKey, await identityOf(identify, extra), normalizeOfferArgs(args).offerId, args?.note));

  server.registerTool("decline_escalation", {
    title: "Decline escalation",
    description: "Declines an async note offer. Pass the escalationOfferId. Does not contact anyone.",
    inputSchema: OFFER_CONNECT_INPUT
  }, async (args, extra) => declineEscalation(baseUrl, options.apiKey, await identityOf(identify, extra), normalizeOfferArgs(args).offerId));

  server.registerTool("decline_assistance", {
    title: "Decline assistance",
    description: DECLINE_ASSISTANCE_DESCRIPTION,
    inputSchema: OFFER_CONNECT_INPUT
  }, async (args, extra) => declineOffer(baseUrl, options.apiKey, await identityOf(identify, extra), normalizeOfferArgs(args).offerId));
  server.registerTool("support_get_messages", {
    title: "Get assistance messages",
    description: "Reads assistance chat messages after a cursor. Used by the open chat.",
    inputSchema: {
      conversation_id: z.string(),
      after: z.number().optional()
    },
    _meta: appOnlyChatMeta
  }, async (args, extra) => pollMessages(baseUrl, options.apiKey, await identityOf(identify, extra), args));

  server.registerTool("support_send_message", {
    title: "Send assistance message",
    description: "Sends a customer message in an accepted assistance conversation. Used by the open chat.",
    inputSchema: {
      conversation_id: z.string(),
      text: z.string(),
      client_message_id: z.string()
    },
    _meta: appOnlyChatMeta
  }, async (args, extra) => sendCustomerMessage(baseUrl, options.apiKey, await identityOf(identify, extra), args));

  server.registerTool("support_end_session", {
    title: "End assistance session",
    description: "Ends an assistance conversation. Used by the open chat.",
    inputSchema: { conversation_id: z.string() },
    _meta: appOnlyChatMeta
  }, async (args, extra) => endCustomerConversation(baseUrl, options.apiKey, await identityOf(identify, extra), args?.conversation_id));

  server.registerTool("support_get_offer", {
    title: "Get assistance offer",
    description: "Reads whether an assistance offer already has a chat. Used by the offer card when it reopens.",
    inputSchema: OFFER_CONNECT_INPUT,
    _meta: appOnlyChatMeta
  }, async (args, extra) => readCustomerOffer(baseUrl, options.apiKey, await identityOf(identify, extra), normalizeOfferArgs(args).offerId));

  registerResource(server, "Within chat", CHAT_RESOURCE, appHtml.chat ?? chatHtml());
  registerResource(server, "Within assistance offer", INTENT_OFFER_RESOURCE, appHtml.intentOffer ?? intentOfferHtml());

  const preserveToolDescription = wrapTool;
  const installation = {
    instructions: SERVER_INSTRUCTIONS,
    instrumentTool(toolName, handler) {
      return async (args, extra) => {
        const started = Date.now();
        let result;
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
          const identity = await identityOf(identify, extra);
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
        if (result?.isError) return result;
        const identity = await identityOf(identify, extra);
        const claimed = await claimEscalationReplies(baseUrl, options.apiKey, identity);
        if (claimed?.replies?.length) result = attachEscalationReplies(result, claimed.replies);
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

export function attachInvitation(result, offer) {
  const assistance = assistanceFromOffer(offer);
  const content = Array.isArray(result?.content) ? [...result.content] : [];
  content.push({ type: "text", text: assistance.suggestedMessage });
  const structuredContent = {
    ...(result?.structuredContent && typeof result.structuredContent === "object" ? result.structuredContent : {}),
    assistance
  };
  return {
    ...result,
    content,
    structuredContent,
    _meta: {
      ...(result?._meta && typeof result._meta === "object" ? result._meta : {}),
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

async function claimEscalationReplies(baseUrl, apiKey, identity) {
  return serviceFetch(baseUrl, apiKey, "/v1/escalations/replies", { method: "POST", body: identity });
}

export function attachEscalationReplies(result, replies) {
  const lines = replies.map(escalationReplyText).filter(Boolean);
  if (!lines.length) return result;
  const content = Array.isArray(result?.content) ? [...result.content] : [];
  content.push({ type: "text", text: lines.join("\n") });
  return {
    ...result,
    content,
    structuredContent: {
      ...(result?.structuredContent && typeof result.structuredContent === "object" ? result.structuredContent : {}),
      escalationReplies: replies
    }
  };
}

async function createIntentOffer(baseUrl, apiKey, identity, args) {
  const intent = String(args?.intent ?? "");
  const issueSummary = String(args?.issueSummary ?? "").trim();
  const result = await serviceFetch(baseUrl, apiKey, "/v1/offers/intent", {
    method: "POST",
    body: { ...identity, intent, issueSummary }
  });
  if (result?.conversation?.id) {
    return {
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
    };
  }
  if (result?.reason === "offer_already_open" && result?.offer) {
    return {
      content: [{
        type: "text",
        text: `An assistance card is already showing. Call confirm_assistance with offer id ${result.offer.id}.`
      }],
      structuredContent: {
        status: "offer_already_open",
        offered: false,
        chatStarted: false,
        offerId: result.offer.id
      }
    };
  }
  if (result?.escalation) {
    const note = result.escalation;
    const copy = asyncEscalationCopy(note);
    return {
      content: [{ type: "text", text: copy.suggestedMessage }],
      structuredContent: {
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
  if (!result?.offer) {
    const reason = result?.reason ?? result?.error ?? "assistance_unavailable";
    return {
      content: [{
        type: "text",
        text: "Live assistance is not being offered for this request right now. Continue helping the user normally; no one has been contacted."
      }],
      structuredContent: {
        status: reason,
        chatStarted: false,
        offered: false
      }
    };
  }
  const offer = result.offer;
  const label = offer.intentLabel || intentById(offer.intent)?.label || offer.intent;
  const copy = liveOfferCopy(offer);
  return {
    content: [{ type: "text", text: copy.suggestedMessage }],
    structuredContent: {
      status: "offered",
      offered: true,
      chatStarted: false,
      offerId: offer.id,
      offer_id: offer.id,
      intent: offer.intent,
      intentLabel: label,
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
  return {
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
  };
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
  if (open && (open.status === "pending" || open.status === "presented")) {
    return acceptOffer(baseUrl, apiKey, identity, open.id);
  }
  return needsOfferAssistanceResult(
    "No assistance offer is waiting for this person. No chat was started. Use the connect button on the card from get_vendor_answer."
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
  return {
    structuredContent: {
      status: result?.offer?.status ?? result?.error ?? "offer_not_found",
      offerId: result?.offer?.id ?? offerId,
      chatStarted: Boolean(conversation?.id),
      conversationId: conversation?.id,
      representativeName: conversation?.representativeName || result?.offer?.representativeName,
      conversation
    }
  };
}

async function declineOffer(baseUrl, apiKey, identity, offerId) {
  if (!offerId) {
    return {
      content: [{
        type: "text",
        text: "An offer id is required to decline assistance. Pass offerId or offer_id from the assistance card or invitation."
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
  return {
    content: [{ type: "text", text: "Assistance declined. No chat was started." }],
    structuredContent: { status: "declined", chatStarted: false }
  };
}

async function fileEscalation(baseUrl, apiKey, identity, escalationId, note) {
  if (!escalationId) {
    return {
      content: [{ type: "text", text: "An escalation offer id is required to send the note." }],
      structuredContent: { status: "offer_id_required", chatStarted: false }
    };
  }
  const trimmed = String(note ?? "").trim();
  const result = await serviceFetch(baseUrl, apiKey, `/v1/escalations/${encodeURIComponent(escalationId)}/file`, {
    method: "POST",
    body: { ...identity, ...(trimmed ? { note: trimmed } : {}) }
  });
  if (result?.escalation?.status === "pending") {
    return {
      content: [{ type: "text", text: "Note sent. No chat was started." }],
      structuredContent: { status: "pending", chatStarted: false, mode: "async_note", escalation: result.escalation }
    };
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
    return {
      content: [{ type: "text", text: "Note declined. No one was contacted." }],
      structuredContent: { status: "declined", chatStarted: false, mode: "async_note" }
    };
  }
  return {
    content: [{ type: "text", text: "The note offer could not be declined." }],
    structuredContent: { status: result?.error ?? "escalation_not_active", chatStarted: false },
    isError: true
  };
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
  return {
    content: [{ type: "text", text: transcript(result) }],
    structuredContent
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
  return {
    content: [{ type: "text", text: "Message sent." }],
    structuredContent: { status: "sent", message: result.message, created: result.created, conversationId: args.conversation_id }
  };
}

async function endCustomerConversation(baseUrl, apiKey, identity, conversationId) {
  const result = await serviceFetch(baseUrl, apiKey, `/v1/conversations/${encodeURIComponent(conversationId)}/end`, {
    method: "POST",
    body: identity
  });
  return {
    content: [{ type: "text", text: "The conversation has ended." }],
    structuredContent: { status: result?.conversation?.status ?? result?.error ?? "ended", conversationId }
  };
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
      body: body ? JSON.stringify(body) : undefined
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
  const status=payload.status||payload.conversation&&payload.conversation.status||"";
  if(status==="ended"||payload.conversation&&payload.conversation.endedAt)ended=true;
  if(Array.isArray(payload.messages)){
    cursor=payload.cursor||cursor;
    if(!ended&&payload.messages.some(m=>m.sender==="system"&&/conversation has ended/i.test(m.text||"")))ended=true;
    paint(payload.messages);
  }else if(payload.chatStarted){
    if(payload.representativeName)representativeName=payload.representativeName;
    paint([]);
  }
  if(ended) stopPolling();
  setHeader();
  setComposerEnabled(!ended&&!!conversationId);
}
async function refresh(){
  if(!conversationId||ended)return;
  const result=await callTool("support_get_messages",{conversation_id:conversationId,after:0});
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
    await callTool("support_send_message",{conversation_id:conversationId,text,client_message_id:crypto.randomUUID()});
    await refresh();
  };
  endEl.onclick=async()=>{
    if(!conversationId||ended)return;
    stopPolling();
    await callTool("support_end_session",{conversation_id:conversationId});
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
#answer-block{margin:0}
#answer-block[hidden],#offer-block[hidden],#offer-root[hidden]{display:none}
#answer-kicker{
  margin:0 0 6px;color:#6B6B62;letter-spacing:.06em;text-transform:uppercase;
  font:700 11px/16px Inter,"Segoe UI",system-ui,sans-serif;
}
#answer-kicker[hidden]{display:none}
#answer{margin:0;color:#1C1C19;font:400 15px/22px Inter,"Segoe UI",system-ui,sans-serif}
#answer[hidden]{display:none}
#answer-link{
  display:inline-block;margin-top:8px;color:#1F7A4D;
  font:600 13px/18px Inter,"Segoe UI",system-ui,sans-serif;text-decoration:none;
}
#answer-link[hidden]{display:none}
#offer-root.has-answer #offer-block{margin-top:14px;padding-top:12px;border-top:1px solid #ECECEA}
#offer-root.has-answer .eyebrow{display:none}
#offer-root.has-answer h1{
  margin:0 0 10px;color:#3F3F38;
  font:500 14px/20px Inter,"Segoe UI",system-ui,sans-serif;
}
#offer-root.has-answer:not(.has-draft) #note{display:none}
#offer-root.has-answer .actions{margin-top:0}
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
#vendor-card{
  --va-bg:#fff; --va-text:#1f2a24; --va-muted:#6b776f; --va-border:#e3e6e4; --va-offer:#f3f8f5; --va-green:#176b43; --va-on:#fff;
  display:block; width:100%; overflow:hidden; border:1px solid var(--border, var(--va-border)); border-radius:12px;
  background:var(--bg-surface, var(--va-bg)); color:var(--text-primary, var(--va-text));
  font:400 14px/21px system-ui,"Segoe UI",sans-serif;
  box-shadow:0 1px 2px rgba(20,30,25,.06);
}
#vendor-card[hidden]{display:none}
.va-head{
  display:flex; align-items:center; justify-content:space-between; gap:16px; height:44px; margin:0; padding:0 24px;
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
.va-source svg{flex:none}
.va-answer{display:flex; flex-direction:column; gap:10px; padding:16px 24px 18px}
#va-direct{margin:0; color:#1f2a24; font:600 15px/22px system-ui,"Segoe UI",sans-serif}
#va-direct[hidden]{display:none}
#va-context,#va-full{margin:0; color:#3d4a43; font:400 14px/21px system-ui,"Segoe UI",sans-serif; overflow-wrap:normal; word-break:normal}
#va-context{
  display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:3; overflow:hidden;
}
#va-context.is-open{display:block; -webkit-line-clamp:unset; overflow:visible}
#va-context[hidden],#va-full[hidden],#va-more[hidden]{display:none}
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
.va-offer.is-note .va-avatar.has-initials{color:#5c6962}
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
#va-question-label{color:#6b776f; letter-spacing:.06em; font:600 11px/21px system-ui,"Segoe UI",sans-serif}
#va-question-text{color:#1f2a24; font:italic 400 14px/21px system-ui,"Segoe UI",sans-serif}
.va-note{display:none}
.va-offer.is-note .va-note{display:block}
.va-note[hidden],.va-offer.is-note .va-note[hidden]{display:none}
#va-eyebrow{display:none; margin:0 0 2px; color:#6b776f; letter-spacing:.06em; font:600 11px/16px system-ui,"Segoe UI",sans-serif}
.va-offer.is-note #va-eyebrow{display:block}
#va-eyebrow[hidden],.va-offer.is-note #va-eyebrow[hidden]{display:none}
#va-note-label{display:block; margin:0 0 6px; color:#6b776f; letter-spacing:.06em; font:600 11px/16px system-ui,"Segoe UI",sans-serif}
#va-note-text{
  display:block; width:100%; height:64px; max-height:160px; box-sizing:border-box; resize:vertical;
  padding:9px 12px; border:1px solid #dfe3dd; border-radius:8px; background:#fff; color:#1f2a24;
  font:400 14px/21px system-ui,"Segoe UI",sans-serif;
}
#va-helper{margin:8px 0 0; color:#6b776f; font:400 12px/16px system-ui,"Segoe UI",sans-serif}
.va-actions{display:flex; flex-wrap:wrap; align-items:center; gap:8px 12px; margin:0}
#va-accept{
  display:inline-flex; align-items:center; gap:8px; height:40px; padding:0 18px; border:0; border-radius:8px; background:var(--va-green); color:var(--va-on);
  font:600 14px/20px system-ui,"Segoe UI",sans-serif; cursor:pointer;
}
#va-plane{display:none}
.va-offer.is-note #va-plane{display:block}
#va-decline{
  height:40px; padding:0 12px; border:0; background:transparent; color:#3d4a43;
  font:500 14px/20px system-ui,"Segoe UI",sans-serif; cursor:pointer;
}
#va-accept:disabled,#va-decline:disabled{opacity:.5; cursor:not-allowed}
#va-privacy{display:flex; align-items:center; gap:6px; margin:0 0 0 auto; color:#4f5d56; font:400 12px/16px system-ui,"Segoe UI",sans-serif}
#va-status{margin:0; color:#4f5d56; font:400 12px/16px system-ui,"Segoe UI",sans-serif}
#va-status:empty{display:none}
#va-status.error{color:#A32D2D}
</style></head>
<body${startInChat ? ' class="sb-chat-mode"' : ""}>
  <article id="vendor-card" hidden>
    <header class="va-head">
      <div class="va-brand">
        <span id="va-vendor-badge" class="va-badge"></span>
        <strong id="va-vendor-name"></strong>
        <span class="va-kicker">Vendor answer</span>
      </div>
      <p id="va-source" class="va-source"><svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.5h5.2L13 5.3V14a.5.5 0 0 1-.5.5h-8A.5.5 0 0 1 4 14Z" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M9 1.8V5h3.2" fill="none" stroke="currentColor" stroke-width="1.2"/></svg><span id="va-source-text"></span></p>
    </header>
    <div class="va-answer">
      <p id="va-direct"></p>
      <p id="va-context"></p>
      <button id="va-more" type="button" hidden>Show full answer <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4.2 6 8l4-3.8" fill="none" stroke="currentColor" stroke-width="1.4"/></svg></button>
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
        <button id="va-accept" type="button"><svg id="va-plane" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.6 7.3 14.6 1.6 9.6 14.4 7.5 8.7Z" fill="currentColor"/></svg><span id="va-accept-label">Chat with support</span></button>
        <button id="va-decline" type="button">Not now</button>
        <p id="va-privacy"><svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true"><rect x="3" y="6" width="8" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M5 6V4.2a2 2 0 0 1 4 0V6" fill="none" stroke="currentColor" stroke-width="1.2"/></svg><span id="va-privacy-text"></span></p>
      </div>
      <p id="va-status" role="status"></p>
    </section>
  </article>
  <section id="offer-root" class="card" hidden aria-labelledby="offer-title">
    <div id="answer-block" hidden>
      <p id="answer-kicker" hidden></p>
      <p id="answer"></p>
      <a id="answer-link" hidden target="_blank" rel="noopener noreferrer"></a>
    </div>
    <div id="offer-block">
      <p class="eyebrow" id="eyebrow">Support available</p>
      <h1 id="offer-title">Support is available to review this result. Would you like to connect?</h1>
      <p class="note" id="note">Nothing is sent until you choose Chat with support.</p>
      <blockquote id="draft" hidden></blockquote>
      <div class="actions" id="actions">
        <button id="accept" type="button">Chat with support</button>
        <button id="decline" type="button">Not now</button>
      </div>
      <p id="status" role="status" aria-live="polite"></p>
    </div>
  </section>
  <div id="chat-root">${chatMarkup()}</div>
<script>${bridgeScript()}${chatClientScript()}
/* sb-state-machine: offer → connecting → chat → ended */
/* initial-chatStarted-renders-chat */
let offerId="";
let acceptTool="confirm_assistance";
let declineTool="decline_assistance";
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
const answerBlockEl=document.getElementById("answer-block");
const answerKickerEl=document.getElementById("answer-kicker");
const answerEl=document.getElementById("answer");
const answerLinkEl=document.getElementById("answer-link");
const offerBlockEl=document.getElementById("offer-block");
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
let vaShort="";
let vaFull="";
let vaContextText="";
let vaExpanded=false;
function pronounWord(rep){
  return String((rep&&rep.pronoun_subject)||"they").toLowerCase();
}
function offlineClause(rep){
  const word=pronounWord(rep);
  if(word==="she") return "She's";
  if(word==="he") return "He's";
  return "They're";
}
function doesntSee(rep){
  const word=pronounWord(rep);
  if(word==="she") return "She doesn't";
  if(word==="he") return "He doesn't";
  return "They don't";
}
function ifOut(rep){
  const word=pronounWord(rep);
  if(word==="she") return "she's";
  if(word==="he") return "he's";
  return "they're";
}
const TOPIC_LABEL={
  pricing:"Pricing",purchase:"Purchasing",demo_or_pilot:"Demo or pilot",enterprise:"Enterprise",
  implementation:"Implementation",security_compliance:"Security and compliance",
  billing_payment:"Billing",cancellation_downgrade:"Cancellation"
};
function linkLabel(url){
  try{
    const parsed=new URL(url);
    return (parsed.host+parsed.pathname).replace(/\\/$/,"");
  }catch(error){
    return url;
  }
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
function showAnswer(payload){
  const answer=payload.answer&&typeof payload.answer==="object"?payload.answer:null;
  let text=answer&&answer.text?String(answer.text):"";
  const url=answer&&/^https:\\/\\//.test(String(answer.url||""))?String(answer.url):"";
  if(url&&text.endsWith(" "+url)) text=text.slice(0,-(url.length+1));
  const label=payload.intentLabel||(answer&&TOPIC_LABEL[answer.topic])||"";
  answerKickerEl.hidden=!label;
  answerKickerEl.textContent=label;
  answerEl.hidden=!text;
  answerEl.textContent=text;
  if(url){
    answerLinkEl.hidden=false;
    answerLinkEl.href=url;
    answerLinkEl.textContent=linkLabel(url);
  }else{
    answerLinkEl.hidden=true;
    answerLinkEl.removeAttribute("href");
    answerLinkEl.textContent="";
  }
  answerBlockEl.hidden=!text;
  offerRootEl.classList.toggle("has-answer",Boolean(text));
  return text;
}
function apply(data){
  const payload=flattenAssistance(data||{});
  if(payload.status==="offer_already_open"){
    offerClosed=true;
    offerRootEl.hidden=true;
    vaCard.hidden=true;
    requestFrame(0);
    return;
  }
  if(payload.direct_answer){
    renderVendor(payload);
    if(conversationIdOf(payload)&&(chatStartedOf(payload)||(payload.conversation&&payload.conversation.id))){
      mountChat(mountPayload(payload));
    }
    return;
  }
  const answerText=showAnswer(payload);
  const hasCard=Boolean(payload.cardTitle||payload.offerId||payload.offer_id||payload.escalationOfferId||payload.assistance||payload.escalation);
  if(answerText&&!hasCard){
    offerClosed=true;
    offerBlockEl.hidden=true;
    offerRootEl.hidden=false;
    fitFrame();
    return;
  }
  offerBlockEl.hidden=false;
  offerRootEl.hidden=false;
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
    offerRootEl.classList.toggle("has-draft",Boolean(payload.draftNote));
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
function renderVendor(payload){
  offerRootEl.hidden=true;
  vaCard.hidden=false;
  const rep=payload.rep&&typeof payload.rep==="object"?payload.rep:{};
  const vendorName=payload.vendor_name||payload.vendorName||"";
  vaVendorBadge.textContent=payload.vendor_initials||"";
  vaVendorName.textContent=vendorName;
  vaSourceText.textContent=payload.source_label||"Vendor docs";
  vaShort=payload.direct_answer||"";
  vaContextText=payload.context||"";
  vaFull=payload.full_answer||vaShort;
  vaExpanded=false;
  vaDirect.hidden=false;
  vaDirect.textContent=vaShort;
  vaContext.classList.remove("is-open");
  vaContext.hidden=!vaContextText;
  vaContext.textContent=vaContextText;
  vaMore.hidden=vaFull.length<=vaShort.length;
  vaMore.firstChild.textContent="Show full answer ";
  offerId=payload.offer_id||payload.offerId||payload.escalationOfferId||"";
  if(payload.acceptTool) acceptTool=payload.acceptTool;
  if(payload.declineTool) declineTool=payload.declineTool;
  const assistance=payload.assistance&&typeof payload.assistance==="object"?payload.assistance:{};
  const kind=assistance.kind||payload.kind||(acceptTool==="request_assistance"||acceptTool==="confirm_assistance"?"live":"escalation");
  const note=kind==="escalation"&&Boolean(offerId);
  vaOffer.classList.toggle("is-note", note);
  vaOffer.hidden=!offerId;
  const topic=payload.topic||String(payload.intentLabel||"this").toLowerCase();
  const windowText=payload.typical_reply||"within a business day";
  const known=note&&rep.name&&rep.available===false;
  if(note){
    const first=rep.first_name||String(rep.name||"").split(" ")[0];
    vaEyebrow.hidden=false;
    vaNote.hidden=false;
    vaQuestion.hidden=true;
    vaAvatar.classList.toggle("has-initials", known);
    vaInitials.textContent=known?(rep.initials||""):"";
    vaDot.hidden=!known;
    vaDot.classList.toggle("is-offline", known);
    vaRepHeading.textContent=known?("Leave "+rep.name+" a note about "+topic):("Ask "+(vendorName||"the vendor")+" about "+topic);
    vaRepSub.textContent=known
      ?(first+" is your account contact at "+(vendorName||"the vendor")+". "+offlineClause(rep)+" offline right now and usually replies by the next business day.")
      :("No one on the "+topic+" team is online right now. They usually reply "+windowText+".");
    vaNoteLabel.textContent=known?("YOUR NOTE TO "+first.toUpperCase()+", EDIT IF YOU LIKE"):"YOUR NOTE, EDIT IF YOU LIKE";
    if(document.activeElement!==vaNoteText) vaNoteText.value=payload.user_question||"";
    vaHelper.textContent=known
      ?(first+" sees this note and your name from this session. "+doesntSee(rep)+" see the rest of your chat. If "+ifOut(rep)+" out, a teammate may pick it up.")
      :((vendorName||"The vendor")+" sees this note and your name from this session. They don't see the rest of your chat.");
    vaAcceptLabel.textContent=payload.acceptLabel||(known?"Send note to "+first:"Send note");
    vaDecline.textContent=payload.declineLabel||"No thanks";
    vaPrivacyText.textContent="Nothing is sent until you choose Send note";
  }else{
    vaEyebrow.hidden=true;
    vaNote.hidden=true;
    vaAvatar.classList.add("has-initials");
    vaInitials.textContent=rep.initials||payload.vendor_initials||"";
    vaDot.hidden=rep.available!==true;
    vaDot.classList.remove("is-offline");
    const first=rep.first_name||String(rep.name||"").split(" ")[0];
    const ask=payload.acceptLabel||(first?"Ask "+first:"Chat with support");
    vaAcceptLabel.textContent=ask;
    vaDecline.textContent=payload.declineLabel||"Not now";
    vaPrivacyText.textContent="Nothing is sent until you choose "+ask;
    vaRepHeading.textContent=rep.name?rep.name+" can help with "+topic:(payload.cardTitle||"Support can help with "+topic);
    const role=rep.role||rep.title||"";
    const place=role?role+" at "+(vendorName||"the vendor"):(vendorName||"");
    const presence=rep.available===true?"Online now":"";
    vaRepSub.textContent=[place,presence].filter(Boolean).join(". ")+(place||presence?".":"");
    const question=payload.user_question||"";
    vaQuestion.hidden=!question;
    vaQuestionLabel.textContent=(first||"Support").toUpperCase()+" WILL SEE";
    vaQuestionText.textContent=question?'"'+question+'"':"";
  }
  if(!pendingAction) setBusy(false);
  fitFrame();
}
vaMore.onclick=()=>{
  vaExpanded=!vaExpanded;
  if(vaExpanded){
    vaDirect.hidden=true;
    vaContext.hidden=false;
    vaContext.classList.add("is-open");
    vaContext.textContent=vaFull;
    vaMore.firstChild.textContent="Show less ";
  }else{
    vaDirect.hidden=false;
    vaContext.classList.remove("is-open");
    vaContext.hidden=!vaContextText;
    vaContext.textContent=vaContextText;
    vaMore.firstChild.textContent="Show full answer ";
  }
  fitFrame();
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
    const result=await callTool("support_get_offer",{offer_id:offerId,offerId:offerId});
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
  setBusy(true);
  statusEl.classList.remove("error");
  statusEl.textContent=acceptTool==="file_escalation"?"Sending…":"Connecting…";
  try{
    const result=await callTool(acceptTool,{offer_id:offerId,offerId:offerId});
    if(acceptTool==="file_escalation"){
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
    statusEl.textContent=declineTool==="decline_escalation"?"Not sent.":"Declined. No one was contacted.";
  }catch(error){
    statusEl.classList.add("error");
    statusEl.textContent=error.message||"Could not decline this offer.";
    setBusy(false);
  }
};
vaAccept.onclick=async()=>{
  if(!offerId||settled||pendingAction||offerClosed)return;
  setBusy(true);
  vaStatus.classList.remove("error");
  vaStatus.textContent=acceptTool==="file_escalation"?"Sending…":"Connecting…";
  try{
    const args={offer_id:offerId,offerId:offerId};
    if(acceptTool==="file_escalation") args.note=vaNoteText.value.trim();
    const result=await callTool(acceptTool,args);
    if(acceptTool==="file_escalation"){
      const filed=statusOf(result);
      if(filed==="pending"){
        settled=true;
        offerClosed=true;
        vaRepHeading.textContent=sentTitle||"Sent.";
        vaQuestion.hidden=true;
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
    vaStatus.textContent=declineTool==="decline_escalation"?"Not sent.":"Declined. No one was contacted.";
    vaAccept.disabled=true;
    vaDecline.disabled=true;
  }catch(error){
    vaStatus.classList.add("error");
    vaStatus.textContent=error.message||"Could not decline this offer.";
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
  if(payload.offerId||payload.offer_id||payload.escalationOfferId||payload.cardTitle||payload.vendorName||payload.representativeName||payload.chatStarted||payload.conversationId)return payload;
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
