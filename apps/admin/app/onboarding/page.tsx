"use client";

import { useEffect, useRef, useState } from "react";
import { DocsManager } from "../components/docs-manager";
import { TonePoliciesManager } from "../components/tone-policies-manager";
import { DEFAULT_DEV_TENANT_ID } from "../lib/dev-config";

const STORAGE_KEY = "onboarding_step";
const GMAIL_CONNECTION_STATE_KEY = "gmail_connection_state";
const GMAIL_LAST_VERIFIED_KEY = "gmail_last_verified";
const DOCS_STORAGE_KEY = "operator_docs_v1";
const TONE_POLICIES_STORAGE_KEY = "operator_tone_policies_v1";
const DRAFTS_ENABLED_STORAGE_KEY = "operator_drafts_enabled_v1";
// Optional admin env wiring for real OAuth connect:
// NEXT_PUBLIC_API_BASE_URL and NEXT_PUBLIC_TENANT_ID.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;
const API_TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? DEFAULT_DEV_TENANT_ID;

const CONNECT_GMAIL_STEP_INDEX = 1;
const UPLOAD_DOCS_STEP_INDEX = 2;

type GmailConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error"
  | "reconnect_required";

type PrerequisiteState = {
  gmailConnected: boolean;
  hasReadyDoc: boolean;
  tonePoliciesConfigured: boolean;
  tonePoliciesUsingDefaults: boolean;
};

const steps = [
  {
    title: "Operator Profile",
    description: "This step will collect operator name, timezone, and primary contact details.",
    placeholder: "Profile form fields will go here."
  },
  {
    title: "Connect Gmail",
    description: "This step will guide OAuth connection and mailbox access verification.",
    placeholder: "Gmail connection controls will go here."
  },
  {
    title: "Upload Docs",
    description:
      "This step will upload knowledge docs and show indexing status once ingestion is wired.",
    placeholder: "Inputs will go here."
  },
  {
    title: "Defaults",
    description:
      "This step will configure tone presets and escalation rules once settings are connected.",
    placeholder: "Inputs will go here."
  },
  {
    title: "Enable Drafts",
    description: "This step will confirm readiness and enable draft generation.",
    placeholder: "Draft enablement summary and control will go here."
  }
];

const validConnectionStates: GmailConnectionState[] = [
  "disconnected",
  "connecting",
  "connected",
  "error",
  "reconnect_required"
];

const validTonePresetIds = [
  "professional_concise",
  "warm_welcoming",
  "friendly_expert_guide",
  "luxury_concierge"
] as const;

function clampStepIndex(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }

  return Math.min(Math.max(value, 0), steps.length - 1);
}

function parseConnectionState(value: string | null): GmailConnectionState {
  if (value && validConnectionStates.includes(value as GmailConnectionState)) {
    return value as GmailConnectionState;
  }

  return "disconnected";
}

function formatLastVerified(value: string | null): string {
  if (!value) {
    return "—";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }

  return parsed.toLocaleString();
}

function hasReadyDoc(value: string | null): boolean {
  if (!value) {
    return false;
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return false;
    }

    return parsed.some((entry) => {
      if (!entry || typeof entry !== "object") {
        return false;
      }

      return (entry as { status?: unknown }).status === "ready";
    });
  } catch {
    return false;
  }
}

function parseTonePoliciesState(value: string | null): {
  tonePoliciesConfigured: boolean;
  tonePoliciesUsingDefaults: boolean;
} {
  if (!value) {
    return { tonePoliciesConfigured: true, tonePoliciesUsingDefaults: true };
  }

  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") {
      return { tonePoliciesConfigured: true, tonePoliciesUsingDefaults: true };
    }

    const tone = (parsed as { tone?: unknown }).tone;
    const presetId =
      tone && typeof tone === "object"
        ? (tone as { preset_id?: unknown }).preset_id
        : undefined;

    const isValidPreset =
      typeof presetId === "string" &&
      validTonePresetIds.includes(presetId as (typeof validTonePresetIds)[number]);

    return {
      tonePoliciesConfigured: true,
      tonePoliciesUsingDefaults: !isValidPreset
    };
  } catch {
    return { tonePoliciesConfigured: true, tonePoliciesUsingDefaults: true };
  }
}

export default function OnboardingPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const [gmailConnectionState, setGmailConnectionState] =
    useState<GmailConnectionState>("disconnected");
  const [lastVerifiedAt, setLastVerifiedAt] = useState<string | null>(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [simulateTestFailure, setSimulateTestFailure] = useState(false);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [isRefreshingRealStatus, setIsRefreshingRealStatus] = useState(false);
  const [draftsEnabled, setDraftsEnabled] = useState(false);
  const [prerequisites, setPrerequisites] = useState<PrerequisiteState>({
    gmailConnected: false,
    hasReadyDoc: false,
    tonePoliciesConfigured: true,
    tonePoliciesUsingDefaults: true
  });
  const step = steps[currentStep];
  const isFinalStep = currentStep === steps.length - 1;
  const hasTenantIdForRealApi = Boolean(API_TENANT_ID);
  const connectTimeoutRef = useRef<number | null>(null);
  const testTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const storedStep = window.localStorage.getItem(STORAGE_KEY);

    if (storedStep !== null) {
      setCurrentStep(clampStepIndex(Number.parseInt(storedStep, 10)));
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, String(currentStep));
  }, [currentStep]);

  const refreshDraftSignals = () => {
    const gmailState = window.localStorage.getItem(GMAIL_CONNECTION_STATE_KEY);
    const docsState = window.localStorage.getItem(DOCS_STORAGE_KEY);
    const tonePoliciesState = window.localStorage.getItem(TONE_POLICIES_STORAGE_KEY);
    const draftsState = window.localStorage.getItem(DRAFTS_ENABLED_STORAGE_KEY);
    const tonePoliciesParsed = parseTonePoliciesState(tonePoliciesState);

    setPrerequisites({
      gmailConnected: gmailState === "connected",
      hasReadyDoc: hasReadyDoc(docsState),
      tonePoliciesConfigured: tonePoliciesParsed.tonePoliciesConfigured,
      tonePoliciesUsingDefaults: tonePoliciesParsed.tonePoliciesUsingDefaults
    });
    setDraftsEnabled(draftsState === "true");
  };

  useEffect(() => {
    const storedConnectionState = window.localStorage.getItem(GMAIL_CONNECTION_STATE_KEY);
    const storedLastVerified = window.localStorage.getItem(GMAIL_LAST_VERIFIED_KEY);
    setGmailConnectionState(parseConnectionState(storedConnectionState));
    setLastVerifiedAt(storedLastVerified);
    refreshDraftSignals();
  }, []);

  useEffect(() => {
    window.localStorage.setItem(GMAIL_CONNECTION_STATE_KEY, gmailConnectionState);
    refreshDraftSignals();
  }, [gmailConnectionState]);

  useEffect(() => {
    if (lastVerifiedAt) {
      window.localStorage.setItem(GMAIL_LAST_VERIFIED_KEY, lastVerifiedAt);
      return;
    }

    window.localStorage.removeItem(GMAIL_LAST_VERIFIED_KEY);
  }, [lastVerifiedAt]);

  useEffect(() => {
    refreshDraftSignals();
  }, [currentStep]);

  useEffect(() => {
    return () => {
      if (connectTimeoutRef.current !== null) {
        window.clearTimeout(connectTimeoutRef.current);
      }

      if (testTimeoutRef.current !== null) {
        window.clearTimeout(testTimeoutRef.current);
      }
    };
  }, []);

  const goNext = () => {
    if (!isFinalStep) {
      setCurrentStep((previousStep) => clampStepIndex(previousStep + 1));
    }
  };

  const goBack = () => {
    setCurrentStep((previousStep) => clampStepIndex(previousStep - 1));
  };

  const restart = () => {
    window.localStorage.removeItem(STORAGE_KEY);
    setCurrentStep(0);
  };

  const setDraftEnabledState = (enabled: boolean) => {
    if (enabled) {
      window.localStorage.setItem(DRAFTS_ENABLED_STORAGE_KEY, "true");
      setDraftsEnabled(true);
      return;
    }

    window.localStorage.setItem(DRAFTS_ENABLED_STORAGE_KEY, "false");
    setDraftsEnabled(false);
  };

  const beginConnectFlow = () => {
    if (connectTimeoutRef.current !== null) {
      window.clearTimeout(connectTimeoutRef.current);
    }

    setShowErrorDetails(false);
    setGmailConnectionState("connecting");
    connectTimeoutRef.current = window.setTimeout(() => {
      setGmailConnectionState("connected");
    }, 1000);
  };

  const disconnectGmail = () => {
    if (connectTimeoutRef.current !== null) {
      window.clearTimeout(connectTimeoutRef.current);
    }

    if (testTimeoutRef.current !== null) {
      window.clearTimeout(testTimeoutRef.current);
    }

    setIsTestingConnection(false);
    setShowErrorDetails(false);
    setGmailConnectionState("disconnected");
    setLastVerifiedAt(null);
  };

  const setMockConnectionState = (state: GmailConnectionState) => {
    if (connectTimeoutRef.current !== null) {
      window.clearTimeout(connectTimeoutRef.current);
    }

    if (testTimeoutRef.current !== null) {
      window.clearTimeout(testTimeoutRef.current);
    }

    setIsTestingConnection(false);
    setShowErrorDetails(false);
    setGmailConnectionState(state);
  };

  const testConnection = () => {
    if (gmailConnectionState !== "connected") {
      return;
    }

    if (testTimeoutRef.current !== null) {
      window.clearTimeout(testTimeoutRef.current);
    }

    setIsTestingConnection(true);
    testTimeoutRef.current = window.setTimeout(() => {
      if (simulateTestFailure) {
        setGmailConnectionState("error");
        setShowErrorDetails(true);
      } else {
        setLastVerifiedAt(new Date().toISOString());
      }

      setIsTestingConnection(false);
    }, 900);
  };

  const refreshRealConnectionStatus = async () => {
    if (!API_BASE_URL || !API_TENANT_ID) {
      return;
    }

    setIsRefreshingRealStatus(true);
    setShowErrorDetails(false);

    try {
      const statusUrl = new URL("/v1/mail/gmail/connection", API_BASE_URL);

      const response = await fetch(statusUrl.toString(), {
        method: "GET",
        headers: {
          "x-tenant-id": API_TENANT_ID
        }
      });

      if (!response.ok) {
        throw new Error(`Status request failed with ${response.status}`);
      }

      const payload = (await response.json()) as {
        status?: "connected" | "disconnected" | "reconnect_required";
        last_verified_at?: string | null;
      };

      const normalizedState =
        payload.status === "connected" ||
        payload.status === "reconnect_required" ||
        payload.status === "disconnected"
          ? payload.status
          : "disconnected";

      setGmailConnectionState(normalizedState);

      if (payload.last_verified_at) {
        setLastVerifiedAt(payload.last_verified_at);
      } else {
        setLastVerifiedAt(null);
      }
    } catch (error) {
      setGmailConnectionState("error");
      setShowErrorDetails(true);
      // eslint-disable-next-line no-console
      console.error(error);
    } finally {
      setIsRefreshingRealStatus(false);
    }
  };

  const startRealConnectFlow = () => {
    if (!API_BASE_URL || !API_TENANT_ID) {
      return;
    }

    const startUrl = new URL("/v1/auth/gmail/start", API_BASE_URL);
    startUrl.searchParams.set("tenant_id", API_TENANT_ID);
    startUrl.searchParams.set("return_to", "/onboarding");
    window.location.assign(startUrl.toString());
  };

  const renderConnectPanel = () => {
    const lastVerifiedLabel = formatLastVerified(lastVerifiedAt);

    if (gmailConnectionState === "connecting") {
      return (
        <div className="gmail-panel">
          <button type="button" disabled>
            Connecting...
          </button>
          <div className="gmail-progress" aria-hidden="true" />
          <p className="gmail-helper">Connecting your Gmail account now.</p>
        </div>
      );
    }

    if (gmailConnectionState === "connected") {
      return (
        <div className="gmail-panel">
          <span className="status-badge status-connected">Connected</span>
          <p className="gmail-helper">
            Gmail is connected. You can verify draft permissions before continuing.
          </p>
          <p className="gmail-helper">
            <strong>Last verified:</strong> {lastVerifiedLabel}
          </p>
          <div className="onboarding-actions">
            {API_BASE_URL ? (
              <button
                type="button"
                onClick={refreshRealConnectionStatus}
                disabled={isRefreshingRealStatus || !hasTenantIdForRealApi}
              >
                {isRefreshingRealStatus ? "Refreshing..." : "Refresh status"}
              </button>
            ) : (
              <>
                <button type="button" onClick={testConnection} disabled={isTestingConnection}>
                  {isTestingConnection ? "Testing..." : "Test connection"}
                </button>
                <button type="button" onClick={disconnectGmail}>
                  Disconnect
                </button>
              </>
            )}
          </div>
        </div>
      );
    }

    if (gmailConnectionState === "reconnect_required") {
      return (
        <div className="gmail-panel">
          <span className="status-badge status-reconnect">Reconnect required</span>
          <p className="gmail-helper">
            Access expired. Reconnect Gmail to continue generating drafts.
          </p>
          {API_BASE_URL ? (
            <div className="onboarding-actions">
              <button type="button" onClick={startRealConnectFlow} disabled={!hasTenantIdForRealApi}>
                Reconnect Gmail (real)
              </button>
              <button
                type="button"
                onClick={refreshRealConnectionStatus}
                disabled={isRefreshingRealStatus || !hasTenantIdForRealApi}
              >
                {isRefreshingRealStatus ? "Refreshing..." : "Refresh status"}
              </button>
            </div>
          ) : (
            <button type="button" onClick={beginConnectFlow}>
              Reconnect Gmail
            </button>
          )}
        </div>
      );
    }

    if (gmailConnectionState === "error") {
      return (
        <div className="gmail-panel">
          <span className="status-badge status-error">Connection error</span>
          <p className="gmail-helper">
            We could not verify Gmail access. Please try again in a moment.
          </p>
          <div className="onboarding-actions">
            {API_BASE_URL ? (
              <button type="button" onClick={startRealConnectFlow} disabled={!hasTenantIdForRealApi}>
                Try again (real)
              </button>
            ) : (
              <button type="button" onClick={beginConnectFlow}>
                Try again
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setShowErrorDetails((value) => !value);
              }}
            >
              View details
            </button>
          </div>
          {showErrorDetails ? (
            <pre className="gmail-error-details">
              {`Mock error code: GMAIL_OAUTH_REFRESH_FAILED
Detail: Token refresh rejected in OAuth callback simulation.`}
            </pre>
          ) : null}
        </div>
      );
    }

    return (
      <div className="gmail-panel">
        <p className="gmail-helper">
          Connect Gmail so we can read thread context and create drafts in Gmail. We never
          auto-send.
        </p>
        {API_BASE_URL ? (
          <div className="onboarding-actions">
            <button type="button" onClick={startRealConnectFlow} disabled={!hasTenantIdForRealApi}>
              Connect Gmail (real)
            </button>
            <button
              type="button"
              onClick={refreshRealConnectionStatus}
              disabled={isRefreshingRealStatus || !hasTenantIdForRealApi}
            >
              {isRefreshingRealStatus ? "Refreshing..." : "Refresh status"}
            </button>
          </div>
        ) : (
          <button type="button" onClick={beginConnectFlow}>
            Connect Gmail
          </button>
        )}
      </div>
    );
  };

  const renderStepContent = () => {
    if (step.title === "Upload Docs") {
      return <DocsManager />;
    }

    if (step.title === "Defaults") {
      return <TonePoliciesManager />;
    }

    if (step.title === "Enable Drafts") {
      const canEnable = prerequisites.gmailConnected && prerequisites.hasReadyDoc;

      return (
        <div className="drafts-gating">
          <ul className="drafts-checklist">
            <li>
              <span
                className={`drafts-check ${
                  prerequisites.gmailConnected ? "drafts-check-pass" : "drafts-check-fail"
                }`}
              >
                {prerequisites.gmailConnected ? "Pass" : "Missing"}
              </span>
              Gmail connected
            </li>
            <li>
              <span
                className={`drafts-check ${
                  prerequisites.hasReadyDoc ? "drafts-check-pass" : "drafts-check-fail"
                }`}
              >
                {prerequisites.hasReadyDoc ? "Pass" : "Missing"}
              </span>
              At least one doc indexed/ready
            </li>
            <li>
              <span
                className={`drafts-check ${
                  prerequisites.tonePoliciesConfigured ? "drafts-check-pass" : "drafts-check-fail"
                }`}
              >
                {prerequisites.tonePoliciesConfigured ? "Pass" : "Missing"}
              </span>
              Tone &amp; policies configured
              {prerequisites.tonePoliciesUsingDefaults ? (
                <span className="drafts-inline-note"> (using defaults)</span>
              ) : null}
            </li>
          </ul>

          <p className="onboarding-note">
            Drafts are created in Gmail as drafts only. We never auto-send.
          </p>

          {draftsEnabled ? (
            <div className="drafts-enabled-state">
              <span className="status-badge status-connected">Drafts enabled</span>
              <p className="gmail-helper">You can disable this anytime.</p>
              <button type="button" onClick={() => setDraftEnabledState(false)}>
                Disable drafts
              </button>
            </div>
          ) : (
            <div className="drafts-disabled-state">
              <button type="button" disabled={!canEnable} onClick={() => setDraftEnabledState(true)}>
                Enable drafts
              </button>
              {!canEnable ? (
                <div className="drafts-next-actions">
                  <p className="gmail-helper">Complete missing prerequisites first:</p>
                  {!prerequisites.gmailConnected ? (
                    <button
                      type="button"
                      onClick={() => {
                        setCurrentStep(CONNECT_GMAIL_STEP_INDEX);
                      }}
                    >
                      Go to Connect Gmail
                    </button>
                  ) : null}
                  {!prerequisites.hasReadyDoc ? (
                    <button
                      type="button"
                      onClick={() => {
                        setCurrentStep(UPLOAD_DOCS_STEP_INDEX);
                      }}
                    >
                      Go to Upload Docs
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </div>
      );
    }

    if (step.title !== "Connect Gmail") {
      return <div className="onboarding-placeholder">{step.placeholder}</div>;
    }

    return (
      <>
        {renderConnectPanel()}
        {!API_BASE_URL ? (
          <details className="onboarding-dev-controls">
            <summary>Developer controls (UX mock only)</summary>
            <div className="onboarding-dev-actions">
              <button type="button" onClick={() => setMockConnectionState("reconnect_required")}>
                Simulate reconnect required
              </button>
              <button type="button" onClick={() => setMockConnectionState("error")}>
                Simulate error
              </button>
              <button type="button" onClick={() => setMockConnectionState("connected")}>
                Simulate success
              </button>
              <label className="simulate-toggle">
                <input
                  type="checkbox"
                  checked={simulateTestFailure}
                  onChange={(event) => {
                    setSimulateTestFailure(event.target.checked);
                  }}
                />
                Simulate failure on next test
              </label>
            </div>
          </details>
        ) : null}
        {API_BASE_URL && !hasTenantIdForRealApi ? (
          <p className="onboarding-note">
            Set NEXT_PUBLIC_TENANT_ID to enable real connection status checks.
          </p>
        ) : null}
        <p className="onboarding-note">
          Drafts are created in Gmail as drafts only. We never auto-send.
        </p>
      </>
    );
  };

  return (
    <div className="page">
      <h1>Onboarding</h1>
      <p>
        This wizard will guide operators from profile setup through draft enablement for the Phase
        9 onboarding flow.
      </p>

      <section className="onboarding-wizard" aria-label="Onboarding wizard">
        <ol className="onboarding-stepper">
          {steps.map((item, index) => {
            const state =
              index < currentStep ? "completed" : index === currentStep ? "current" : "upcoming";

            return (
              <li key={item.title}>
                <button
                  type="button"
                  className="onboarding-step"
                  data-state={state}
                  onClick={() => {
                    if (index <= currentStep) {
                      setCurrentStep(index);
                    }
                  }}
                  disabled={index > currentStep}
                >
                  <span className="onboarding-step-index">{index + 1}</span>
                  <span>{item.title}</span>
                </button>
              </li>
            );
          })}
        </ol>

        <article className="placeholder-card onboarding-panel" aria-live="polite">
          <h2>{step.title}</h2>
          <p>{step.description}</p>
          {renderStepContent()}
          <div className="onboarding-actions">
            <button type="button" onClick={goBack} disabled={currentStep === 0}>
              Back
            </button>
            <button type="button" onClick={goNext} disabled={isFinalStep}>
              {isFinalStep ? "Finish (Coming soon)" : "Next"}
            </button>
          </div>
          <button type="button" className="onboarding-restart" onClick={restart}>
            Restart onboarding
          </button>
        </article>
      </section>
    </div>
  );
}
