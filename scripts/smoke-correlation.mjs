import { newCorrelationId } from "@ai-email/shared/pipeline/ids-runtime";

const apiBaseUrl = process.env.SMOKE_API_BASE_URL ?? "http://127.0.0.1:3001";
const tenantId = process.env.SMOKE_TENANT_ID ?? "11111111-1111-1111-1111-111111111111";
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 10000);

const correlationId = newCorrelationId();
console.log(`SMOKE_CORRELATION_ID=${correlationId}`);
const endpoint = `${apiBaseUrl}/v1/docs`;

const printApiStartHint = () => {
  console.error("smoke: API is not reachable.");
  console.error("smoke: Start API: pnpm -w --filter @ai-email/api dev");
};

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
    console.error(`smoke: request failed with status ${response.status}`);
    console.error(`smoke: correlationId=${correlationId}`);
    console.error(responseText);
    process.exit(1);
  }
} catch (error) {
  if (error instanceof Error && error.name === "AbortError") {
    console.error(`smoke: request timed out after ${timeoutMs}ms`);
    console.error(`smoke: correlationId=${correlationId}`);
    printApiStartHint();
    process.exit(1);
  }

  printApiStartHint();
  console.error(`smoke: correlationId=${correlationId}`);
  if (error instanceof Error) {
    console.error(`smoke: ${error.message}`);
  }
  process.exit(1);
} finally {
  clearTimeout(timeout);
}

console.log(`SMOKE_REQUEST_SENT correlationId=${correlationId}`);
console.log("smoke: verify API logs include events notification.received + notification.enqueued");
console.log("smoke: verify worker logs include events job.start + job.done (or job.error)");
console.log(
  `smoke: grep API logs: grep "${correlationId}" <api-log-file> | grep -E "notification.received|notification.enqueued"`
);
console.log(
  `smoke: grep worker logs: grep "${correlationId}" <worker-log-file> | grep -E "job.start|job.done|job.error"`
);
console.log(
  "smoke: if worker is not running yet, start it with `pnpm -w --filter @ai-email/worker dev` and rerun smoke."
);
