export default function SystemHealthPage() {
  return (
    <div className="page">
      <h1>System Health</h1>
      <p>
        This page will show trust-critical status for Gmail, notifications, knowledge indexing, and
        draft generation.
      </p>

      <section className="placeholder-grid" aria-label="System health placeholders">
        <article className="placeholder-card">
          <h2>R/Y/G cards</h2>
          <ul>
            <li>Gmail connection status placeholder</li>
            <li>Notifications status placeholder</li>
            <li>Knowledge index status placeholder</li>
            <li>Draft generation status placeholder</li>
          </ul>
        </article>
        <article className="placeholder-card">
          <h2>Diagnostics drawer</h2>
          <ul>
            <li>Last processed timestamps placeholder</li>
            <li>Failure categories placeholder</li>
            <li>Correlation ID placeholder</li>
          </ul>
        </article>
      </section>
    </div>
  );
}
