import type {
  MailProvider,
  MailProviderFactory,
  MailProviderName,
  MailProviderRegistry
} from "@ai-email/shared";
import { createGmailProvider } from "@ai-email/mail-gmail";

export type MailProviderDeps = {};

const notImplemented = (provider: MailProviderName): never => {
  throw new Error(`${provider} provider not implemented yet (planned).`);
};

export const createMailProviderRegistry = (
  _deps: MailProviderDeps = {}
): MailProviderRegistry => ({
  gmail: createGmailProvider,
  outlook: () => notImplemented("outlook")
});

export const getMailProvider = (
  name: MailProviderName,
  deps: MailProviderDeps = {}
): MailProvider => {
  const registry = createMailProviderRegistry(deps);
  const factory = registry[name];
  if (!factory) {
    throw new Error(`Unknown mail provider: ${name}`);
  }
  return factory({ ...(deps as object), provider: name } as Parameters<MailProviderFactory>[0]);
};
