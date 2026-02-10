const workerName = process.env.WORKER_NAME ?? "worker";

if (!process.env.REDIS_URL) {
  // eslint-disable-next-line no-console
  console.log("redis not configured, skipping queue init");
}

// eslint-disable-next-line no-console
console.log(`worker ready (${workerName}) at ${new Date().toISOString()}`);
