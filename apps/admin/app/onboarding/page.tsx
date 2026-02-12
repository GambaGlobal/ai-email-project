"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "onboarding_step";

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

function clampStepIndex(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }

  return Math.min(Math.max(value, 0), steps.length - 1);
}

export default function OnboardingPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const step = steps[currentStep];
  const isFinalStep = currentStep === steps.length - 1;

  useEffect(() => {
    const storedStep = window.localStorage.getItem(STORAGE_KEY);

    if (storedStep !== null) {
      setCurrentStep(clampStepIndex(Number.parseInt(storedStep, 10)));
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, String(currentStep));
  }, [currentStep]);

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
          <div className="onboarding-placeholder">{step.placeholder}</div>
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
