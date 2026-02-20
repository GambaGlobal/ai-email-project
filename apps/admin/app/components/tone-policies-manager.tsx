"use client";

import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "operator_tone_policies_v1";
const MAX_BULLETS = 6;

const PRESETS = [
  { id: "professional_concise", label: "Professional & concise" },
  { id: "warm_welcoming", label: "Warm & welcoming" },
  { id: "friendly_expert_guide", label: "Friendly expert guide" },
  { id: "luxury_concierge", label: "Luxury concierge" }
] as const;

type PresetId = (typeof PRESETS)[number]["id"];

type ToneSliders = {
  formality: number;
  warmth: number;
  brevity: number;
  confidence: number;
};

type EscalationPolicies = {
  refunds_and_cancellations: boolean;
  safety_and_emergencies: boolean;
  medical: boolean;
  legal_threats: boolean;
  exceptions_to_policy: boolean;
};

type TonePoliciesConfig = {
  tone: {
    preset_id: PresetId;
    sliders: ToneSliders;
    dos: string[];
    donts: string[];
  };
  policies: EscalationPolicies;
};

const DEFAULT_CONFIG: TonePoliciesConfig = {
  tone: {
    preset_id: "professional_concise",
    sliders: {
      formality: 72,
      warmth: 45,
      brevity: 70,
      confidence: 62
    },
    dos: [
      "Confirm dates and inclusions clearly.",
      "Use concise next steps for the guest."
    ],
    donts: ["Do not overpromise availability.", "Do not provide legal or medical advice."]
  },
  policies: {
    refunds_and_cancellations: true,
    safety_and_emergencies: true,
    medical: true,
    legal_threats: true,
    exceptions_to_policy: true
  }
};

const PRESET_IDS = PRESETS.map((preset) => preset.id);

function isPresetId(value: unknown): value is PresetId {
  return typeof value === "string" && PRESET_IDS.includes(value as PresetId);
}

function clampSlider(value: unknown, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  return Math.min(100, Math.max(0, Math.round(value)));
}

function sanitizeBulletArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const cleaned = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, MAX_BULLETS);

  return cleaned;
}

function sanitizePolicies(value: unknown): EscalationPolicies {
  if (!value || typeof value !== "object") {
    return DEFAULT_CONFIG.policies;
  }

  const policies = value as Partial<EscalationPolicies>;

  return {
    refunds_and_cancellations:
      typeof policies.refunds_and_cancellations === "boolean"
        ? policies.refunds_and_cancellations
        : DEFAULT_CONFIG.policies.refunds_and_cancellations,
    safety_and_emergencies:
      typeof policies.safety_and_emergencies === "boolean"
        ? policies.safety_and_emergencies
        : DEFAULT_CONFIG.policies.safety_and_emergencies,
    medical: typeof policies.medical === "boolean" ? policies.medical : DEFAULT_CONFIG.policies.medical,
    legal_threats:
      typeof policies.legal_threats === "boolean"
        ? policies.legal_threats
        : DEFAULT_CONFIG.policies.legal_threats,
    exceptions_to_policy:
      typeof policies.exceptions_to_policy === "boolean"
        ? policies.exceptions_to_policy
        : DEFAULT_CONFIG.policies.exceptions_to_policy
  };
}

function sanitizeConfig(value: unknown): TonePoliciesConfig {
  if (!value || typeof value !== "object") {
    return DEFAULT_CONFIG;
  }

  const parsed = value as Partial<TonePoliciesConfig>;
  const parsedTone = parsed.tone;

  if (!parsedTone || typeof parsedTone !== "object") {
    return DEFAULT_CONFIG;
  }

  const parsedSliders = parsedTone.sliders;
  const sanitizedSliders: ToneSliders = {
    formality: clampSlider(parsedSliders?.formality, DEFAULT_CONFIG.tone.sliders.formality),
    warmth: clampSlider(parsedSliders?.warmth, DEFAULT_CONFIG.tone.sliders.warmth),
    brevity: clampSlider(parsedSliders?.brevity, DEFAULT_CONFIG.tone.sliders.brevity),
    confidence: clampSlider(parsedSliders?.confidence, DEFAULT_CONFIG.tone.sliders.confidence)
  };

  return {
    tone: {
      preset_id: isPresetId(parsedTone.preset_id)
        ? parsedTone.preset_id
        : DEFAULT_CONFIG.tone.preset_id,
      sliders: sanitizedSliders,
      dos: sanitizeBulletArray(parsedTone.dos, DEFAULT_CONFIG.tone.dos),
      donts: sanitizeBulletArray(parsedTone.donts, DEFAULT_CONFIG.tone.donts)
    },
    policies: sanitizePolicies(parsed.policies)
  };
}

function getPreviewCopy(presetId: PresetId): string {
  switch (presetId) {
    case "warm_welcoming":
      return "Thanks so much for reaching out. We would love to help you plan a great trip, and I can confirm available dates and next steps for you today.";
    case "friendly_expert_guide":
      return "Great question. Based on your route and timing, I recommend our guided option with the early departure window for the smoothest conditions.";
    case "luxury_concierge":
      return "Thank you for your inquiry. I have prepared a premium itinerary option with private transfers and personalized add-ons for your review.";
    case "professional_concise":
    default:
      return "Thanks for your message. We can support this request and will confirm availability, pricing, and policy details in the next reply.";
  }
}

function BulletEditor({
  title,
  items,
  onChange,
  emptyHint
}: {
  title: string;
  items: string[];
  onChange: (items: string[]) => void;
  emptyHint: string;
}) {
  return (
    <div className="tone-bullet-section">
      <h4>{title}</h4>
      {items.length === 0 ? <p className="tone-helper">{emptyHint}</p> : null}
      <div className="tone-bullets">
        {items.map((item, index) => (
          <div key={`${title}-${index}`} className="tone-bullet-row">
            <input
              type="text"
              value={item}
              onChange={(event) => {
                const next = [...items];
                next[index] = event.target.value;
                onChange(next);
              }}
            />
            <button
              type="button"
              onClick={() => {
                onChange(items.filter((_, itemIndex) => itemIndex !== index));
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={items.length >= MAX_BULLETS}
        onClick={() => {
          onChange([...items, ""]);
        }}
      >
        Add item
      </button>
      <p className="tone-helper">Max {MAX_BULLETS} items.</p>
    </div>
  );
}

export function TonePoliciesManager() {
  const [config, setConfig] = useState<TonePoliciesConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);

    if (!stored) {
      return;
    }

    try {
      const parsed = JSON.parse(stored);
      setConfig(sanitizeConfig(parsed));
    } catch {
      setConfig(DEFAULT_CONFIG);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  const previewDraft = useMemo(() => {
    return getPreviewCopy(config.tone.preset_id);
  }, [config.tone.preset_id]);

  const setSlider = (key: keyof ToneSliders, value: number) => {
    setConfig((current) => ({
      ...current,
      tone: {
        ...current.tone,
        sliders: {
          ...current.tone.sliders,
          [key]: clampSlider(value, current.tone.sliders[key])
        }
      }
    }));
  };

  const setPolicy = (key: keyof EscalationPolicies, value: boolean) => {
    setConfig((current) => ({
      ...current,
      policies: {
        ...current.policies,
        [key]: value
      }
    }));
  };

  return (
    <div className="tone-manager">
      <section className="tone-card">
        <h3>Tone</h3>
        <p className="tone-helper">Choose the default reply style for generated drafts.</p>

        <div className="tone-presets" role="radiogroup" aria-label="Tone presets">
          {PRESETS.map((preset) => (
            <label key={preset.id} className="tone-preset-option">
              <input
                type="radio"
                name="tone-preset"
                value={preset.id}
                checked={config.tone.preset_id === preset.id}
                onChange={() => {
                  setConfig((current) => ({
                    ...current,
                    tone: {
                      ...current.tone,
                      preset_id: preset.id
                    }
                  }));
                }}
              />
              <span>{preset.label}</span>
            </label>
          ))}
        </div>

        <details className="onboarding-dev-controls">
          <summary>Advanced sliders</summary>
          <div className="tone-sliders">
            {(
              [
                ["formality", "Formality"],
                ["warmth", "Warmth"],
                ["brevity", "Brevity"],
                ["confidence", "Confidence"]
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="tone-slider-row">
                <span>{label}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={config.tone.sliders[key]}
                  onChange={(event) => {
                    setSlider(key, Number.parseInt(event.target.value, 10));
                  }}
                />
                <span>{config.tone.sliders[key]}</span>
              </label>
            ))}
          </div>
        </details>

        <div className="tone-bullets-grid">
          <BulletEditor
            title="Do"
            items={config.tone.dos}
            onChange={(items) => {
              setConfig((current) => ({
                ...current,
                tone: {
                  ...current.tone,
                  dos: sanitizeBulletArray(items, [])
                }
              }));
            }}
            emptyHint="Add guidance for what generated replies should do."
          />
          <BulletEditor
            title="Don&apos;t"
            items={config.tone.donts}
            onChange={(items) => {
              setConfig((current) => ({
                ...current,
                tone: {
                  ...current.tone,
                  donts: sanitizeBulletArray(items, [])
                }
              }));
            }}
            emptyHint="Add boundaries for what generated replies should avoid."
          />
        </div>
      </section>

      <section className="tone-card">
        <h3>Escalation Policies</h3>
        <p className="tone-helper">
          Enabled topics are always routed for human review before sending any response.
        </p>
        <div className="policy-list">
          <label>
            <input
              type="checkbox"
              checked={config.policies.refunds_and_cancellations}
              onChange={(event) => {
                setPolicy("refunds_and_cancellations", event.target.checked);
              }}
            />
            Refunds and cancellations
          </label>
          <label>
            <input
              type="checkbox"
              checked={config.policies.safety_and_emergencies}
              onChange={(event) => {
                setPolicy("safety_and_emergencies", event.target.checked);
              }}
            />
            Safety and emergencies
          </label>
          <label>
            <input
              type="checkbox"
              checked={config.policies.medical}
              onChange={(event) => {
                setPolicy("medical", event.target.checked);
              }}
            />
            Medical
          </label>
          <label>
            <input
              type="checkbox"
              checked={config.policies.legal_threats}
              onChange={(event) => {
                setPolicy("legal_threats", event.target.checked);
              }}
            />
            Legal threats
          </label>
          <label>
            <input
              type="checkbox"
              checked={config.policies.exceptions_to_policy}
              onChange={(event) => {
                setPolicy("exceptions_to_policy", event.target.checked);
              }}
            />
            Exceptions to policy
          </label>
        </div>
      </section>

      <section className="tone-card">
        <h3>Preview (mock)</h3>
        <p className="tone-helper">This preview is static and for UX testing only.</p>
        <div className="preview-snippet">
          <strong>Sample inbound:</strong>
          <p>
            Hi team, we are a family of four and want to rebook our canyon trip. Can you share
            weekend options and your cancellation policy?
          </p>
        </div>
        <div className="preview-snippet">
          <strong>Sample draft style:</strong>
          <p>{previewDraft}</p>
        </div>
      </section>
    </div>
  );
}
