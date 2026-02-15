import type {
  Cursor,
  DraftId,
  EnsureLabelRequest,
  EnsureLabelResponse,
  GetThreadRequest,
  GetThreadResponse,
  MailChange,
  MessageId,
  NormalizedAddress,
  NormalizedMessage,
  NormalizedThread,
  ListChangesRequest,
  ListChangesResponse,
  ModifyThreadLabelsRequest,
  MailProvider,
  MailProviderContext,
  ThreadId,
  UpsertThreadDraftRequest,
  UpsertThreadDraftResponse
} from "@ai-email/shared";
import {
  DraftOwnershipMismatchError,
  GmailHistoryExpiredError,
  MissingRecipientError,
  NotImplementedError
} from "./errors";

type GmailHistoryType = "messageAdded" | "labelAdded" | "labelRemoved";

type GmailHistoryMessage = {
  id?: string | null;
  threadId?: string | null;
  internalDate?: string | null;
};

type GmailHistoryResponse = {
  history?: Array<{
    messagesAdded?: Array<{ message?: GmailHistoryMessage | null }>;
    labelsAdded?: Array<{ message?: GmailHistoryMessage | null }>;
    labelsRemoved?: Array<{ message?: GmailHistoryMessage | null }>;
  }>;
  nextPageToken?: string;
  historyId?: string;
};

type GmailThreadResponse = {
  id?: string;
  messages?: GmailApiMessage[];
};

type GmailApiMessage = {
  id?: string;
  threadId?: string;
  internalDate?: string;
  snippet?: string;
  payload?: GmailMessagePart;
};

type GmailMessagePart = {
  mimeType?: string;
  body?: {
    data?: string;
  };
  headers?: Array<{
    name?: string;
    value?: string;
  }>;
  parts?: GmailMessagePart[];
};

type GmailProfileResponse = {
  historyId?: string;
};

type GmailDraftListResponse = {
  drafts?: Array<{
    id?: string;
    message?: {
      threadId?: string;
    };
  }>;
};

type GmailDraftResponse = {
  id?: string;
  message?: {
    id?: string;
    threadId?: string;
    raw?: string;
  };
};

type GmailApiClient = {
  listHistory(input: {
    accessToken: string;
    userId: string;
    startHistoryId: string;
    labelId?: string;
    historyTypes: GmailHistoryType[];
    pageToken?: string;
    maxResults?: number;
  }): Promise<GmailHistoryResponse>;
  getProfile(input: {
    accessToken: string;
    userId: string;
  }): Promise<GmailProfileResponse>;
  getThread(input: {
    accessToken: string;
    userId: string;
    threadId: string;
  }): Promise<GmailThreadResponse>;
  listDrafts(input: {
    accessToken: string;
    userId: string;
    maxResults?: number;
  }): Promise<GmailDraftListResponse>;
  getDraft(input: {
    accessToken: string;
    userId: string;
    draftId: string;
  }): Promise<GmailDraftResponse>;
  createDraft(input: {
    accessToken: string;
    userId: string;
    threadId: string;
    raw: string;
  }): Promise<GmailDraftResponse>;
  updateDraft(input: {
    accessToken: string;
    userId: string;
    draftId: string;
    threadId: string;
    raw: string;
  }): Promise<GmailDraftResponse>;
};

type GmailAuth = {
  accessToken: string;
  userId?: string;
  labelId?: string;
  historyTypes?: GmailHistoryType[];
};

function parseJsonResponse<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(`Invalid JSON response from Gmail API: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const DEFAULT_HISTORY_TYPES: GmailHistoryType[] = ["messageAdded", "labelAdded", "labelRemoved"];
const DEFAULT_LABEL_ID = "INBOX";
const DEFAULT_USER_ID = "me";
const MAX_RESULTS_PER_PAGE = 500;
const MAX_BODY_TEXT_CHARS = 8000;
const MAX_DRAFT_SCAN_RESULTS = 50;

const gmailApiClient: GmailApiClient = {
  async listHistory(input) {
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(input.userId)}/history`);
    url.searchParams.set("startHistoryId", input.startHistoryId);
    url.searchParams.set("maxResults", String(input.maxResults ?? MAX_RESULTS_PER_PAGE));
    if (input.labelId) {
      url.searchParams.set("labelId", input.labelId);
    }
    for (const historyType of input.historyTypes) {
      url.searchParams.append("historyTypes", historyType);
    }
    if (input.pageToken) {
      url.searchParams.set("pageToken", input.pageToken);
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        authorization: `Bearer ${input.accessToken}`
      }
    });
    const bodyText = await response.text();
    if (!response.ok) {
      const error = new Error(`Gmail history.list failed with status ${response.status}: ${bodyText}`);
      (error as Error & { statusCode?: number }).statusCode = response.status;
      throw error;
    }
    return parseJsonResponse<GmailHistoryResponse>(bodyText);
  },
  async getProfile(input) {
    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(input.userId)}/profile`,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${input.accessToken}`
        }
      }
    );
    const bodyText = await response.text();
    if (!response.ok) {
      const error = new Error(`Gmail users.getProfile failed with status ${response.status}: ${bodyText}`);
      (error as Error & { statusCode?: number }).statusCode = response.status;
      throw error;
    }
    return parseJsonResponse<GmailProfileResponse>(bodyText);
  },
  async getThread(input) {
    const url = new URL(
      `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(input.userId)}/threads/${encodeURIComponent(input.threadId)}`
    );
    url.searchParams.set("format", "full");
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        authorization: `Bearer ${input.accessToken}`
      }
    });
    const bodyText = await response.text();
    if (!response.ok) {
      const error = new Error(`Gmail threads.get failed with status ${response.status}: ${bodyText}`);
      (error as Error & { statusCode?: number }).statusCode = response.status;
      throw error;
    }
    return parseJsonResponse<GmailThreadResponse>(bodyText);
  },
  async listDrafts(input) {
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(input.userId)}/drafts`);
    url.searchParams.set("maxResults", String(input.maxResults ?? MAX_DRAFT_SCAN_RESULTS));
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        authorization: `Bearer ${input.accessToken}`
      }
    });
    const bodyText = await response.text();
    if (!response.ok) {
      const error = new Error(`Gmail drafts.list failed with status ${response.status}: ${bodyText}`);
      (error as Error & { statusCode?: number }).statusCode = response.status;
      throw error;
    }
    return parseJsonResponse<GmailDraftListResponse>(bodyText);
  },
  async getDraft(input) {
    const url = new URL(
      `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(input.userId)}/drafts/${encodeURIComponent(input.draftId)}`
    );
    url.searchParams.set("format", "raw");
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        authorization: `Bearer ${input.accessToken}`
      }
    });
    const bodyText = await response.text();
    if (!response.ok) {
      const error = new Error(`Gmail drafts.get failed with status ${response.status}: ${bodyText}`);
      (error as Error & { statusCode?: number }).statusCode = response.status;
      throw error;
    }
    return parseJsonResponse<GmailDraftResponse>(bodyText);
  },
  async createDraft(input) {
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(input.userId)}/drafts`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        message: {
          threadId: input.threadId,
          raw: input.raw
        }
      })
    });
    const bodyText = await response.text();
    if (!response.ok) {
      const error = new Error(`Gmail drafts.create failed with status ${response.status}: ${bodyText}`);
      (error as Error & { statusCode?: number }).statusCode = response.status;
      throw error;
    }
    return parseJsonResponse<GmailDraftResponse>(bodyText);
  },
  async updateDraft(input) {
    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(input.userId)}/drafts/${encodeURIComponent(input.draftId)}`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${input.accessToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          id: input.draftId,
          message: {
            threadId: input.threadId,
            raw: input.raw
          }
        })
      }
    );
    const bodyText = await response.text();
    if (!response.ok) {
      const error = new Error(`Gmail drafts.update failed with status ${response.status}: ${bodyText}`);
      (error as Error & { statusCode?: number }).statusCode = response.status;
      throw error;
    }
    return parseJsonResponse<GmailDraftResponse>(bodyText);
  }
};

function toBigIntHistoryId(value: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Gmail historyId must be digits-only. Received: ${value}`);
  }
  return BigInt(value);
}

function maxHistoryId(left: string, right: string): string {
  return toBigIntHistoryId(left) >= toBigIntHistoryId(right) ? left : right;
}

function hasHistoryExpiredSignal(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const maybeError = error as { statusCode?: unknown; message?: unknown };
  if (maybeError.statusCode === 404) {
    return true;
  }
  if (typeof maybeError.message === "string") {
    const normalized = maybeError.message.toLowerCase();
    return normalized.includes("history") && normalized.includes("not found");
  }
  return false;
}

function toAuth(context: MailProviderContext): GmailAuth {
  if (!context.auth || typeof context.auth !== "object") {
    throw new Error("GmailProvider requires auth object with accessToken");
  }
  const auth = context.auth as Partial<GmailAuth>;
  if (typeof auth.accessToken !== "string" || auth.accessToken.trim().length === 0) {
    throw new Error("GmailProvider requires auth.accessToken");
  }
  return {
    accessToken: auth.accessToken,
    userId: auth.userId,
    labelId: auth.labelId,
    historyTypes: auth.historyTypes
  };
}

function toCursor(value: string): Cursor {
  return value as Cursor;
}

function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function encodeBase64Url(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function normalizeWhitespace(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildDraftMarker(input: {
  idempotencyKey: string;
  mailboxId: string;
  tenantId?: string;
}): string {
  const tokens = [`ai-email:draft:v1`, `key=${input.idempotencyKey}`, `mailbox=${input.mailboxId}`];
  if (input.tenantId) {
    tokens.push(`tenant=${input.tenantId}`);
  }
  return `<!-- ${tokens.join(" ")} -->`;
}

function parseDraftMarker(content: string | undefined): { key?: string; mailbox?: string; tenant?: string } {
  if (!content) {
    return {};
  }
  const markerMatch = content.match(/ai-email:draft:v1[\s\S]*?-->/i);
  if (!markerMatch) {
    return {};
  }
  const text = markerMatch[0];
  const readToken = (name: string) => {
    const match = text.match(new RegExp(`${name}\\s*=\\s*([^\\s>]+)`, "i"));
    return match?.[1];
  };
  return {
    key: readToken("key"),
    mailbox: readToken("mailbox"),
    tenant: readToken("tenant")
  };
}

function stripHtmlTags(input: string): string {
  return normalizeWhitespace(
    input
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
  );
}

function collectParts(root: GmailMessagePart | undefined): GmailMessagePart[] {
  if (!root) {
    return [];
  }
  const result: GmailMessagePart[] = [root];
  for (const child of root.parts ?? []) {
    result.push(...collectParts(child));
  }
  return result;
}

function extractBodyText(payload: GmailMessagePart | undefined): {
  bodyText?: string;
  bodyTextTruncated?: boolean;
} {
  const parts = collectParts(payload);
  const plainPart = parts.find(
    (part) => part.mimeType?.toLowerCase().startsWith("text/plain") && !!part.body?.data
  );
  const htmlPart = parts.find(
    (part) => part.mimeType?.toLowerCase().startsWith("text/html") && !!part.body?.data
  );
  const selected = plainPart ?? htmlPart;
  if (!selected?.body?.data) {
    return {};
  }

  let text = decodeBase64Url(selected.body.data);
  if (!plainPart) {
    text = stripHtmlTags(text);
  } else {
    text = normalizeWhitespace(text);
  }

  if (text.length > MAX_BODY_TEXT_CHARS) {
    return {
      bodyText: text.slice(0, MAX_BODY_TEXT_CHARS),
      bodyTextTruncated: true
    };
  }
  return text.length > 0 ? { bodyText: text, bodyTextTruncated: false } : {};
}

function parseHeaders(payload: GmailMessagePart | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const header of payload?.headers ?? []) {
    const key = header.name?.trim().toLowerCase();
    const value = header.value?.trim();
    if (!key || !value) {
      continue;
    }
    map.set(key, value);
  }
  return map;
}

function parseAddressEntry(value: string): NormalizedAddress | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const withNameMatch = trimmed.match(/^(?:"?([^"]*)"?\s*)?<([^>]+)>$/);
  const simpleEmailMatch = trimmed.match(/^([^<>\s,;]+@[^<>\s,;]+)$/);
  let email: string | null = null;
  let name: string | undefined;

  if (withNameMatch) {
    email = withNameMatch[2]?.trim().toLowerCase() ?? null;
    const rawName = withNameMatch[1]?.trim();
    if (rawName) {
      name = rawName.replace(/^"|"$/g, "");
    }
  } else if (simpleEmailMatch) {
    email = simpleEmailMatch[1].trim().toLowerCase();
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }
  return name ? { name, email } : { email };
}

function parseAddressList(value: string | undefined): NormalizedAddress[] {
  if (!value) {
    return [];
  }
  const parsed = value
    .split(",")
    .map((entry) => parseAddressEntry(entry))
    .filter((entry): entry is NormalizedAddress => !!entry);

  const seen = new Set<string>();
  const deduped: NormalizedAddress[] = [];
  for (const address of parsed) {
    if (seen.has(address.email)) {
      continue;
    }
    seen.add(address.email);
    deduped.push(address);
  }
  return deduped;
}

function toInternalDateMs(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) {
    return 0;
  }
  return Number.parseInt(value, 10);
}

function normalizeMessage(input: GmailApiMessage): NormalizedMessage | null {
  const messageId = input.id?.trim();
  const threadId = input.threadId?.trim();
  if (!messageId || !threadId) {
    return null;
  }
  const headers = parseHeaders(input.payload);
  const subject = headers.get("subject")?.trim() || undefined;
  const from = parseAddressList(headers.get("from"))[0];
  const to = parseAddressList(headers.get("to"));
  const cc = parseAddressList(headers.get("cc"));
  const body = extractBodyText(input.payload);

  return {
    messageId,
    threadId,
    internalDateMs: toInternalDateMs(input.internalDate),
    subject,
    from,
    to,
    cc,
    snippet: input.snippet?.trim() || undefined,
    bodyText: body.bodyText,
    bodyTextTruncated: body.bodyTextTruncated
  };
}

function formatAddress(address: NormalizedAddress): string {
  if (address.name && address.name.trim().length > 0) {
    return `${address.name} <${address.email}>`;
  }
  return address.email;
}

function escapeHeaderValue(value: string): string {
  return value.replace(/\r?\n/g, " ").trim();
}

function deriveRecipientFromThread(thread: NormalizedThread): NormalizedAddress | null {
  const latest = thread.messages[thread.messages.length - 1];
  if (latest?.from?.email) {
    return latest.from;
  }
  for (const participant of thread.participants) {
    if (participant.email) {
      return participant;
    }
  }
  return null;
}

function buildRfc822Raw(input: {
  to: NormalizedAddress;
  cc: NormalizedAddress[];
  subject: string;
  marker: string;
  bodyText: string;
  replyToMessageId?: string;
}): string {
  const headers: string[] = [];
  headers.push(`To: ${escapeHeaderValue(formatAddress(input.to))}`);
  if (input.cc.length > 0) {
    headers.push(`Cc: ${escapeHeaderValue(input.cc.map((entry) => formatAddress(entry)).join(", "))}`);
  }
  headers.push(`Subject: ${escapeHeaderValue(input.subject)}`);
  if (input.replyToMessageId && input.replyToMessageId.trim().length > 0) {
    headers.push(`In-Reply-To: ${escapeHeaderValue(input.replyToMessageId)}`);
    headers.push(`References: ${escapeHeaderValue(input.replyToMessageId)}`);
  }
  headers.push("Content-Type: text/plain; charset=UTF-8");
  headers.push("MIME-Version: 1.0");

  const body = normalizeWhitespace(`${input.marker}\n\n${input.bodyText}`);
  return encodeBase64Url(`${headers.join("\r\n")}\r\n\r\n${body}\r\n`);
}

function extractRawBody(raw: string | undefined): string {
  if (!raw) {
    return "";
  }
  const decoded = decodeBase64Url(raw);
  const splitIndex = decoded.indexOf("\r\n\r\n");
  if (splitIndex >= 0) {
    return decoded.slice(splitIndex + 4);
  }
  const lfIndex = decoded.indexOf("\n\n");
  if (lfIndex >= 0) {
    return decoded.slice(lfIndex + 2);
  }
  return decoded;
}

const notImplemented = (method: string): never => {
  throw new NotImplementedError(
    `GmailProvider.${method} not implemented (Step 2.8 stub)`
  );
};

export class GmailProvider implements MailProvider {
  kind: MailProvider["kind"] = "gmail";
  private readonly apiClient: GmailApiClient;

  constructor(input?: { apiClient?: GmailApiClient }) {
    this.apiClient = input?.apiClient ?? gmailApiClient;
  }

  async listChanges(
    context: MailProviderContext,
    req: ListChangesRequest
  ): Promise<ListChangesResponse> {
    const auth = toAuth(context);
    const userId = auth.userId ?? DEFAULT_USER_ID;
    const labelId = auth.labelId ?? DEFAULT_LABEL_ID;
    const historyTypes = auth.historyTypes?.length ? auth.historyTypes : DEFAULT_HISTORY_TYPES;

    if (!req.cursor) {
      const profile = await this.apiClient.getProfile({
        accessToken: auth.accessToken,
        userId
      });
      if (!profile.historyId) {
        throw new Error("Gmail users.getProfile did not return historyId");
      }
      return {
        nextCursor: toCursor(profile.historyId),
        changes: []
      };
    }

    const startHistoryId = String(req.cursor);
    let pageToken: string | undefined;
    let nextHistoryId: string | null = null;
    const byMessageId = new Map<string, { threadId: string; internalDateMs?: number }>();

    try {
      do {
        const response = await this.apiClient.listHistory({
          accessToken: auth.accessToken,
          userId,
          startHistoryId,
          labelId,
          historyTypes,
          pageToken,
          maxResults: req.limit
        });
        pageToken = response.nextPageToken;
        if (response.historyId) {
          nextHistoryId = nextHistoryId ? maxHistoryId(nextHistoryId, response.historyId) : response.historyId;
        }

        for (const historyEntry of response.history ?? []) {
          const messageBuckets = [
            ...(historyEntry.messagesAdded ?? []).map((entry) => entry.message),
            ...(historyEntry.labelsAdded ?? []).map((entry) => entry.message),
            ...(historyEntry.labelsRemoved ?? []).map((entry) => entry.message)
          ];
          for (const message of messageBuckets) {
            const messageId = message?.id?.trim();
            const threadId = message?.threadId?.trim();
            if (!messageId || !threadId) {
              continue;
            }
            const internalDateMsRaw = message?.internalDate?.trim();
            const internalDateMs =
              internalDateMsRaw && /^\d+$/.test(internalDateMsRaw) ? Number.parseInt(internalDateMsRaw, 10) : undefined;
            byMessageId.set(messageId, {
              threadId,
              internalDateMs
            });
          }
        }
      } while (pageToken);
    } catch (error) {
      if (hasHistoryExpiredSignal(error)) {
        throw new GmailHistoryExpiredError({
          userId,
          startHistoryId
        });
      }
      throw error;
    }

    if (!nextHistoryId) {
      nextHistoryId = startHistoryId;
    }

    const changes: MailChange[] = Array.from(byMessageId.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([messageId, entry]) => ({
        kind: "messageAdded",
        messageId: messageId as MessageId,
        threadId: entry.threadId as ThreadId,
        internalDateMs: entry.internalDateMs
      }));

    return {
      nextCursor: toCursor(nextHistoryId),
      changes
    };
  }

  async getThread(
    context: MailProviderContext,
    req: GetThreadRequest
  ): Promise<GetThreadResponse> {
    const auth = toAuth(context);
    const userId = auth.userId ?? DEFAULT_USER_ID;
    const threadId = String(req.threadId);

    const thread = await this.apiClient.getThread({
      accessToken: auth.accessToken,
      userId,
      threadId
    });
    const messages = (thread.messages ?? [])
      .map((message) => normalizeMessage(message))
      .filter((message): message is NormalizedMessage => !!message)
      .sort((left, right) => {
        if (left.internalDateMs !== right.internalDateMs) {
          return left.internalDateMs - right.internalDateMs;
        }
        return left.messageId.localeCompare(right.messageId);
      });

    const participants: NormalizedAddress[] = [];
    const seenParticipants = new Set<string>();
    for (const message of messages) {
      const addresses = [
        ...(message.from ? [message.from] : []),
        ...message.to,
        ...message.cc
      ];
      for (const address of addresses) {
        if (seenParticipants.has(address.email)) {
          continue;
        }
        seenParticipants.add(address.email);
        participants.push(address);
      }
    }

    const subject =
      [...messages]
        .reverse()
        .map((message) => message.subject)
        .find((value) => typeof value === "string" && value.length > 0) ?? undefined;
    const lastUpdatedMs = messages.reduce((max, message) => Math.max(max, message.internalDateMs), 0);

    const normalizedThread: NormalizedThread = {
      threadId: thread.id?.trim() || threadId,
      subject,
      participants,
      messages,
      lastUpdatedMs
    };

    return { thread: normalizedThread };
  }

  async ensureLabel(
    _context: MailProviderContext,
    _req: EnsureLabelRequest
  ): Promise<EnsureLabelResponse> {
    return notImplemented("ensureLabel");
  }

  async modifyThreadLabels(
    _context: MailProviderContext,
    _req: ModifyThreadLabelsRequest
  ): Promise<void> {
    return notImplemented("modifyThreadLabels");
  }

  async upsertThreadDraft(
    context: MailProviderContext,
    req: UpsertThreadDraftRequest
  ): Promise<UpsertThreadDraftResponse> {
    const auth = toAuth(context);
    const userId = auth.userId ?? DEFAULT_USER_ID;
    const threadId = String(req.threadId);
    const tenantId = typeof (context.auth as { tenantId?: unknown })?.tenantId === "string"
      ? ((context.auth as { tenantId?: string }).tenantId ?? undefined)
      : undefined;

    const threadResult = await this.getThread(context, { threadId: req.threadId, includeBody: true });
    const recipient = deriveRecipientFromThread(threadResult.thread);
    if (!recipient) {
      throw new MissingRecipientError({ threadId });
    }

    const latestMessage = threadResult.thread.messages[threadResult.thread.messages.length - 1];
    const marker = buildDraftMarker({
      idempotencyKey: req.marker.draftKey,
      mailboxId: String(context.mailboxId),
      tenantId
    });
    const subjectBase = req.subject?.trim() || threadResult.thread.subject?.trim() || "Re:";
    const subject = /^re:/i.test(subjectBase) ? subjectBase : `Re: ${subjectBase}`;
    const raw = buildRfc822Raw({
      to: recipient,
      cc: latestMessage?.cc ?? [],
      subject,
      marker,
      bodyText: req.body.text,
      replyToMessageId: String(req.replyToMessageId)
    });

    const listResponse = await this.apiClient.listDrafts({
      accessToken: auth.accessToken,
      userId,
      maxResults: MAX_DRAFT_SCAN_RESULTS
    });
    const threadDrafts = (listResponse.drafts ?? []).filter(
      (draft) => draft.message?.threadId === threadId && typeof draft.id === "string"
    );

    for (const draft of threadDrafts) {
      const draftId = String(draft.id);
      const draftDetail = await this.apiClient.getDraft({
        accessToken: auth.accessToken,
        userId,
        draftId
      });
      const parsedMarker = parseDraftMarker(extractRawBody(draftDetail.message?.raw));
      if (!parsedMarker.key) {
        continue;
      }
      if (parsedMarker.key !== req.marker.draftKey) {
        continue;
      }
      if (parsedMarker.mailbox && parsedMarker.mailbox !== String(context.mailboxId)) {
        throw new DraftOwnershipMismatchError({ draftId });
      }
      const updateResponse = await this.apiClient.updateDraft({
        accessToken: auth.accessToken,
        userId,
        draftId,
        threadId,
        raw
      });
      return {
        action: "updated",
        draftId: (updateResponse.id || draftId) as DraftId
      };
    }

    const createResponse = await this.apiClient.createDraft({
      accessToken: auth.accessToken,
      userId,
      threadId,
      raw
    });
    if (!createResponse.id) {
      throw new Error("Gmail drafts.create did not return draft id");
    }
    return {
      action: "created",
      draftId: String(createResponse.id) as DraftId
    };
  }
}
