import type { MailProvider } from "./provider";
import type { MailProviderName } from "./types";

export type MailProviderFactory = (deps: {
  provider: MailProviderName;
}) => MailProvider;

export type MailProviderRegistry = Record<MailProviderName, MailProviderFactory>;
