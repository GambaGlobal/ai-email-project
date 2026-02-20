"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_DEV_TENANT_ID } from "../lib/dev-config";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;
const API_TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? DEFAULT_DEV_TENANT_ID;

const GMAIL_CONNECTION_STATE_KEY = "gmail_connection_state";
const GMAIL_LAST_VERIFIED_KEY = "gmail_last_verified";
const DOCS_STORAGE_KEY = "operator_docs_v1";
const DRAFTS_ENABLED_STORAGE_KEY = "operator_drafts_enabled_v1";

type HealthSeverity = "green" | "yellow" | "red";
type GmailStatus = "connected" | "disconnected" | "reconnect_required";
type DocStatus = "queued" | "indexing" | "ready" | "failed";

type GmailConnectionPayload = {
  status: GmailStatus;
  last_verified_at: string | null;
  updated_at: string | null;
};

type DocRecord = {
  id: string;
  filename: string;
  status: DocStatus;
  error_message: string | null;
  indexed_at: string | null;
  updated_at: string | null;
};

function formatDateTime(value: string | null): string {
  if (!value) {
    return "—";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }

  return parsed.toLocaleString();
}

function parseDocsFromStorage(input: string | null): DocRecord[] {
  if (!input) {
    return [];
  }

  try {
    const parsed = JSON.parse(input);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }

        const value = item as Record<string, unknown>;
        const status = value.status;

        if (
          status !== "queued" &&
          status !== "indexing" &&
          status !== "ready" &&
          status !== "failed"
        ) {
          return null;
        }

        return {
          id: String(value.id ?? ""),
          filename: String(value.filename ?? "Untitled document"),
          status,
          error_message: typeof value.error_message === "string" ? value.error_message : null,
          indexed_at: typeof value.indexed_at === "string" ? value.indexed_at : null,
          updated_at:
            typeof value.updated_at === "string"
              ? value.updated_at
              : typeof value.added_at === "string"
                ? value.added_at
                : null
        } satisfies DocRecord;
      })
      .filter((item): item is DocRecord => item !== null);
  } catch {
    return [];
  }
}

function computeDocsHealth(docs: DocRecord[]): {
  severity: HealthSeverity;
  summary: string;
  details: string[];
} {
  const counts = {
    queued: 0,
    indexing: 0,
    ready: 0,
    failed: 0
  };

  docs.forEach((doc) => {
    counts[doc.status] += 1;
  });

  const failedDocs = docs.filter((doc) => doc.status === "failed");

  const latestIndexedAt = docs
    .filter((doc) => doc.status === "ready")
    .map((doc) => doc.indexed_at ?? doc.updated_at)
    .filter((value): value is string => typeof value === "string")
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;

  const details = [
    `Total docs: ${docs.length}`,
    `Queued: ${counts.queued}`,
    `Indexing: ${counts.indexing}`,
    `Ready: ${counts.ready}`,
    `Failed: ${counts.failed}`,
    `Last indexed: ${formatDateTime(latestIndexedAt)}`
  ];

  if (failedDocs.length > 0) {
    failedDocs.slice(0, 5).forEach((doc) => {
      const message = doc.error_message ? doc.error_message.slice(0, 120) : "Indexing failed";
      details.push(`Failed: ${doc.filename} — ${message}`);
    });
  }

  if (docs.length === 0) {
    return {
      severity: "yellow",
      summary: "No docs uploaded yet.",
      details
    };
  }

  if (counts.failed > 0 && counts.failed === docs.length) {
    return {
      severity: "red",
      summary: "All uploaded docs are failing indexing.",
      details
    };
  }

  if (counts.failed > 0 || counts.queued > 0 || counts.indexing > 0) {
    return {
      severity: "yellow",
      summary: "Docs need attention or are still processing.",
      details
    };
  }

  return {
    severity: "green",
    summary: "Docs indexed and ready.",
    details
  };
}

function parseGmailPayload(input: unknown): GmailConnectionPayload {
  if (!input || typeof input !== "object") {
    return { status: "disconnected", last_verified_at: null, updated_at: null };
  }

  const payload = input as Record<string, unknown>;
  const status = payload.status;
  const parsedStatus: GmailStatus =
    status === "connected" || status === "reconnect_required" ? status : "disconnected";

  return {
    status: parsedStatus,
    last_verified_at:
      typeof payload.last_verified_at === "string" ? payload.last_verified_at : null,
    updated_at: typeof payload.updated_at === "string" ? payload.updated_at : null
  };
}

function parseDocsPayload(input: unknown): DocRecord[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const value = item as Record<string, unknown>;
      const status = value.status;

      if (
        status !== "queued" &&
        status !== "indexing" &&
        status !== "ready" &&
        status !== "failed"
      ) {
        return null;
      }

      return {
        id: String(value.id ?? ""),
        filename: String(value.filename ?? "Untitled document"),
        status,
        error_message: typeof value.error_message === "string" ? value.error_message : null,
        indexed_at: typeof value.indexed_at === "string" ? value.indexed_at : null,
        updated_at: typeof value.updated_at === "string" ? value.updated_at : null
      } satisfies DocRecord;
    })
    .filter((item): item is DocRecord => item !== null);
}

function mapGmailHealth(connection: GmailConnectionPayload): {
  severity: HealthSeverity;
  summary: string;
  details: string[];
} {
  if (connection.status === "connected") {
    return {
      severity: "green",
      summary: "Gmail is connected and can create drafts.",
      details: [
        `Last verified: ${formatDateTime(connection.last_verified_at)}`,
        `Updated: ${formatDateTime(connection.updated_at)}`
      ]
    };
  }

  if (connection.status === "reconnect_required") {
    return {
      severity: "yellow",
      summary: "Reconnect required to continue generating drafts.",
      details: [
        `Last verified: ${formatDateTime(connection.last_verified_at)}`,
        `Updated: ${formatDateTime(connection.updated_at)}`,
        "Action: reconnect Gmail in onboarding to restore access."
      ]
    };
  }

  return {
    severity: "red",
    summary: "Gmail is disconnected.",
    details: [
      `Last verified: ${formatDateTime(connection.last_verified_at)}`,
      `Updated: ${formatDateTime(connection.updated_at)}`,
      "Action: connect Gmail in onboarding before enabling drafts."
    ]
  };
}

export default function SystemHealthPage() {
  const [isHydrated, setIsHydrated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [gmailConnection, setGmailConnection] = useState<GmailConnectionPayload>({
    status: "disconnected",
    last_verified_at: null,
    updated_at: null
  });
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [draftsEnabled, setDraftsEnabled] = useState(false);

  const realMode = Boolean(API_BASE_URL && API_TENANT_ID);

  const loadHealth = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const localDraftsEnabled = window.localStorage.getItem(DRAFTS_ENABLED_STORAGE_KEY) === "true";
      setDraftsEnabled(localDraftsEnabled);

      if (!realMode) {
        const localGmailState = window.localStorage.getItem(GMAIL_CONNECTION_STATE_KEY);
        const localLastVerified = window.localStorage.getItem(GMAIL_LAST_VERIFIED_KEY);
        const localDocs = parseDocsFromStorage(window.localStorage.getItem(DOCS_STORAGE_KEY));

        setGmailConnection({
          status:
            localGmailState === "connected" || localGmailState === "reconnect_required"
              ? localGmailState
              : "disconnected",
          last_verified_at: localLastVerified,
          updated_at: new Date().toISOString()
        });
        setDocs(localDocs);
        setLastUpdated(new Date().toISOString());
        return;
      }

      const headers = { "x-tenant-id": API_TENANT_ID as string };
      const [gmailResponse, docsResponse] = await Promise.all([
        fetch(new URL("/v1/mail/gmail/connection", API_BASE_URL).toString(), { headers }),
        fetch(new URL("/v1/docs", API_BASE_URL).toString(), { headers })
      ]);

      if (!gmailResponse.ok) {
        throw new Error(`Gmail health request failed (${gmailResponse.status})`);
      }

      if (!docsResponse.ok) {
        throw new Error(`Docs health request failed (${docsResponse.status})`);
      }

      const gmailPayload = parseGmailPayload(await gmailResponse.json());
      const docsPayload = parseDocsPayload(await docsResponse.json());

      setGmailConnection(gmailPayload);
      setDocs(docsPayload);
      setLastUpdated(new Date().toISOString());
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to refresh system health right now."
      );
    } finally {
      setIsLoading(false);
    }
  }, [realMode]);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    void loadHealth();
  }, [isHydrated, loadHealth]);

  const gmailHealth = useMemo(() => mapGmailHealth(gmailConnection), [gmailConnection]);
  const docsHealth = useMemo(() => computeDocsHealth(docs), [docs]);

  const draftsHealth = useMemo(() => {
    if (draftsEnabled) {
      return {
        severity: "green" as HealthSeverity,
        summary: "Draft creation is enabled.",
        details: [
          "Drafts are created in Gmail as drafts only. We never auto-send.",
          "You can disable drafts anytime in onboarding."
        ]
      };
    }

    return {
      severity: "yellow" as HealthSeverity,
      summary: "Draft creation is not enabled yet.",
      details: [
        "Drafts are created in Gmail as drafts only. We never auto-send.",
        "Complete prerequisites in onboarding and enable drafts when ready."
      ]
    };
  }, [draftsEnabled]);

  const notificationsHealth = {
    severity: "yellow" as HealthSeverity,
    summary: "Notifications health not wired yet.",
    details: [
      "This card will monitor Gmail push notifications and last received event time.",
      "Current status is a placeholder until notification telemetry is connected."
    ]
  };

  return (
    <div className="page">
      <div className="health-header">
        <div>
          <h1>System Health</h1>
          <p>Trust view for Gmail connectivity, docs indexing, draft readiness, and notifications.</p>
        </div>
        <button onClick={() => void loadHealth()} disabled={isLoading}>
          {isLoading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {!realMode && (
        <div className="health-banner" role="status">
          System Health is in offline/demo mode. Set NEXT_PUBLIC_API_BASE_URL and
          NEXT_PUBLIC_TENANT_ID to enable real health checks.
        </div>
      )}

      {errorMessage && (
        <div className="health-banner health-banner-error" role="alert">
          {errorMessage}
        </div>
      )}

      <p className="health-updated">Last updated: {formatDateTime(lastUpdated)}</p>

      <section className="health-grid" aria-label="System health cards">
        <article className="health-card">
          <div className="health-card-header">
            <h2>Gmail Connection</h2>
            <span className={`health-chip health-chip-${gmailHealth.severity}`}>
              {gmailHealth.severity === "green"
                ? "Green"
                : gmailHealth.severity === "yellow"
                  ? "Yellow"
                  : "Red"}
            </span>
          </div>
          <p>{gmailHealth.summary}</p>
          <details>
            <summary>Details</summary>
            <ul>
              {gmailHealth.details.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </details>
        </article>

        <article className="health-card">
          <div className="health-card-header">
            <h2>Knowledge Docs / Index</h2>
            <span className={`health-chip health-chip-${docsHealth.severity}`}>
              {docsHealth.severity === "green"
                ? "Green"
                : docsHealth.severity === "yellow"
                  ? "Yellow"
                  : "Red"}
            </span>
          </div>
          <p>{docsHealth.summary}</p>
          <details>
            <summary>Details</summary>
            <ul>
              {docsHealth.details.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <Link className="health-link" href="/docs">
              Go to Docs
            </Link>
          </details>
        </article>

        <article className="health-card">
          <div className="health-card-header">
            <h2>Drafts Enabled</h2>
            <span className={`health-chip health-chip-${draftsHealth.severity}`}>
              {draftsHealth.severity === "green" ? "Green" : "Yellow"}
            </span>
          </div>
          <p>{draftsHealth.summary}</p>
          <details>
            <summary>Details</summary>
            <ul>
              {draftsHealth.details.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <Link className="health-link" href="/onboarding">
              Go to Onboarding - Enable Drafts
            </Link>
          </details>
        </article>

        <article className="health-card">
          <div className="health-card-header">
            <h2>Notifications</h2>
            <span className="health-chip health-chip-yellow">Yellow</span>
          </div>
          <p>{notificationsHealth.summary}</p>
          <details>
            <summary>Details</summary>
            <ul>
              {notificationsHealth.details.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </details>
        </article>
      </section>
    </div>
  );
}
