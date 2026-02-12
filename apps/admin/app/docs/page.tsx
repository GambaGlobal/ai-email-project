export default function DocsPage() {
  return (
    <div className="page">
      <h1>Docs</h1>
      <p>
        This page will manage knowledge uploads and ingestion visibility for operator documents.
      </p>

      <section className="placeholder-grid" aria-label="Docs placeholders">
        <article className="placeholder-card">
          <h2>Upload area</h2>
          <ul>
            <li>Drag-and-drop upload placeholder</li>
            <li>Doc category selector placeholder</li>
          </ul>
        </article>
        <article className="placeholder-card">
          <h2>Document list</h2>
          <ul>
            <li>Indexed/processing/failed status list placeholder</li>
            <li>Retry actions placeholder</li>
          </ul>
        </article>
      </section>
    </div>
  );
}
