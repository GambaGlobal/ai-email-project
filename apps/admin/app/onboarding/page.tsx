export default function OnboardingPage() {
  return (
    <div className="page">
      <h1>Onboarding</h1>
      <p>
        This page will guide operators from profile setup through draft enablement with the minimal
        Phase 9 onboarding sequence.
      </p>

      <section className="placeholder-grid" aria-label="Onboarding placeholders">
        <article className="placeholder-card">
          <h2>Planned wizard steps</h2>
          <ul>
            <li>Operator Profile</li>
            <li>Connect Gmail</li>
            <li>Upload Docs</li>
            <li>Defaults</li>
            <li>Enable Drafts</li>
          </ul>
        </article>
      </section>
    </div>
  );
}
