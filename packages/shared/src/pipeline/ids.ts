import {
  asCorrelationId as asCorrelationIdRuntime,
  newCorrelationId as newCorrelationIdRuntime
} from "./ids-runtime.mjs";
import type { CorrelationId } from "./types";

export function asCorrelationId(value: string): CorrelationId {
  return asCorrelationIdRuntime(value) as CorrelationId;
}

export function newCorrelationId(): CorrelationId {
  return newCorrelationIdRuntime() as CorrelationId;
}
