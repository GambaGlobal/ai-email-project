import type {
  CanonicalDraft,
  CanonicalMessage,
  CanonicalThread,
  MailEvent,
  MailProvider,
  MailProviderContext,
  MailProviderWatchState,
  ProviderMessageId,
  ProviderThreadId
} from "@ai-email/shared";
import { NotImplementedError } from "./errors";

const notImplemented = (method: string): never => {
  throw new NotImplementedError(
    `GmailProvider.${method} not implemented (Step 2.8 stub)`
  );
};

export class GmailProvider implements MailProvider {
  name: MailProvider["name"] = "gmail";

  async startWatch(_context: MailProviderContext): Promise<MailProviderWatchState> {
    return {
      provider: "gmail",
      cursor: "stub",
      startedAt: new Date().toISOString()
    };
  }

  async stopWatch(_context: MailProviderContext): Promise<void> {
    notImplemented("stopWatch");
  }

  async validateNotification(_payload: unknown): Promise<boolean> {
    notImplemented("validateNotification");
  }

  async translateNotification(
    _payload: unknown,
    _context: MailProviderContext
  ): Promise<MailEvent[]> {
    notImplemented("translateNotification");
  }

  async listRecent(
    _context: MailProviderContext,
    _cursor?: string
  ): Promise<MailEvent[]> {
    notImplemented("listRecent");
  }

  async fetchMessage(
    _context: MailProviderContext,
    _providerMessageId: ProviderMessageId
  ): Promise<CanonicalMessage> {
    notImplemented("fetchMessage");
  }

  async fetchThread(
    _context: MailProviderContext,
    _providerThreadId: ProviderThreadId
  ): Promise<CanonicalThread & { messages: CanonicalMessage[] }> {
    notImplemented("fetchThread");
  }

  async createDraftInThread(
    _context: MailProviderContext,
    _providerThreadId: ProviderThreadId,
    _draft: Omit<CanonicalDraft, "providerDraftId">
  ): Promise<CanonicalDraft> {
    notImplemented("createDraftInThread");
  }

  async updateDraft(): Promise<CanonicalDraft> {
    notImplemented("updateDraft");
  }

  async applyLabel(): Promise<void> {
    notImplemented("applyLabel");
  }
}
