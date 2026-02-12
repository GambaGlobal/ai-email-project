"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const DOCS_STORAGE_KEY = "operator_docs_v1";
// Optional admin env for real docs mode:
// NEXT_PUBLIC_API_BASE_URL and NEXT_PUBLIC_TENANT_ID.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;
const API_TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID;

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
  error_message?: string | null;
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

function createDocFromFile(file: File, category: DocCategory): OperatorDoc {
  return {
    id: generateDocId(),
    filename: file.name,
    size: file.size,
    category,
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

function normalizeServerDocs(input: unknown): OperatorDoc[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((value) => {
      if (!value || typeof value !== "object") {
        return null;
      }

      const doc = value as Record<string, unknown>;
      const normalized: OperatorDoc = {
        id: String(doc.id ?? ""),
        filename: String(doc.filename ?? ""),
        size: Number(doc.size ?? 0),
        category: String(doc.category ?? "Policies") as DocCategory,
        status: String(doc.status ?? "queued") as DocStatus,
        added_at: String(doc.added_at ?? ""),
        error_message: typeof doc.error_message === "string" ? doc.error_message : null
      };

      if (!isValidDoc(normalized)) {
        return null;
      }

      return normalized;
    })
    .filter((doc): doc is OperatorDoc => doc !== null);
}

function syncDocsLocalStorage(docs: OperatorDoc[]): void {
  window.localStorage.setItem(DOCS_STORAGE_KEY, JSON.stringify(docs));
}

export function DocsManager() {
  const [docs, setDocs] = useState<OperatorDoc[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [failNextUpload, setFailNextUpload] = useState(false);
  const [uploadCategory, setUploadCategory] = useState<DocCategory>("Policies");
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const timersRef = useRef<TimerMap>({});

  const realMode = Boolean(API_BASE_URL && API_TENANT_ID);

  const sortedDocs = useMemo(() => {
    return [...docs].sort((left, right) => {
      return new Date(right.added_at).getTime() - new Date(left.added_at).getTime();
    });
  }, [docs]);

  const clearTimersForDoc = (docId: string) => {
    const docTimers = timersRef.current[docId] || [];
    docTimers.forEach((timer) => window.clearTimeout(timer));
    delete timersRef.current[docId];
  };

  const fetchServerDocs = async () => {
    if (!realMode || !API_BASE_URL || !API_TENANT_ID) {
      return;
    }

    const response = await fetch(new URL("/v1/docs", API_BASE_URL).toString(), {
      headers: {
        "x-tenant-id": API_TENANT_ID
      }
    });

    if (!response.ok) {
      throw new Error(`Docs fetch failed (${response.status})`);
    }

    const payload = await response.json();
    const normalized = normalizeServerDocs(payload);
    setDocs(normalized);
    syncDocsLocalStorage(normalized);
  };

  useEffect(() => {
    if (realMode) {
      setIsLoading(true);
      fetchServerDocs()
        .catch((error) => {
          setErrorMessage(
            error instanceof Error ? error.message : "Unable to load docs from server"
          );
        })
        .finally(() => {
          setIsLoading(false);
        });

      return;
    }

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
  }, [realMode]);

  useEffect(() => {
    if (realMode) {
      return;
    }

    syncDocsLocalStorage(docs);
  }, [docs, realMode]);

  useEffect(() => {
    if (!realMode) {
      return;
    }

    const hasInFlightDocs = docs.some((doc) => doc.status === "queued" || doc.status === "indexing");

    if (!hasInFlightDocs) {
      return;
    }

    const interval = window.setInterval(() => {
      fetchServerDocs().catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : "Unable to refresh docs status");
      });
    }, 2500);

    return () => {
      window.clearInterval(interval);
    };
  }, [docs, realMode]);

  useEffect(() => {
    return () => {
      Object.values(timersRef.current).forEach((timers) => {
        timers.forEach((timer) => window.clearTimeout(timer));
      });
    };
  }, []);

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

  const uploadFilesReal = async (files: FileList) => {
    if (!API_BASE_URL || !API_TENANT_ID) {
      return;
    }

    setIsUploading(true);
    setErrorMessage(null);

    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.set("file", file);
        formData.set("category", uploadCategory);

        const response = await fetch(new URL("/v1/docs", API_BASE_URL).toString(), {
          method: "POST",
          headers: {
            "x-tenant-id": API_TENANT_ID
          },
          body: formData
        });

        if (!response.ok) {
          throw new Error(`Upload failed (${response.status})`);
        }
      }

      await fetchServerDocs();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to upload docs");
    } finally {
      setIsUploading(false);
    }
  };

  const addFiles = (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }

    if (realMode) {
      void uploadFilesReal(files);
      return;
    }

    const createdDocs = Array.from(files).map((file) => createDocFromFile(file, uploadCategory));
    const shouldFail = failNextUpload;

    setDocs((currentDocs) => [...currentDocs, ...createdDocs]);
    createdDocs.forEach((doc) => runMockTransition(doc.id, shouldFail));
    setFailNextUpload(false);
  };

  const removeDoc = async (docId: string) => {
    if (realMode && API_BASE_URL && API_TENANT_ID) {
      try {
        const response = await fetch(new URL(`/v1/docs/${docId}`, API_BASE_URL).toString(), {
          method: "DELETE",
          headers: {
            "x-tenant-id": API_TENANT_ID
          }
        });

        if (!response.ok && response.status !== 204) {
          throw new Error(`Delete failed (${response.status})`);
        }

        await fetchServerDocs();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Unable to delete doc");
      }

      return;
    }

    clearTimersForDoc(docId);
    setDocs((currentDocs) => currentDocs.filter((doc) => doc.id !== docId));
  };

  const updateDocCategory = async (docId: string, category: DocCategory) => {
    if (realMode && API_BASE_URL && API_TENANT_ID) {
      try {
        const response = await fetch(new URL(`/v1/docs/${docId}`, API_BASE_URL).toString(), {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-tenant-id": API_TENANT_ID
          },
          body: JSON.stringify({ category })
        });

        if (!response.ok) {
          throw new Error(`Category update failed (${response.status})`);
        }

        await fetchServerDocs();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Unable to update category");
      }

      return;
    }

    setDocs((currentDocs) =>
      currentDocs.map((doc) => {
        if (doc.id !== docId) {
          return doc;
        }

        return { ...doc, category };
      })
    );
  };

  const retryDoc = async (docId: string) => {
    if (realMode && API_BASE_URL && API_TENANT_ID) {
      try {
        const response = await fetch(new URL(`/v1/docs/${docId}/retry`, API_BASE_URL).toString(), {
          method: "POST",
          headers: {
            "x-tenant-id": API_TENANT_ID
          }
        });

        if (!response.ok) {
          throw new Error(`Retry failed (${response.status})`);
        }

        await fetchServerDocs();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Unable to retry doc");
      }

      return;
    }

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

      <div className="docs-upload-controls">
        <label>
          Category
          <select
            value={uploadCategory}
            onChange={(event) => {
              setUploadCategory(event.target.value as DocCategory);
            }}
          >
            {DOC_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
      </div>

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
          {isUploading ? "Uploading..." : "Select files"}
          <input
            type="file"
            multiple
            className="docs-upload-input"
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = "";
            }}
            disabled={isUploading}
          />
        </label>
      </div>

      {!realMode ? (
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
      ) : null}

      {isLoading ? <p className="docs-helper">Loading docs...</p> : null}
      {errorMessage ? <p className="docs-error">{errorMessage}</p> : null}

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
                        updateDocCategory(doc.id, event.target.value as DocCategory).catch(() => {
                          // no-op; handled in updater
                        });
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
                    {doc.error_message ? <div className="docs-error-meta">{doc.error_message}</div> : null}
                  </td>
                  <td>
                    <div className="docs-actions">
                      {doc.status === "failed" ? (
                        <button
                          type="button"
                          onClick={() => {
                            retryDoc(doc.id).catch(() => {
                              // no-op; handled in retry
                            });
                          }}
                        >
                          Retry
                        </button>
                      ) : null}
                      {!realMode && (doc.status === "queued" || doc.status === "indexing") ? (
                        <button type="button" onClick={() => failDoc(doc.id)}>
                          Simulate fail
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          removeDoc(doc.id).catch(() => {
                            // no-op; handled in remove
                          });
                        }}
                      >
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
