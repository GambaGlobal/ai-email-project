export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotImplementedError";
  }
}

export class GmailHistoryExpiredError extends Error {
  readonly userId: string;
  readonly startHistoryId: string;

  constructor(input: { userId: string; startHistoryId: string; message?: string }) {
    super(input.message ?? `Gmail history expired for user=${input.userId} startHistoryId=${input.startHistoryId}`);
    this.name = "GmailHistoryExpiredError";
    this.userId = input.userId;
    this.startHistoryId = input.startHistoryId;
  }
}

export class MissingRecipientError extends Error {
  readonly threadId: string;

  constructor(input: { threadId: string; message?: string }) {
    super(input.message ?? `Unable to derive recipient for thread=${input.threadId}`);
    this.name = "MissingRecipientError";
    this.threadId = input.threadId;
  }
}

export class DraftOwnershipMismatchError extends Error {
  readonly draftId: string;

  constructor(input: { draftId: string; message?: string }) {
    super(input.message ?? `Draft ${input.draftId} is not owned by ai-email marker`);
    this.name = "DraftOwnershipMismatchError";
    this.draftId = input.draftId;
  }
}
