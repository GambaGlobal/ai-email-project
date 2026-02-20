import { createHash } from "node:crypto";
import {
  X_INBOX_COPILOT_DRAFT_KEY,
  X_INBOX_COPILOT_MARKER_VERSION
} from "./types";

export const COPILOT_MARKER_VERSION = 1 as const;
export const COPILOT_BODY_MARKER_PREFIX = "inbox-copilot:" as const;

export interface CopilotDraftMarkerPayload {
  draftKey: string;
  version: number;
}

export function buildCopilotMarkerHeaders(
  marker: CopilotDraftMarkerPayload
): Record<string, string> {
  return {
    [X_INBOX_COPILOT_DRAFT_KEY]: marker.draftKey,
    [X_INBOX_COPILOT_MARKER_VERSION]: String(marker.version)
  };
}

export function buildCopilotBodyMarker(marker: CopilotDraftMarkerPayload): string {
  return `<!-- ${COPILOT_BODY_MARKER_PREFIX}draftKey=${marker.draftKey};v=${marker.version} -->`;
}

const normalizeLineEndings = (value: string): string => value.replace(/\r\n?/g, "\n");

const removeTrailingWhitespaceLines = (value: string): string => {
  const lines = normalizeLineEndings(value).split("\n");
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }
  return lines.join("\n").trim();
};

const normalizeFingerprintField = (value?: string): string =>
  removeTrailingWhitespaceLines(value ?? "");

export function computeDraftFingerprint(input: {
  marker: CopilotDraftMarkerPayload;
  subject?: string;
  bodyText: string;
  bodyHtml?: string;
}): string {
  const canonical = [
    `draftKey=${normalizeFingerprintField(input.marker.draftKey)}`,
    `version=${input.marker.version}`,
    `subject=${normalizeFingerprintField(input.subject)}`,
    `bodyText=${normalizeFingerprintField(input.bodyText)}`,
    `bodyHtml=${normalizeFingerprintField(input.bodyHtml)}`
  ].join("\n");

  const digest = createHash("sha256").update(canonical).digest("hex");
  return `sha256:${digest}`;
}

const normalizeHeaderKey = (key: string): string => key.trim().toLowerCase();

const getHeaderValue = (
  headers: Record<string, string> | undefined,
  headerName: string
): string | undefined => {
  if (!headers) {
    return undefined;
  }

  const target = normalizeHeaderKey(headerName);
  const entry = Object.entries(headers).find(
    ([key]) => normalizeHeaderKey(key) === target
  );
  return entry?.[1];
};

const containsExpectedBodyMarker = (
  content: string | undefined,
  expectedDraftKey: string
): boolean => {
  if (!content) {
    return false;
  }

  const markerText = normalizeLineEndings(content);
  const expectedKey = `draftKey=${expectedDraftKey}`;
  const expectedVersion = `v=${COPILOT_MARKER_VERSION}`;
  return markerText.includes(COPILOT_BODY_MARKER_PREFIX) &&
    markerText.includes(expectedKey) &&
    markerText.includes(expectedVersion);
};

export function isCopilotOwnedDraft(input: {
  headers?: Record<string, string>;
  bodyText?: string;
  bodyHtml?: string;
  expectedDraftKey: string;
}): {
  owned: boolean;
  reason?:
    | "missing_marker"
    | "key_mismatch"
    | "version_mismatch"
    | "body_marker_missing";
} {
  const headerDraftKey = getHeaderValue(input.headers, X_INBOX_COPILOT_DRAFT_KEY);
  const headerVersion = getHeaderValue(input.headers, X_INBOX_COPILOT_MARKER_VERSION);

  if (headerDraftKey !== undefined || headerVersion !== undefined) {
    if (!headerDraftKey || !headerVersion) {
      return { owned: false, reason: "missing_marker" };
    }
    if (headerDraftKey !== input.expectedDraftKey) {
      return { owned: false, reason: "key_mismatch" };
    }
    if (headerVersion !== String(COPILOT_MARKER_VERSION)) {
      return { owned: false, reason: "version_mismatch" };
    }
    return { owned: true };
  }

  const hasBodyMarker =
    containsExpectedBodyMarker(input.bodyHtml, input.expectedDraftKey) ||
    containsExpectedBodyMarker(input.bodyText, input.expectedDraftKey);
  if (hasBodyMarker) {
    return { owned: true };
  }

  return { owned: false, reason: "body_marker_missing" };
}

export function shouldUpdateDraft(input: {
  owned: boolean;
  expectedPreviousFingerprint?: string;
  currentFingerprint?: string;
}): { ok: true } | { ok: false; reason: "not_owned" | "fingerprint_mismatch" } {
  if (!input.owned) {
    return { ok: false, reason: "not_owned" };
  }

  if (input.expectedPreviousFingerprint !== undefined) {
    if (
      input.currentFingerprint === undefined ||
      input.currentFingerprint !== input.expectedPreviousFingerprint
    ) {
      return { ok: false, reason: "fingerprint_mismatch" };
    }
  }

  return { ok: true };
}
