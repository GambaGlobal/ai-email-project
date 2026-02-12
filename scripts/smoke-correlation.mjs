import { newCorrelationId } from "@ai-email/shared/pipeline/ids-runtime";

const apiBaseUrl = process.env.SMOKE_API_BASE_URL ?? "http://127.0.0.1:3001";
const tenantId = process.env.SMOKE_TENANT_ID ?? "smoke-tenant";
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 10000);

const correlationId = newCorrelationId();
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

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), timeoutMs);

try {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "x-tenant-id": tenantId,
      "x-correlation-id": correlationId,
      "x-goog-message-number": `smoke-${Date.now()}`,
      "x-goog-subscription-name": "local-smoke-correlation"
    },
    body: form,
    signal: controller.signal
  });

  const responseText = await response.text();
  if (!response.ok) {
    console.error(`smoke: request failed with status ${response.status}`);
    console.error(responseText);
    process.exit(1);
  }
} catch (error) {
  if (error instanceof Error && error.name === "AbortError") {
    console.error(`smoke: request timed out after ${timeoutMs}ms`);
    printApiStartHint();
    process.exit(1);
  }

  printApiStartHint();
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
