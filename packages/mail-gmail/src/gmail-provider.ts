import type {
  Cursor,
  EnsureLabelRequest,
  EnsureLabelResponse,
  GetThreadRequest,
  GetThreadResponse,
  MailChange,
  MessageId,
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
    _context: MailProviderContext,
    _req: GetThreadRequest
  ): Promise<GetThreadResponse> {
    return notImplemented("getThread");
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
