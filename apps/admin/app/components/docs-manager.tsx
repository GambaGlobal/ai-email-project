"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const DOCS_STORAGE_KEY = "operator_docs_v1";

const DOC_CATEGORIES = ["Policies", "Itineraries", "FAQs", "Packing"] as const;
const DOC_STATUSES = ["queued", "indexing", "ready", "failed"] as const;

type DocCategory = (typeof DOC_CATEGORIES)[number];
type DocStatus = (typeof DOC_STATUSES)[number];

type OperatorDoc = {
  id: string;
  filename: string;
  size: number;
  category: DocCategory;
  status: DocStatus;
  added_at: string;
};

type TimerMap = Record<string, number[]>;

function isValidCategory(value: unknown): value is DocCategory {
  return typeof value === "string" && DOC_CATEGORIES.includes(value as DocCategory);
}

function isValidStatus(value: unknown): value is DocStatus {
  return typeof value === "string" && DOC_STATUSES.includes(value as DocStatus);
}

function isValidDoc(value: unknown): value is OperatorDoc {
  if (!value || typeof value !== "object") {
    return false;
  }

  const doc = value as Partial<OperatorDoc>;

  return (
    typeof doc.id === "string" &&
    doc.id.length > 0 &&
    typeof doc.filename === "string" &&
    doc.filename.length > 0 &&
    typeof doc.size === "number" &&
    Number.isFinite(doc.size) &&
    doc.size >= 0 &&
    isValidCategory(doc.category) &&
    isValidStatus(doc.status) &&
    typeof doc.added_at === "string" &&
    !Number.isNaN(new Date(doc.added_at).getTime())
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function generateDocId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createDocFromFile(file: File): OperatorDoc {
  return {
    id: generateDocId(),
    filename: file.name,
    size: file.size,
    category: "Policies",
    status: "queued",
    added_at: new Date().toISOString()
  };
}

function getStatusClass(status: DocStatus): string {
  switch (status) {
    case "queued":
      return "doc-status doc-status-queued";
    case "indexing":
      return "doc-status doc-status-indexing";
    case "ready":
      return "doc-status doc-status-ready";
    case "failed":
      return "doc-status doc-status-failed";
    default:
      return "doc-status";
  }
}

export function DocsManager() {
  const [docs, setDocs] = useState<OperatorDoc[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [failNextUpload, setFailNextUpload] = useState(false);
  const timersRef = useRef<TimerMap>({});

  const sortedDocs = useMemo(() => {
    return [...docs].sort((left, right) => {
      return new Date(right.added_at).getTime() - new Date(left.added_at).getTime();
    });
  }, [docs]);

  useEffect(() => {
    const storedDocs = window.localStorage.getItem(DOCS_STORAGE_KEY);

    if (!storedDocs) {
      return;
    }

    try {
      const parsed = JSON.parse(storedDocs);
      if (!Array.isArray(parsed)) {
        return;
      }

      const validDocs = parsed.filter(isValidDoc);
      setDocs(validDocs);
    } catch {
      setDocs([]);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(DOCS_STORAGE_KEY, JSON.stringify(docs));
  }, [docs]);

  useEffect(() => {
    return () => {
      Object.values(timersRef.current).forEach((timers) => {
        timers.forEach((timer) => window.clearTimeout(timer));
      });
    };
  }, []);

  const clearTimersForDoc = (docId: string) => {
    const docTimers = timersRef.current[docId] || [];
    docTimers.forEach((timer) => window.clearTimeout(timer));
    delete timersRef.current[docId];
  };

  const runMockTransition = (docId: string, shouldFail: boolean) => {
    clearTimersForDoc(docId);

    const toIndexingTimer = window.setTimeout(() => {
      setDocs((currentDocs) =>
        currentDocs.map((doc) => {
          if (doc.id !== docId || doc.status !== "queued") {
            return doc;
          }

          return { ...doc, status: "indexing" };
        })
      );
    }, 700);

    const toTerminalTimer = window.setTimeout(() => {
      setDocs((currentDocs) =>
        currentDocs.map((doc) => {
          if (doc.id !== docId || doc.status !== "indexing") {
            return doc;
          }

          return { ...doc, status: shouldFail ? "failed" : "ready" };
        })
      );
    }, 1500);

    timersRef.current[docId] = [toIndexingTimer, toTerminalTimer];
  };

  const addFiles = (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }

    const createdDocs = Array.from(files).map(createDocFromFile);
    const shouldFail = failNextUpload;

    setDocs((currentDocs) => [...currentDocs, ...createdDocs]);
    createdDocs.forEach((doc) => runMockTransition(doc.id, shouldFail));
    setFailNextUpload(false);
  };

  const removeDoc = (docId: string) => {
    clearTimersForDoc(docId);
    setDocs((currentDocs) => currentDocs.filter((doc) => doc.id !== docId));
  };

  const updateDocCategory = (docId: string, category: DocCategory) => {
    setDocs((currentDocs) =>
      currentDocs.map((doc) => {
        if (doc.id !== docId) {
          return doc;
        }

        return { ...doc, category };
      })
    );
  };

  const retryDoc = (docId: string) => {
    setDocs((currentDocs) =>
      currentDocs.map((doc) => {
        if (doc.id !== docId) {
          return doc;
        }

        return { ...doc, status: "queued" };
      })
    );

    runMockTransition(docId, false);
  };

  const failDoc = (docId: string) => {
    clearTimersForDoc(docId);
    setDocs((currentDocs) =>
      currentDocs.map((doc) => {
        if (doc.id !== docId) {
          return doc;
        }

        return { ...doc, status: "failed" };
      })
    );
  };

  return (
    <div className="docs-manager">
      <p className="docs-helper">
        Upload FAQs, itineraries, policies, and packing lists. These docs power draft accuracy.
      </p>
      <p className="docs-helper">Docs are indexed after upload. You&apos;ll see status updates here.</p>

      <div
        className={`docs-dropzone${dragActive ? " docs-dropzone-active" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragActive(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          addFiles(event.dataTransfer.files);
        }}
      >
        <p>Drag and drop docs here</p>
        <label className="docs-upload-button">
          Select files
          <input
            type="file"
            multiple
            className="docs-upload-input"
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
      </div>

      <details className="onboarding-dev-controls">
        <summary>Simulate (UX mock only)</summary>
        <div className="onboarding-dev-actions">
          <label className="simulate-toggle">
            <input
              type="checkbox"
              checked={failNextUpload}
              onChange={(event) => {
                setFailNextUpload(event.target.checked);
              }}
            />
            Fail next upload
          </label>
        </div>
      </details>

      {sortedDocs.length === 0 ? (
        <div className="docs-empty-state">No docs uploaded yet. Add your first doc to start indexing.</div>
      ) : (
        <div className="docs-table-wrap">
          <table className="docs-table">
            <thead>
              <tr>
                <th>Filename</th>
                <th>Category</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedDocs.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    <div className="docs-filename">{doc.filename}</div>
                    <div className="docs-meta">
                      {formatSize(doc.size)} • added {new Date(doc.added_at).toLocaleString()}
                    </div>
                  </td>
                  <td>
                    <select
                      value={doc.category}
                      onChange={(event) => {
                        updateDocCategory(doc.id, event.target.value as DocCategory);
                      }}
                    >
                      {DOC_CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <span className={getStatusClass(doc.status)}>{doc.status}</span>
                  </td>
                  <td>
                    <div className="docs-actions">
                      {doc.status === "failed" ? (
                        <button type="button" onClick={() => retryDoc(doc.id)}>
                          Retry
                        </button>
                      ) : null}
                      {doc.status === "queued" || doc.status === "indexing" ? (
                        <button type="button" onClick={() => failDoc(doc.id)}>
                          Simulate fail
                        </button>
                      ) : null}
                      <button type="button" onClick={() => removeDoc(doc.id)}>
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
