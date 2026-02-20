import { DocsManager } from "../components/docs-manager";

export default function DocsPage() {
  return (
    <div className="page">
      <h1>Docs</h1>
      <p>
        This page will manage knowledge uploads and ingestion visibility for operator documents.
      </p>
      <section className="placeholder-grid" aria-label="Docs manager">
        <article className="placeholder-card">
          <h2>Docs Manager</h2>
          <DocsManager />
        </article>
      </section>
    </div>
  );
}
