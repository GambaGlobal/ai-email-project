import { randomBytes } from "node:crypto";
import { getRedisClient } from "./redis.js";

type OAuthStateRecord = {
  tenantId: string;
  provider: "gmail";
  returnPath: string;
  createdAt: string;
};

const STATE_TTL_SECONDS = 10 * 60;

function keyFor(provider: "gmail", state: string): string {
  return `oauth_state:${provider}:${state}`;
}

export async function issueOAuthState(input: {
  tenantId: string;
  provider: "gmail";
  returnPath: string;
}): Promise<string> {
  const redis = await getRedisClient();

  const state = randomBytes(24).toString("hex");
  const record: OAuthStateRecord = {
    tenantId: input.tenantId,
    provider: input.provider,
    returnPath: input.returnPath,
    createdAt: new Date().toISOString()
  };

  await redis.set(keyFor(input.provider, state), JSON.stringify(record), {
    EX: STATE_TTL_SECONDS
  });

  return state;
}

export async function consumeOAuthState(
  provider: "gmail",
  state: string
): Promise<OAuthStateRecord | null> {
  const redis = await getRedisClient();
  const key = keyFor(provider, state);
  const value = await redis.getDel(key);

  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<OAuthStateRecord>;

    if (
      parsed.provider === provider &&
      typeof parsed.tenantId === "string" &&
      parsed.tenantId.length > 0 &&
      typeof parsed.returnPath === "string" &&
      typeof parsed.createdAt === "string"
    ) {
      return parsed as OAuthStateRecord;
    }
  } catch {
    return null;
  }

  return null;
}
