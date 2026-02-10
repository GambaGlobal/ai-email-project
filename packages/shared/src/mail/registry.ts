import type { MailProvider, MailProviderName } from "./provider";

export type MailProviderFactory = (deps: {
  provider: MailProviderName;
}) => MailProvider;

export type MailProviderRegistry = Record<MailProviderName, MailProviderFactory>;
