import { randomBytes } from "node:crypto";

type OAuthStateRecord = {
  tenantId: string;
  returnPath: string;
  expiresAt: number;
};

const STATE_TTL_MS = 10 * 60 * 1000;
const stateStore = new Map<string, OAuthStateRecord>();

function sweepExpiredStates(now = Date.now()): void {
  for (const [state, record] of stateStore.entries()) {
    if (record.expiresAt <= now) {
      stateStore.delete(state);
    }
  }
}

export function issueOAuthState(input: { tenantId: string; returnPath: string }): string {
  sweepExpiredStates();

  const state = randomBytes(24).toString("hex");

  stateStore.set(state, {
    tenantId: input.tenantId,
    returnPath: input.returnPath,
    expiresAt: Date.now() + STATE_TTL_MS
  });

  return state;
}

export function consumeOAuthState(state: string): OAuthStateRecord | null {
  sweepExpiredStates();

  const record = stateStore.get(state);
  if (!record) {
    return null;
  }

  stateStore.delete(state);
  return record;
}
