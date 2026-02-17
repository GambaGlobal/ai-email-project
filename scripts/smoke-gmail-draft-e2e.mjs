import { createDecipheriv, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { Queue } from "bullmq";
import IORedis from "ioredis";

const tenantId = requiredEnv("TENANT_ID");
const testInboxEmail = requiredEnv("TEST_INBOX_EMAIL").toLowerCase();
const testTriggerSubject = requiredEnv("TEST_TRIGGER_SUBJECT");
const databaseUrl = requiredEnv("DATABASE_URL");
const tokenEncryptionKey = requiredEnv("TOKEN_ENCRYPTION_KEY");
const redisUrl = requiredEnv("REDIS_URL");
const apiBaseUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:3101";
const timeoutSeconds = Number(process.env.TIMEOUT_SECONDS ?? "120");
const runTwice = process.env.RUN_TWICE === "1" || process.argv.includes("--twice");

if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
  fail("TIMEOUT_SECONDS must be a positive number");
}

const timeoutMs = timeoutSeconds * 1000;
const startedAtMs = Date.now();
const deadlineMs = startedAtMs + timeoutMs;

const mailboxSyncJobId = (mailboxId) => `mailbox_sync-gmail-${mailboxId}`;

function requiredEnv(key) {
  const value = process.env[key];
  if (!value || value.trim().length === 0) {
    fail(`${key} is required`);
  }
  return value.trim();
}

function fail(message, details) {
  console.error(`FAIL: smoke:gmail-draft-e2e reason=${message}`);
  if (details) {
    console.error(details);
  }
  process.exit(1);
}

function resolvePsqlBin() {
  const envBin = process.env.PSQL_BIN;
  if (envBin && envBin.trim().length > 0) {
    return envBin.trim();
  }
  const candidates = ["/opt/homebrew/opt/postgresql@16/bin/psql", "/usr/local/bin/psql"];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return "psql";
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runSql(psqlBin, sql) {
  return new Promise((resolve) => {
    const child = spawn(psqlBin, [databaseUrl, "-v", "ON_ERROR_STOP=1", "-At", "-F", "\t", "-c", sql], {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, stdout, stderr });
    });
    child.on("error", (error) => {
      resolve({ ok: false, stdout, stderr: `${psqlBin}: ${error.message}` });
    });
  });
}

function readEncryptionKey(raw) {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  const base64 = Buffer.from(raw, "base64");
  if (base64.length === 32) {
    return base64;
  }

  const utf8 = Buffer.from(raw, "utf8");
  if (utf8.length === 32) {
    return utf8;
  }

  fail("TOKEN_ENCRYPTION_KEY must decode to 32 bytes (hex/base64/plain-text)");
}

function decryptToken(input) {
  const decipher = createDecipheriv("aes-256-gcm", readEncryptionKey(tokenEncryptionKey), Buffer.from(input.iv, "base64"));
  decipher.setAuthTag(Buffer.from(input.tag, "base64"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(input.ciphertext, "base64")), decipher.final()]);
  return decrypted.toString("utf8");
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, ok: response.ok, body };
}

async function getConnectionStatus() {
  const url = new URL("/v1/mail/gmail/connection", apiBaseUrl);
  const res = await fetchJson(url.toString(), {
    method: "GET",
    headers: {
      "x-tenant-id": tenantId
    }
  });
  if (!res.ok) {
    fail("connection_status_request_failed", JSON.stringify(res.body));
  }
  const body = res.body ?? {};
  if (body.status !== "connected") {
    fail("gmail_not_connected", JSON.stringify(body));
  }
  if (typeof body.mailbox_id !== "string" || body.mailbox_id.length === 0) {
    fail("connection_response_missing_mailbox_id", JSON.stringify(body));
  }
  const resolvedEmail =
    typeof body.email === "string" && body.email.length > 0
      ? body.email.toLowerCase()
      : typeof body.address === "string" && body.address.length > 0
        ? body.address.toLowerCase()
        : null;
  if (resolvedEmail && resolvedEmail !== testInboxEmail) {
    fail(
      "connected_mailbox_email_mismatch",
      `expected TEST_INBOX_EMAIL=${testInboxEmail}, got connection_email=${resolvedEmail}`
    );
  }
  return {
    mailboxId: body.mailbox_id,
    connection: body
  };
}

async function loadAccessTokenFromDb(psqlBin) {
  const sql = `
SELECT set_config('app.tenant_id', ${sqlLiteral(tenantId)}, true);
SELECT
  status,
  access_token_ciphertext,
  access_token_iv,
  access_token_tag
FROM mail_provider_connections
WHERE tenant_id = ${sqlLiteral(tenantId)}::uuid
  AND provider = 'gmail'
LIMIT 1;
`;
  const result = await runSql(psqlBin, sql);
  if (!result.ok) {
    fail("connection_row_query_failed", result.stderr.trim());
  }

  const row = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.split("\t").length >= 4)
    .at(-1);

  if (!row) {
    fail("missing_mail_provider_connection_row");
  }

  const [status, ciphertext, iv, tag] = row.split("\t");
  if (status !== "connected") {
    fail("mail_provider_connection_not_connected", `status=${status}`);
  }
  if (!ciphertext || !iv || !tag) {
    fail("mail_provider_connection_missing_access_token");
  }

  return decryptToken({ ciphertext, iv, tag });
}

async function getGmailProfile(accessToken) {
  const res = await fetchJson("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    method: "GET",
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });
  if (!res.ok) {
    fail("gmail_profile_request_failed", JSON.stringify(res.body));
  }
  return res.body ?? {};
}

async function triggerNotification(input) {
  const payload = Buffer.from(
    JSON.stringify({
      emailAddress: testInboxEmail,
      historyId: input.historyId
    }),
    "utf8"
  ).toString("base64");

  const res = await fetchJson(new URL("/v1/notifications/gmail", apiBaseUrl).toString(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-correlation-id": input.correlationId,
      "x-tenant-id": tenantId,
      "x-mailbox-id": input.mailboxId
    },
    body: JSON.stringify({
      message: {
        messageId: input.notificationMessageId,
        data: payload
      },
      subscription: "projects/local/subscriptions/smoke-gmail-draft-e2e"
    })
  });

  if (res.status !== 204) {
    fail("gmail_notification_trigger_failed", JSON.stringify(res.body));
  }
}

async function enqueueMailboxSync(queue, mailboxId) {
  const jobId = mailboxSyncJobId(mailboxId);
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (
      state === "active" ||
      state === "waiting" ||
      state === "delayed" ||
      state === "prioritized" ||
      state === "waiting-children"
    ) {
      return jobId;
    }
    try {
      await queue.remove(jobId);
    } catch {
      return jobId;
    }
  }

  await queue.add(
    "mailbox.sync",
    {
      tenantId,
      mailboxId,
      provider: "gmail"
    },
    {
      jobId
    }
  );
  return jobId;
}

async function findThreadIdBySubject(accessToken) {
  const q = `to:${testInboxEmail} subject:"${testTriggerSubject.replace(/"/g, '\\"')}"`;
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/threads");
  url.searchParams.set("q", q);
  url.searchParams.set("maxResults", "20");
  const res = await fetchJson(url.toString(), {
    method: "GET",
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });
  if (!res.ok) {
    fail("gmail_thread_search_failed", JSON.stringify(res.body));
  }
  const threads = Array.isArray(res.body?.threads) ? res.body.threads : [];
  const first = threads.find((thread) => thread && typeof thread.id === "string");
  return first?.id ?? null;
}

async function listDraftIdsForThread(accessToken, threadId) {
  let pageToken = null;
  const draftIds = [];

  do {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/drafts");
    url.searchParams.set("maxResults", "100");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const res = await fetchJson(url.toString(), {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    if (!res.ok) {
      fail("gmail_drafts_list_failed", JSON.stringify(res.body));
    }

    const drafts = Array.isArray(res.body?.drafts) ? res.body.drafts : [];
    for (const draft of drafts) {
      if (draft?.message?.threadId === threadId && typeof draft.id === "string") {
        draftIds.push(draft.id);
      }
    }

    pageToken = typeof res.body?.nextPageToken === "string" ? res.body.nextPageToken : null;
  } while (pageToken);

  return draftIds;
}

async function collectStageEvidence(queue, stage, input) {
  const jobs = await queue.getJobs(
    ["waiting", "active", "delayed", "completed", "failed", "prioritized", "waiting-children"],
    0,
    200
  );

  const matches = [];
  for (const job of jobs) {
    if (!job || typeof job.data !== "object" || job.data === null) {
      continue;
    }
    const data = job.data;
    const sameTenant = data.tenantId === input.tenantId;
    const sameMailbox = data.mailboxId === input.mailboxId;
    const sameThread = data.threadId === input.threadId;
    const recent = typeof job.timestamp === "number" && job.timestamp >= input.startedAtMs;
    if (sameTenant && sameMailbox && sameThread && recent) {
      const state = await job.getState();
      matches.push({
        id: String(job.id ?? ""),
        state
      });
    }
  }

  const ran = matches.some((entry) => entry.state === "active" || entry.state === "completed");
  return {
    stage,
    ran,
    matches
  };
}

async function collectQueueDiagnostic(queue, name) {
  const counts = await queue.getJobCounts("waiting", "active", "delayed", "completed", "failed");
  const jobs = await queue.getJobs(["active", "waiting", "completed", "failed"], 0, 10);
  const recent = [];
  for (const job of jobs) {
    const state = await job.getState();
    recent.push({
      id: String(job.id ?? ""),
      state,
      ts: job.timestamp,
      tenantId: job.data?.tenantId ?? null,
      mailboxId: job.data?.mailboxId ?? null,
      threadId: job.data?.threadId ?? null
    });
  }
  return { name, counts, recent };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSingleCycle(input) {
  const cycleStartedAtMs = Date.now();
  const correlationId = randomUUID();
  const notificationMessageId = `smoke-e2e-${randomUUID()}`;

  await triggerNotification({
    mailboxId: input.connectionStatus.mailboxId,
    historyId: input.historyId,
    correlationId,
    notificationMessageId
  });
  const syncJobId = await enqueueMailboxSync(mailboxSyncQueue, input.connectionStatus.mailboxId);

  let threadId = null;
  let draftIds = [];
  let mailboxSyncRan = false;
  let fetchThreadRan = false;
  let writebackRan = false;
  let delayMs = 1000;

  while (Date.now() <= deadlineMs) {
    const syncJob = await mailboxSyncQueue.getJob(syncJobId);
    if (syncJob) {
      const syncState = await syncJob.getState();
      if (syncState === "active" || syncState === "completed") {
        mailboxSyncRan = true;
      }
    }

    if (!threadId) {
      threadId = await findThreadIdBySubject(input.accessToken);
    }

    if (threadId) {
      draftIds = await listDraftIdsForThread(input.accessToken, threadId);

      const fetchEvidence = await collectStageEvidence(fetchThreadQueue, "fetch_thread", {
        tenantId,
        mailboxId: input.connectionStatus.mailboxId,
        threadId,
        startedAtMs: cycleStartedAtMs
      });
      fetchThreadRan = fetchThreadRan || fetchEvidence.ran;

      const writebackEvidence = await collectStageEvidence(writebackQueue, "writeback", {
        tenantId,
        mailboxId: input.connectionStatus.mailboxId,
        threadId,
        startedAtMs: cycleStartedAtMs
      });
      writebackRan = writebackRan || writebackEvidence.ran;
    }

    if (mailboxSyncRan && fetchThreadRan && writebackRan && draftIds.length > 0 && threadId) {
      return {
        cycle: input.cycle,
        correlationId,
        threadId,
        draftIds,
        mailboxSyncRan,
        fetchThreadRan,
        writebackRan
      };
    }

    await sleep(delayMs);
    delayMs = Math.min(Math.round(delayMs * 1.5), 8000);
  }

  const diagnostics = {
    cycle: input.cycle,
    timeoutSeconds,
    runTwice,
    connection: input.connectionStatus.connection,
    mailboxId: input.connectionStatus.mailboxId,
    threadId,
    draftIds,
    mailboxSync: await collectQueueDiagnostic(mailboxSyncQueue, "mailbox_sync"),
    fetchThread: await collectQueueDiagnostic(fetchThreadQueue, "fetch_thread"),
    writeback: await collectQueueDiagnostic(writebackQueue, "writeback"),
    hints: [
      "Confirm an inbound email was sent to TEST_INBOX_EMAIL with TEST_TRIGGER_SUBJECT exactly.",
      "Confirm API + worker are running with MAILBOX_PIPELINE_ENABLED=1 and MAILBOX_SYNC_DRAFT_WRITEBACK=1.",
      "Confirm Gmail OAuth connection for TENANT_ID is active and TOKEN_ENCRYPTION_KEY matches stored tokens."
    ]
  };

  fail("timeout_waiting_for_draft_in_thread", JSON.stringify(diagnostics, null, 2));
}

const psqlBin = resolvePsqlBin();
const redis = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false
});
const mailboxSyncQueue = new Queue("mailbox_sync", { connection: redis });
const fetchThreadQueue = new Queue("fetch_thread", { connection: redis });
const writebackQueue = new Queue("writeback", { connection: redis });

try {
  console.log(
    `smoke:gmail-draft-e2e start tenantId=${tenantId} subject="${testTriggerSubject}" runTwice=${runTwice}`
  );
  console.log("smoke:gmail-draft-e2e safety=read-only-no-send");

  const connectionStatus = await getConnectionStatus();
  const accessToken = await loadAccessTokenFromDb(psqlBin);
  const profile = await getGmailProfile(accessToken);
  const historyId = typeof profile.historyId === "string" ? profile.historyId : null;
  if (!historyId) {
    fail("gmail_profile_missing_history_id");
  }

  const cycleOne = await runSingleCycle({
    cycle: 1,
    connectionStatus,
    accessToken,
    historyId
  });

  let finalResult = cycleOne;
  if (runTwice) {
    const cycleTwo = await runSingleCycle({
      cycle: 2,
      connectionStatus,
      accessToken,
      historyId
    });
    finalResult = cycleTwo;
  }

  if (finalResult.draftIds.length !== 1) {
    fail(
      "idempotency_draft_count_mismatch",
      `expected exactly 1 draft in thread after run${runTwice ? "s" : ""}, got ${finalResult.draftIds.length}: ${finalResult.draftIds.join(",")}`
    );
  }

  console.log(
    `PASS: smoke:gmail-draft-e2e tenantId=${tenantId} mailboxId=${connectionStatus.mailboxId} threadId=${finalResult.threadId} draftIds=${finalResult.draftIds.join(",")} runTwice=${runTwice}`
  );
  process.exit(0);
} finally {
  await Promise.allSettled([
    mailboxSyncQueue.close(),
    fetchThreadQueue.close(),
    writebackQueue.close(),
    redis.quit()
  ]);
}
