interface AssistanceIntent {
    id: string;
    label: string;
    description: string;
    words: string[];
}
declare const STANDARD_ASSISTANCE_INTENTS: readonly AssistanceIntent[];
declare const ASSISTANCE_INTENT_IDS: string[];
declare const normalizeAssistanceArgs: (args?: Record<string, unknown>) => {
    intent: string;
    issueSummary: string;
};
declare const normalizeOfferArgs: (args?: Record<string, unknown>) => {
    offerId: string;
};

declare const SDK_VERSION = "0.5.0";
declare const CHAT_RESOURCE = "ui://supportbridge/chat";
declare const INTENT_OFFER_RESOURCE = "ui://supportbridge/intent-offer";
declare const APP_MIME = "text/html;profile=mcp-app";
declare const SERVER_INSTRUCTIONS: string;
declare const DISPLAY_INSTRUCTIONS: string;
declare const RESULT_HINT_SENTENCE = "Pricing and commercial questions are answered by get_vendor_answer.";
declare function vendorAnswerDescription(vendorName?: unknown): string;
declare const CONFIRM_ASSISTANCE_DESCRIPTION = "Opens the live chat only after the customer chooses a live person. Pass the offer id. With no offer id, accepts the pending manual offer for this session.";
declare const DECLINE_ASSISTANCE_DESCRIPTION = "The follow-up for every choice that is not opening a live chat. Actions: decline, assistant, file_note, get_messages, send_message, end, and get_offer. Message actions get_messages, send_message, and end are for the open chat. send_message requires client_message_id, a unique id for that message, reused on a retry. Speak to Assistant is action assistant. Send note is action file_note. A no is action decline. A note is not a chat. The vendor is contacted only after confirm_assistance or file_note succeeds.";

/**
 * A vendor tool handler. Parameters are `never` so any handler shape is accepted
 * (the legacy declaration used `any`); the SDK forwards whatever the host sent.
 */
type ToolHandler = (args: never, extra?: never) => unknown;
/**
 * The server `install` patches. The SDK supplies every handler and read callback it passes,
 * so those parameters are typed `never`: any vendor signature for them is accepted, as the
 * legacy `any` declaration allowed, without `any`.
 */
interface VendorMcpServer {
    registerTool?(name: string, config: object | undefined, handler: never): unknown;
    registerResource?(name: string, uri: string, metadata: object | undefined, read: never): unknown;
}
interface ClaimMap {
    email?: string;
    name?: string;
    preferred_username?: string;
    email_verified?: string;
    emailVerified?: string;
}
interface McpToolContext {
    sessionId?: string;
    authInfo?: {
        extra?: Record<string, unknown>;
        payload?: Record<string, unknown>;
        [key: string]: unknown;
    };
    _meta?: {
        sessionId?: string;
        'openai/subject'?: string;
        'openai/user'?: {
            id?: string;
            name?: string;
        };
        [key: string]: unknown;
    };
    [key: string]: unknown;
}
/** Fields returned by identify. identityOf later renames userId and sessionId for the service. */
interface CustomerIdentity {
    userId: string;
    authUserId: string;
    /**
     * Not legacy: the `iss` claim that came with authUserId. A person is one subject at one issuer.
     * Optional, so a vendor's own reader written against the legacy shape still type-checks.
     */
    authIssuer?: string;
    sessionId: string;
    displayName: string;
}
/**
 * What a custom `identify` returns. `customerUserId` and `customerSessionId` are accepted
 * aliases of `userId` and `sessionId`, kept for vendors that return the service's field
 * names. When both are set, `userId` and `sessionId` win.
 */
interface IdentifyResult extends Partial<CustomerIdentity> {
    /** Alias of `userId`. */
    customerUserId?: string;
    /** Alias of `sessionId`. */
    customerSessionId?: string;
}
interface IdentifyOptions {
    identityClaimNamespace?: string | readonly string[];
    claimMap?: ClaimMap;
}
/** Not legacy: login providers the SDK can ask for a customer's name and email. */
type IdentityProvider = 'auth0' | 'workos' | 'clerk';
/**
 * Not legacy (WITHIN_CONTEXT.md section 4): the vendor's login provider. When a customer's token
 * carries only a user id, the SDK asks this provider's userinfo endpoint, with that token, for
 * their name and email. `issuer` is the provider's issuer exactly as tokens carry it in `iss`
 * (Auth0: `https://<tenant>/`; WorkOS AuthKit: `https://<subdomain>.authkit.app`; Clerk:
 * `https://<frontend-api>`). Requests go only there.
 */
interface IdentityConfig {
    provider: IdentityProvider;
    issuer: string;
}
interface InstallOptions {
    apiKey: string;
    baseUrl?: string;
    source?: string;
    vendorName?: string;
    privacy?: {
        captureArguments?: boolean;
    };
    identify?: (context: McpToolContext) => IdentifyResult | Promise<IdentifyResult | undefined> | undefined;
    /**
     * Register open_hub and the hub resource. Off by default, so a connector keeps today's tools.
     * The vendor's hubsEnabled switch still decides whether a call returns a hub.
     */
    hubs?: boolean;
    appHtml?: {
        chat?: string;
        intentOffer?: string;
        hub?: string;
    };
    identityClaimNamespace?: string | readonly string[];
    claimMap?: ClaimMap;
    identity?: IdentityConfig;
}
interface VendorTool {
    name?: string;
    title?: string;
    description?: string;
    inputSchema?: unknown;
    handler?: ToolHandler;
}
interface WrapToolOptions {
    appendResultHint?: boolean;
}
/** Handler installed by instrumentTool. Calls record activity. */
type InstrumentedHandler = (args: unknown, extra?: unknown) => Promise<unknown>;
interface InstrumentedTool {
    name?: string;
    title?: string;
    description?: string;
    inputSchema?: unknown;
    handler: InstrumentedHandler;
}
interface AccountLimitInput {
    name: string;
    used: number;
    limit: number;
}
interface SupportBridgeInstallation {
    instructions: string;
    instrumentTool(toolName: string, handler: ToolHandler): InstrumentedHandler;
    /** Copy the tool and wrap its handler with instrumentTool. */
    wrapTool(tool: VendorTool, options?: WrapToolOptions): InstrumentedTool;
    /**
     * Supply this company's limits for the hub account screen.
     * Pass a domain or a customer email. An empty list clears them.
     * Omitting the call leaves the limits row off. These are not tool counts.
     */
    setAccountLimits(input: {
        domain?: string;
        customerUserId?: string;
        limits: AccountLimitInput[];
    }): Promise<{
        status?: unknown;
    }>;
}
type Dict = Record<string, unknown>;
interface ContentPart {
    type: string;
    text?: string;
    [key: string]: unknown;
}
interface ToolResult {
    content?: ContentPart[];
    structuredContent?: Dict;
    _meta?: Dict;
    isError?: boolean;
    [key: string]: unknown;
}
interface Offer {
    id?: string;
    status?: string;
    source?: string;
    intent?: string;
    intentLabel?: string;
    issueSummary?: string;
    vendorName?: string;
    representativeName?: string;
    representativeRole?: string;
    expiresAt?: string;
    answer?: string;
    /** How closely the question matched the rule that answered: low or confident (Peter, 2026-10-30). */
    match?: string;
    [key: string]: unknown;
}
interface Escalation {
    id?: string;
    status?: string;
    intent?: string;
    intentLabel?: string;
    issueSummary?: string;
    vendorName?: string;
    expiresAt?: string;
    answer?: string;
    match?: string;
    [key: string]: unknown;
}
interface Conversation {
    id?: string;
    status?: string;
    offerId?: string;
    representativeName?: string;
    representativeRole?: string;
    vendorName?: string;
    [key: string]: unknown;
}
interface Representative {
    name?: string;
    role?: string;
    available?: boolean;
}
interface Answer {
    text?: string;
    facts?: unknown;
    [key: string]: unknown;
}
/** A service response, or the `{ error, status }` serviceFetch builds for a non-2xx reply. */
interface ServicePayload {
    error?: string;
    status?: unknown;
    answer?: Answer | string;
    offer?: Offer;
    escalation?: Escalation;
    conversation?: Conversation;
    availableRep?: Representative;
    contact?: Representative;
    consentNonce?: unknown;
    followUp?: unknown;
    newlyPresented?: boolean;
    /** low: the answer is framed and card titles say "this" instead of the topic. */
    match?: string;
    reply?: string;
    message?: unknown;
    messages?: unknown;
    created?: unknown;
    cursor?: unknown;
    [key: string]: unknown;
}

/** Read the signed-in person from an MCP tool context. A missing name stays unset.
 * Identity comes only from claims the host already placed on authInfo, plus
 * _meta["openai/user"] and sessionId. Tool arguments, the bearer token, and
 * userinfo are not read.
 */
declare function identifyFromContext(context: McpToolContext, options?: IdentifyOptions): CustomerIdentity;

/** Copy a vendor tool without rewriting its description. Result interception stays on the installed wrapper. */
declare function wrapTool<T extends VendorTool>(tool: T, options?: WrapToolOptions): T;

type ExceptionType = 'export' | 'seats' | 'quota' | 'feature';
/** The values Within accepts. Anything else is refused and the customer gets no invitation. */
type ExportKind = 'csv' | 'xlsx' | 'pdf' | 'api' | 'other';
type ExportLimitCode = 'row_cap' | 'monthly_quota' | 'plan_gated' | 'permission' | 'file_size' | 'rate_window' | 'other';
/**
 * What a tool refused. The short form is a message and a label. The long form names the
 * export and the limit as well. Either `label` or `export.label` has to be there.
 */
interface ExportBlockInput {
    /** What was refused. Absent means an export. */
    type?: ExceptionType;
    /** Short form: what the customer was refused, in a few words. Becomes `export.label`. */
    label?: string;
    export?: {
        /** Absent means `other`. */
        kind?: ExportKind | (string & {});
        label?: string;
        requested?: number;
        unit?: string;
    };
    limit?: {
        /** Absent means `other`. */
        code?: ExportLimitCode | (string & {});
        allowed?: number;
        plan?: string;
    };
    message: string;
}
/**
 * The result a vendor tool returns when it refuses on purpose. Pass the descriptor, or the
 * tool's extra and then the descriptor. `{ message, label }` is enough. The wrapper stores
 * the block and adds the invitation.
 */
declare function exportBlocked(descriptor: ExportBlockInput): ToolResult;
declare function exportBlocked(extra: unknown, descriptor: ExportBlockInput): ToolResult;

interface OfferLike {
    id?: string;
    intent?: string;
    intentLabel?: string;
    issueSummary?: string;
    vendorName?: string;
    representativeName?: string;
    representativeRole?: string;
}
declare function suggestedAssistanceMessage(offer: OfferLike | null | undefined): string;
declare function invitationText(offer: OfferLike | null | undefined): string;
interface LiveOfferCopy {
    cardEyebrow: string;
    cardTitle: string;
    cardNote: string;
    acceptLabel: string;
    declineLabel: string;
    acceptTool: string;
    declineTool: string;
    declineAction: string;
    suggestedMessage: string;
}
declare function liveOfferCopy(offer: Offer): LiveOfferCopy;
declare function assistanceDraft(note: Escalation): string;
interface AsyncEscalationCopy {
    cardEyebrow: string;
    cardEyebrowTone: string;
    cardTitle: string;
    cardNote: string;
    draftNote: string;
    acceptLabel: string;
    declineLabel: string;
    acceptTool: string;
    acceptAction: string;
    declineTool: string;
    declineAction: string;
    sentTitle: string;
    suggestedMessage: string;
}
declare function asyncEscalationCopy(note: Escalation): AsyncEscalationCopy;
interface SplitAnswer {
    direct_answer: string;
    context: string;
    full_answer: string;
}
declare function splitVendorAnswer(text: unknown): SplitAnswer;
interface CardFact {
    label: string;
    value: string;
    unit?: string;
}
declare function cardFacts(source: unknown): CardFact[];
declare function nameInitials(name: unknown): string;
declare function vendorAnswerResult(payload: ServicePayload): ToolResult;
interface Assistance {
    offerId?: string;
    intent?: string;
    representative: {
        name: string;
        role: string;
    };
    vendor: string;
    status: string;
    suggestedMessage: string;
    kind?: string;
    topic?: string;
}
declare function assistanceFromOffer(offer: OfferLike): Assistance;
/** Manual offer: one text line plus structured assistance. No card and no buttons. */
declare function attachInvitation(result: unknown, offer: OfferLike): ToolResult;

/** Namespace for `SupportBridge.install`. Calling it does nothing, as in legacy. */
declare function SupportBridge(): void;
declare namespace SupportBridge {
    var install: (server: VendorMcpServer, options: InstallOptions) => SupportBridgeInstallation;
}

/**
 * The offer card with `payload` baked in as the host output, for previews. The payload is
 * inserted with a replacer function, so `$&` and `$1` stay literal, and its JSON escapes
 * `<`, `>`, `&`, U+2028 and U+2029, so it cannot end the script.
 */
declare function previewIntentOfferHtml(payload?: unknown): string;

export { APP_MIME, ASSISTANCE_INTENT_IDS, type AssistanceIntent, CHAT_RESOURCE, CONFIRM_ASSISTANCE_DESCRIPTION, type ClaimMap, type CustomerIdentity, DECLINE_ASSISTANCE_DESCRIPTION, DISPLAY_INSTRUCTIONS, type ExceptionType, type ExportBlockInput, type ExportKind, type ExportLimitCode, INTENT_OFFER_RESOURCE, type IdentifyOptions, type IdentifyResult, type IdentityConfig, type IdentityProvider, type InstallOptions, type InstrumentedHandler, type InstrumentedTool, type McpToolContext, RESULT_HINT_SENTENCE, SDK_VERSION, SERVER_INSTRUCTIONS, STANDARD_ASSISTANCE_INTENTS, SupportBridge, type SupportBridgeInstallation, type ToolHandler, type VendorMcpServer, type VendorTool, type WrapToolOptions, assistanceDraft, assistanceFromOffer, asyncEscalationCopy, attachInvitation, cardFacts, exportBlocked, identifyFromContext, invitationText, liveOfferCopy, nameInitials, normalizeAssistanceArgs, normalizeOfferArgs, previewIntentOfferHtml, splitVendorAnswer, suggestedAssistanceMessage, vendorAnswerDescription, vendorAnswerResult, wrapTool };
