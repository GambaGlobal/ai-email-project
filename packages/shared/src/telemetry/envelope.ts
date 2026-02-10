import type { TelemetryContext, TelemetryEvent } from "./types";

export interface TelemetryEnvelope<T extends TelemetryEvent = TelemetryEvent> {
  occurredAt: string;
  context: TelemetryContext;
  event: T;
}

export function buildTelemetryEnvelope<T extends TelemetryEvent>(input: {
  context: TelemetryContext;
  event: T;
  occurredAt?: string;
}): TelemetryEnvelope<T> {
  return {
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    context: input.context,
    event: input.event
  };
}
