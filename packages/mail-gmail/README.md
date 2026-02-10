# Gmail Provider Package

Gmail MailProvider adapter (stubbed in Step 2.8).

## How to construct
```ts
import {
  GmailProvider,
  createGmailProvider,
  mailProviderRegistry
} from "@ai-email/mail-gmail";

// simplest
const providerA = new GmailProvider();

// factory (preferred)
const providerB = createGmailProvider({ provider: "gmail" });

// via registry (gmail key)
const providerC = mailProviderRegistry.gmail({ provider: "gmail" });
```

Most methods throw `NotImplementedError` until later steps.
