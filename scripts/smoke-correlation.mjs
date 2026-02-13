import { newCorrelationId } from "@ai-email/shared/pipeline/ids-runtime";
import { readFile } from "node:fs/promises";

const apiBaseUrl = process.env.SMOKE_API_BASE_URL ?? "http://127.0.0.1:3001";
const tenantId = process.env.SMOKE_TENANT_ID ?? "00000000-0000-0000-0000-000000000001";
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 10000);
const evidenceTimeoutMs = Number(process.env.SMOKE_EVIDENCE_TIMEOUT_MS ?? 10000);
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
    console.error(`smoke: missing evidence: ${missing.join(", ")}`);
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

function hasEventForCorrelation(logText, cid, eventName) {
  const eventToken = `"event":"${eventName}"`;
  return logText.split("\n").some((line) => line.includes(cid) && line.includes(eventToken));
}

function collectMissingEvidence(state) {
  const missing = [];

  if (!state.apiReceived) {
    missing.push("api.notification.received");
  }
  if (!state.apiEnqueued) {
    missing.push("api.notification.enqueued");
  }
  if (!state.workerStart) {
    missing.push("worker.job.start");
  }
  if (!state.workerDoneOrError) {
    missing.push("worker.job.done|job.error");
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

const evidenceDeadline = Date.now() + evidenceTimeoutMs;
while (Date.now() <= evidenceDeadline) {
  const [apiLog, workerLog] = await Promise.all([readLog(apiLogPath), readLog(workerLogPath)]);
  const state = {
    apiReceived: hasEventForCorrelation(apiLog, correlationId, "notification.received"),
    apiEnqueued: hasEventForCorrelation(apiLog, correlationId, "notification.enqueued"),
    workerStart: hasEventForCorrelation(workerLog, correlationId, "job.start"),
    workerDone: hasEventForCorrelation(workerLog, correlationId, "job.done"),
    workerError: hasEventForCorrelation(workerLog, correlationId, "job.error")
  };
  state.workerDoneOrError = state.workerDone || state.workerError;

  if (state.workerError) {
    console.error(`smoke: FAIL correlationId=${correlationId} (job.error)`);
    printEvidenceHints(correlationId);
    process.exit(1);
  }

  if (state.apiReceived && state.apiEnqueued && state.workerStart && state.workerDone) {
    console.log(`smoke: PASS correlationId=${correlationId}`);
    process.exit(0);
  }

  await sleep(250);
}

const [finalApiLog, finalWorkerLog] = await Promise.all([readLog(apiLogPath), readLog(workerLogPath)]);
const finalState = {
  apiReceived: hasEventForCorrelation(finalApiLog, correlationId, "notification.received"),
  apiEnqueued: hasEventForCorrelation(finalApiLog, correlationId, "notification.enqueued"),
  workerStart: hasEventForCorrelation(finalWorkerLog, correlationId, "job.start"),
  workerDone: hasEventForCorrelation(finalWorkerLog, correlationId, "job.done"),
  workerError: hasEventForCorrelation(finalWorkerLog, correlationId, "job.error")
};
finalState.workerDoneOrError = finalState.workerDone || finalState.workerError;

if (finalState.workerError) {
  console.error(`smoke: FAIL correlationId=${correlationId} (job.error)`);
  printEvidenceHints(correlationId);
  process.exit(1);
}

const missingEvidence = collectMissingEvidence(finalState);
console.error(`smoke: FAIL correlationId=${correlationId} (timeout after ${evidenceTimeoutMs}ms)`);
printEvidenceHints(correlationId, missingEvidence);
process.exit(1);
