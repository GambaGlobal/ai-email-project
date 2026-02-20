import { newCorrelationId } from "@ai-email/shared/pipeline/ids-runtime";
import { readFile } from "node:fs/promises";

const apiBaseUrl = process.env.SMOKE_API_BASE_URL ?? "http://127.0.0.1:3001";
const tenantId = process.env.SMOKE_TENANT_ID ?? "00000000-0000-0000-0000-000000000001";
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 10000);
const logTimeoutMs = Number(process.env.SMOKE_LOG_TIMEOUT_MS ?? 10000);
const apiLogPath = process.env.AI_EMAIL_API_LOG ?? "/tmp/ai-email-api.log";
const workerLogPath = process.env.AI_EMAIL_WORKER_LOG ?? "/tmp/ai-email-worker.log";

const correlationId = newCorrelationId();
console.log(`SMOKE_CORRELATION_ID=${correlationId}`);
const endpoint = `${apiBaseUrl}/v1/docs`;

const printApiStartHint = () => {
  console.error("smoke: API is not reachable.");
  console.error("smoke: Start API: pnpm -w --filter @ai-email/api dev");
};

const printEvidenceHints = (cid, missing = []) => {
  if (missing.length > 0) {
    console.error("smoke: missing evidence:");
    for (const item of missing) {
      console.error(`- ${item}`);
    }
  }
  console.error(
    `smoke: grep API logs: rg -a "${cid}" "${apiLogPath}" | rg -e "notification.received|notification.enqueued"`
  );
  console.error(
    `smoke: grep worker logs: rg -a "${cid}" "${workerLogPath}" | rg -e "job.start|job.done|job.error"`
  );
  console.error(
    "smoke: if worker is not running yet, start it with `pnpm -w --filter @ai-email/worker dev` and rerun smoke."
  );
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readLog(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const maybeError = error;
    if (typeof maybeError === "object" && maybeError !== null && "code" in maybeError) {
      if (maybeError.code === "ENOENT") {
        return "";
      }
    }
    throw error;
  }
}

function parseJsonFromLogLine(line) {
  const start = line.indexOf("{");
  const end = line.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return null;
  }
  const candidate = line.slice(start, end + 1);
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function collectEvents(logText) {
  const events = [];
  for (const line of logText.split("\n")) {
    const event = parseJsonFromLogLine(line);
    if (event) {
      events.push(event);
    }
  }
  return events;
}

function toStringValue(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function findApiEvidence(apiEvents, cid) {
  const received = apiEvents.find(
    (event) => event.event === "notification.received" && event.correlationId === cid
  );
  const enqueued = apiEvents.find(
    (event) =>
      event.event === "notification.enqueued" &&
      event.correlationId === cid &&
      toStringValue(event.jobId)
  );
  const jobId = enqueued ? toStringValue(enqueued.jobId) : null;
  return {
    apiReceived: Boolean(received),
    apiEnqueued: Boolean(enqueued),
    jobId
  };
}

function findWorkerEvidence(workerEvents, cid, jobId) {
  if (!jobId) {
    return {
      workerStart: false,
      workerDone: false,
      workerError: false
    };
  }

  const hasEvent = (eventName) =>
    workerEvents.some(
      (event) =>
        event.event === eventName && event.correlationId === cid && toStringValue(event.jobId) === jobId
    );

  return {
    workerStart: hasEvent("job.start"),
    workerDone: hasEvent("job.done"),
    workerError: hasEvent("job.error")
  };
}

function collectMissingEvidence(state) {
  const missing = [];

  if (!state.apiReceived) {
    missing.push("api.notification.received");
  }
  if (!state.apiEnqueued) {
    missing.push("api.notification.enqueued");
  }
  if (!state.jobId) {
    missing.push("api.notification.enqueued.jobId");
  }
  if (!state.workerStart) {
    missing.push("worker.job.start (matching correlationId + jobId)");
  }
  if (!state.workerDoneOrError) {
    missing.push("worker.job.done|job.error (matching correlationId + jobId)");
  }

  return missing;
}

const form = new FormData();
form.append("category", "Policies");
form.append(
  "file",
  new Blob(["correlation smoke probe"], { type: "text/plain" }),
  "correlation-smoke.txt"
);

const maybeFormWithHeaders = form;
const multipartHeaders =
  typeof maybeFormWithHeaders?.getHeaders === "function"
    ? maybeFormWithHeaders.getHeaders()
    : {};
const headers = {
  ...multipartHeaders,
  "x-tenant-id": tenantId,
  "x-correlation-id": correlationId,
  "x-goog-message-number": `smoke-${Date.now()}`,
  "x-goog-subscription-name": "local-smoke-correlation"
};

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), timeoutMs);

try {
  console.log(`SMOKE_REQUEST_START correlationId=${correlationId}`);
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: form,
    signal: controller.signal
  });

  const responseText = await response.text();
  if (!response.ok) {
    console.error(`smoke: FAIL correlationId=${correlationId} (request status ${response.status})`);
    console.error(`smoke: request failed with status ${response.status}`);
    console.error(`smoke: correlationId=${correlationId}`);
    console.error(responseText);
    printEvidenceHints(correlationId);
    process.exit(1);
  }
} catch (error) {
  if (error instanceof Error && error.name === "AbortError") {
    console.error(`smoke: FAIL correlationId=${correlationId} (request timeout)`);
    console.error(`smoke: request timed out after ${timeoutMs}ms`);
    console.error(`smoke: correlationId=${correlationId}`);
    printApiStartHint();
    printEvidenceHints(correlationId);
    process.exit(1);
  }

  printApiStartHint();
  console.error(`smoke: FAIL correlationId=${correlationId} (request error)`);
  console.error(`smoke: correlationId=${correlationId}`);
  if (error instanceof Error) {
    console.error(`smoke: ${error.message}`);
  }
  printEvidenceHints(correlationId);
  process.exit(1);
} finally {
  clearTimeout(timeout);
}

console.log(`SMOKE_REQUEST_SENT correlationId=${correlationId}`);

const evidenceDeadline = Date.now() + logTimeoutMs;
while (Date.now() <= evidenceDeadline) {
  const [apiLog, workerLog] = await Promise.all([readLog(apiLogPath), readLog(workerLogPath)]);
  const apiEvents = collectEvents(apiLog);
  const workerEvents = collectEvents(workerLog);
  const apiEvidence = findApiEvidence(apiEvents, correlationId);
  const workerEvidence = findWorkerEvidence(workerEvents, correlationId, apiEvidence.jobId);
  const state = {
    ...apiEvidence,
    ...workerEvidence
  };
  state.workerDoneOrError = state.workerDone || state.workerError;

  if (state.workerError) {
    console.error(`FAIL: smoke: FAIL correlationId=${correlationId} jobId=${state.jobId} (job.error)`);
    printEvidenceHints(correlationId);
    process.exit(1);
  }

  if (state.apiReceived && state.apiEnqueued && state.workerStart && state.workerDone) {
    console.log(`PASS: smoke: PASS correlationId=${correlationId} jobId=${state.jobId}`);
    process.exit(0);
  }

  await sleep(250);
}

const [finalApiLog, finalWorkerLog] = await Promise.all([readLog(apiLogPath), readLog(workerLogPath)]);
const finalApiEvents = collectEvents(finalApiLog);
const finalWorkerEvents = collectEvents(finalWorkerLog);
const finalApiEvidence = findApiEvidence(finalApiEvents, correlationId);
const finalWorkerEvidence = findWorkerEvidence(finalWorkerEvents, correlationId, finalApiEvidence.jobId);
const finalState = {
  ...finalApiEvidence,
  ...finalWorkerEvidence
};
finalState.workerDoneOrError = finalState.workerDone || finalState.workerError;

if (finalState.workerError) {
  console.error(`FAIL: smoke: FAIL correlationId=${correlationId} jobId=${finalState.jobId} (job.error)`);
  printEvidenceHints(correlationId);
  process.exit(1);
}

const missingEvidence = collectMissingEvidence(finalState);
console.error(`FAIL: smoke: FAIL correlationId=${correlationId} (timeout after ${logTimeoutMs}ms)`);
printEvidenceHints(correlationId, missingEvidence);
process.exit(1);
