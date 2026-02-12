"use client";

import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "onboarding_step";
const GMAIL_CONNECTION_STATE_KEY = "gmail_connection_state";
const GMAIL_LAST_VERIFIED_KEY = "gmail_last_verified";

type GmailConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error"
  | "reconnect_required";

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

export default function OnboardingPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const [gmailConnectionState, setGmailConnectionState] =
    useState<GmailConnectionState>("disconnected");
  const [lastVerifiedAt, setLastVerifiedAt] = useState<string | null>(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [simulateTestFailure, setSimulateTestFailure] = useState(false);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const step = steps[currentStep];
  const isFinalStep = currentStep === steps.length - 1;
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

  useEffect(() => {
    const storedConnectionState = window.localStorage.getItem(GMAIL_CONNECTION_STATE_KEY);
    const storedLastVerified = window.localStorage.getItem(GMAIL_LAST_VERIFIED_KEY);
    setGmailConnectionState(parseConnectionState(storedConnectionState));
    setLastVerifiedAt(storedLastVerified);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(GMAIL_CONNECTION_STATE_KEY, gmailConnectionState);
  }, [gmailConnectionState]);

  useEffect(() => {
    if (lastVerifiedAt) {
      window.localStorage.setItem(GMAIL_LAST_VERIFIED_KEY, lastVerifiedAt);
      return;
    }

    window.localStorage.removeItem(GMAIL_LAST_VERIFIED_KEY);
  }, [lastVerifiedAt]);

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
            <button type="button" onClick={testConnection} disabled={isTestingConnection}>
              {isTestingConnection ? "Testing..." : "Test connection"}
            </button>
            <button type="button" onClick={disconnectGmail}>
              Disconnect
            </button>
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
          <button type="button" onClick={beginConnectFlow}>
            Reconnect Gmail
          </button>
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
            <button type="button" onClick={beginConnectFlow}>
              Try again
            </button>
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
        <button type="button" onClick={beginConnectFlow}>
          Connect Gmail
        </button>
      </div>
    );
  };

  const renderStepContent = () => {
    if (step.title !== "Connect Gmail") {
      return <div className="onboarding-placeholder">{step.placeholder}</div>;
    }

    return (
      <>
        {renderConnectPanel()}
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
