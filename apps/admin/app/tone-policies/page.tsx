import { TonePoliciesManager } from "../components/tone-policies-manager";

export default function TonePoliciesPage() {
  return (
    <div className="page">
      <h1>Tone &amp; Policies</h1>
      <p>
        This page will define tone presets, operator do/don&apos;t guidance, and escalation policy
        defaults.
      </p>

      <section className="placeholder-grid" aria-label="Tone and policies manager">
        <article className="placeholder-card">
          <h2>Tone &amp; Policies Manager</h2>
          <TonePoliciesManager />
        </article>
      </section>
    </div>
  );
}
