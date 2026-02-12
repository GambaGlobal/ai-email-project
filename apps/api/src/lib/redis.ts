import { createClient, type RedisClientType } from "redis";

let redisClient: RedisClientType | null = null;
let connectPromise: Promise<RedisClientType> | null = null;

export async function getRedisClient(): Promise<RedisClientType> {
  if (redisClient?.isOpen) {
    return redisClient;
  }

  if (connectPromise) {
    return connectPromise;
  }

  const url = process.env.REDIS_URL;

  if (!url) {
    throw new Error("REDIS_URL is required for OAuth state storage");
  }

  const client = createClient({ url });
  client.on("error", (error) => {
    // eslint-disable-next-line no-console
    console.error("Redis client error", error);
  });

  connectPromise = client.connect().then(() => {
    redisClient = client;
    return client;
  });

  return connectPromise;
}
