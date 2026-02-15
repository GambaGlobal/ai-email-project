import type {
  Cursor,
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
import { GmailHistoryExpiredError, NotImplementedError } from "./errors";

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

function normalizeWhitespace(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
    _context: MailProviderContext,
    _req: UpsertThreadDraftRequest
  ): Promise<UpsertThreadDraftResponse> {
    return notImplemented("upsertThreadDraft");
  }
}
