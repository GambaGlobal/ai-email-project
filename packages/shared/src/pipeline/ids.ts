import { randomUUID } from "node:crypto";
import type { CorrelationId } from "./types";

export function asCorrelationId(value: string): CorrelationId {
  return value as CorrelationId;
}

export function newCorrelationId(): CorrelationId {
  return asCorrelationId(randomUUID());
}
