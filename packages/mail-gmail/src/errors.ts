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
