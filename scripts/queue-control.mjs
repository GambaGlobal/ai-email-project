import { Queue } from "bullmq";
import IORedis from "ioredis";

const VALID_ACTIONS = new Set(["pause", "resume", "is-paused"]);

function parseRedisHost(redisUrl) {
  const parsed = new URL(redisUrl);
  return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
}

function shellValue(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

async function main() {
  const action = process.env.ACTION;
  const redisUrl = process.env.REDIS_URL;
  const queueName = process.env.QUEUE_NAME ?? "docs_ingestion";
  const confirmed = process.env.QUEUE_CONTROL_CONFIRM === "1";
  const ts = new Date().toISOString();
  const localOnly = process.env.LOCAL_ONLY;

  if (!VALID_ACTIONS.has(action ?? "")) {
    console.error(
      JSON.stringify({
        event: "queue.control.error",
        message: 'ACTION must be one of "pause" | "resume" | "is-paused"'
      })
    );
    console.error('queue:control: ACTION must be one of "pause" | "resume" | "is-paused"');
    process.exit(1);
  }

  if (!redisUrl) {
    console.error(
      JSON.stringify({
        event: "queue.control.error",
        action,
        queueName,
        message: "REDIS_URL is required"
      })
    );
    console.error('queue:control: REDIS_URL is required, e.g. REDIS_URL="redis://127.0.0.1:6379"');
    process.exit(1);
  }

  if (!queueName.trim()) {
    console.error(
      JSON.stringify({
        event: "queue.control.error",
        action,
        message: "QUEUE_NAME must not be empty"
      })
    );
    console.error("queue:control: QUEUE_NAME must not be empty");
    process.exit(1);
  }

  let redisUrlHost;
  try {
    redisUrlHost = parseRedisHost(redisUrl);
  } catch {
    console.error(
      JSON.stringify({
        event: "queue.control.error",
        action,
        queueName,
        message: "REDIS_URL is not a valid URL"
      })
    );
    console.error("queue:control: REDIS_URL must be a valid URL like redis://127.0.0.1:6379");
    process.exit(1);
  }

  console.log(
    JSON.stringify({
      event: "queue.control",
      action,
      queueName,
      redisUrlHost,
      confirmed,
      ts,
      localOnly: localOnly ?? null
    })
  );

  const redis = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  });
  const queue = new Queue(queueName, { connection: redis });

  try {
    if (action === "is-paused") {
      const isPaused = await queue.isPaused();
      console.log(JSON.stringify({ event: "queue.paused.status", queueName, isPaused }));
      console.log(`OK queue:is-paused queue=${queueName} isPaused=${isPaused} confirmed=0`);
      process.exit(0);
    }

    if (!confirmed) {
      const rerun = `REDIS_URL=${shellValue(redisUrl)} QUEUE_NAME=${shellValue(queueName)} QUEUE_CONTROL_CONFIRM=1 ACTION=${shellValue(
        action
      )} node ./scripts/queue-control.mjs`;
      console.log(
        JSON.stringify({
          event: "queue.control.dry_run",
          action,
          queueName,
          message: "DRY RUN - set QUEUE_CONTROL_CONFIRM=1 to apply"
        })
      );
      console.log(`DRY RUN - no queue mutation applied for action=${action}`);
      console.log(`Re-run with confirm: ${rerun}`);
      const isPaused = await queue.isPaused();
      console.log(`OK queue:${action} queue=${queueName} isPaused=${isPaused} confirmed=0`);
      process.exit(0);
    }

    if (action === "pause") {
      await queue.pause(false);
    } else if (action === "resume") {
      await queue.resume(false);
    }

    const isPaused = await queue.isPaused();
    console.log(
      JSON.stringify({
        event: "queue.control.applied",
        action,
        queueName,
        isPaused
      })
    );
    console.log(`OK queue:${action} queue=${queueName} isPaused=${isPaused} confirmed=1`);
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({
        event: "queue.control.error",
        action,
        queueName,
        message
      })
    );
    console.error(`queue:control: ${message}`);
    process.exit(1);
  } finally {
    await queue.close();
    await redis.quit();
  }
}

void main();
