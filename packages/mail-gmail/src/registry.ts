import type { MailProvider, MailProviderFactory, MailProviderName } from "@ai-email/shared";
import { GmailProvider } from "./gmail-provider";

export const createGmailProvider: MailProviderFactory = (deps: {
  provider: MailProviderName;
}): MailProvider => {
  if (deps.provider !== "gmail") {
    throw new Error(`GmailProvider cannot handle provider ${deps.provider}`);
  }
  return new GmailProvider();
};

export const mailProviderRegistry: Record<MailProviderName, MailProviderFactory> = {
  gmail: createGmailProvider,
  outlook: () => {
    throw new Error("Outlook provider not implemented (Step 2.8 stub)");
  }
};
