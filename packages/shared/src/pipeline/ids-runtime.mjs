import { randomUUID } from "node:crypto";

export const asCorrelationId = (value) => value;

export const newCorrelationId = () => asCorrelationId(randomUUID());
