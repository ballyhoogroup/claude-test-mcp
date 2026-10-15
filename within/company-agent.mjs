// One decision for a commercial question. MCP and a later Poppy door both read this.

export function decideCompanyQuestion(input = {}) {
  if (!input.catalog) return "unknown_intent";
  if (!input.businessIntentEnabled) return "business_intent_disabled";
  if (!input.intentEnabled) return "intent_disabled";
  if (input.live) return "conversation_active";
  if (input.openOffer) return "offer_already_open";
  if (!input.someoneOnDuty) return "note";
  if (!input.leaveUnassigned && !input.representative) return "note";
  return "invitation";
}

export function phaseOf(conversation) {
  if (!conversation) return null;
  if (conversation.phase === "working" || conversation.phase === "idle" || conversation.phase === "queued" || conversation.phase === "closed") {
    return conversation.phase;
  }
  if (conversation.status === "ended" || conversation.status === "closed") return "closed";
  if (conversation.representativeId) return "working";
  return "queued";
}

export function responderOf(conversation) {
  if (conversation?.handler === "ai" || conversation?.handler === "human") return conversation.handler;
  if (conversation?.responder === "ai" || conversation?.responder === "human") return conversation.responder;
  if (conversation?.representativeId) return "human";
  return null;
}

export function companyQuestionEvents(outcome = {}) {
  if (outcome.conversation?.id && outcome.reason === "conversation_active") {
    return [{
      type: "already_connected",
      conversation_id: outcome.conversation.id,
      status: phaseOf(outcome.conversation),
      responder: responderOf(outcome.conversation)
    }];
  }
  if (outcome.escalation?.id && outcome.escalation.status === "awaiting_consent") {
    return [{
      type: "note",
      request_id: outcome.escalation.id,
      offered_by: null,
      topic: outcome.escalation.intent ?? null,
      mode: "follow-up",
      expires_at: outcome.escalation.expiresAt ?? null
    }];
  }
  if (outcome.offer?.id && (outcome.offer.status === "presented" || outcome.offer.status === "pending")) {
    return [{
      type: "invitation",
      request_id: outcome.offer.id,
      offered_by: {
        name: outcome.offer.representativeName || null,
        role: outcome.offer.representativeRole || null
      },
      topic: outcome.offer.intent ?? null,
      mode: "live",
      expires_at: outcome.offer.expiresAt ?? null
    }];
  }
  return [];
}

export function invitationFields(event) {
  if (!event || (event.type !== "invitation" && event.type !== "note")) return null;
  return {
    request_id: event.request_id,
    offered_by: event.offered_by ?? null,
    topic: event.topic ?? null,
    mode: event.mode,
    expires_at: event.expires_at ?? null
  };
}

export function stampConversation(target, conversation) {
  if (!conversation?.id) return target;
  const phase = phaseOf(conversation);
  const responder = responderOf(conversation);
  const prior = target.conversation && typeof target.conversation === "object" ? target.conversation : {};
  return {
    ...target,
    conversation_id: conversation.id,
    responder,
    conversation: {
      ...prior,
      id: conversation.id,
      status: phase,
      responder,
      representativeName: prior.representativeName ?? conversation.representativeName ?? null,
      representativeRole: prior.representativeRole ?? conversation.representativeRole ?? null,
      vendorName: prior.vendorName ?? conversation.vendorName ?? null,
      endedAt: conversation.endedAt ?? prior.endedAt ?? null
    }
  };
}
