exports.up = (pgm) => {
  pgm.addColumns("tenants", {
    status: {
      type: "text",
      notNull: true,
      default: "active"
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    }
  });

  pgm.addColumns("mailboxes", {
    provider_mailbox_id: {
      type: "text"
    },
    email_address: {
      type: "text"
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    },
    last_sync_at: {
      type: "timestamptz"
    }
  });

  pgm.sql("UPDATE mailboxes SET email_address = address WHERE email_address IS NULL");
  pgm.sql("UPDATE mailboxes SET provider_mailbox_id = address WHERE provider_mailbox_id IS NULL");

  pgm.alterColumn("mailboxes", "email_address", {
    notNull: true
  });
  pgm.alterColumn("mailboxes", "provider_mailbox_id", {
    notNull: true
  });

  pgm.addConstraint("mailboxes", "mailboxes_tenant_provider_mailbox_unique", {
    unique: ["tenant_id", "provider", "provider_mailbox_id"]
  });
  pgm.addConstraint("mailboxes", "mailboxes_tenant_provider_email_unique", {
    unique: ["tenant_id", "provider", "email_address"]
  });
  pgm.addConstraint("mailboxes", "mailboxes_tenant_id_id_unique", {
    unique: ["tenant_id", "id"]
  });

  pgm.createTable("threads", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()")
    },
    tenant_id: {
      type: "uuid",
      notNull: true,
      references: "tenants",
      onDelete: "cascade"
    },
    mailbox_id: {
      type: "uuid",
      notNull: true
    },
    provider_thread_id: {
      type: "text",
      notNull: true
    },
    subject: {
      type: "text",
      notNull: true
    },
    sync_state: {
      type: "text"
    },
    last_message_at: {
      type: "timestamptz"
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    }
  });

  pgm.addConstraint("threads", "threads_tenant_id_id_unique", {
    unique: ["tenant_id", "id"]
  });
  pgm.addConstraint("threads", "threads_tenant_mailbox_provider_thread_unique", {
    unique: ["tenant_id", "mailbox_id", "provider_thread_id"]
  });
  pgm.addConstraint("threads", "threads_tenant_mailbox_fk", {
    foreignKeys: {
      columns: ["tenant_id", "mailbox_id"],
      references: "mailboxes(tenant_id, id)",
      onDelete: "cascade"
    }
  });

  pgm.createTable("messages", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()")
    },
    tenant_id: {
      type: "uuid",
      notNull: true,
      references: "tenants",
      onDelete: "cascade"
    },
    mailbox_id: {
      type: "uuid",
      notNull: true
    },
    thread_id: {
      type: "uuid",
      notNull: true
    },
    provider_message_id: {
      type: "text",
      notNull: true
    },
    direction: {
      type: "text",
      notNull: true
    },
    from_address: {
      type: "text",
      notNull: true
    },
    to_addresses: {
      type: "jsonb",
      notNull: true,
      default: pgm.func("'[]'::jsonb")
    },
    cc_addresses: {
      type: "jsonb",
      notNull: true,
      default: pgm.func("'[]'::jsonb")
    },
    bcc_addresses: {
      type: "jsonb",
      notNull: true,
      default: pgm.func("'[]'::jsonb")
    },
    subject: {
      type: "text",
      notNull: true
    },
    text_body: {
      type: "text"
    },
    html_body: {
      type: "text"
    },
    snippet: {
      type: "text"
    },
    headers: {
      type: "jsonb",
      notNull: true,
      default: pgm.func("'{}'::jsonb")
    },
    attachments: {
      type: "jsonb",
      notNull: true,
      default: pgm.func("'[]'::jsonb")
    },
    sent_at: {
      type: "timestamptz",
      notNull: true
    },
    processing_state: {
      type: "text",
      notNull: true,
      default: "received"
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    }
  });

  pgm.addConstraint("messages", "messages_tenant_id_id_unique", {
    unique: ["tenant_id", "id"]
  });
  pgm.addConstraint("messages", "messages_tenant_mailbox_provider_message_unique", {
    unique: ["tenant_id", "mailbox_id", "provider_message_id"]
  });
  pgm.addConstraint("messages", "messages_tenant_mailbox_fk", {
    foreignKeys: {
      columns: ["tenant_id", "mailbox_id"],
      references: "mailboxes(tenant_id, id)",
      onDelete: "cascade"
    }
  });
  pgm.addConstraint("messages", "messages_tenant_thread_fk", {
    foreignKeys: {
      columns: ["tenant_id", "thread_id"],
      references: "threads(tenant_id, id)",
      onDelete: "cascade"
    }
  });

  pgm.createTable("runs", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()")
    },
    tenant_id: {
      type: "uuid",
      notNull: true,
      references: "tenants",
      onDelete: "cascade"
    },
    mailbox_id: {
      type: "uuid",
      notNull: true
    },
    thread_id: {
      type: "uuid",
      notNull: true
    },
    message_id: {
      type: "uuid",
      notNull: true
    },
    provider: {
      type: "text",
      notNull: true
    },
    provider_message_id: {
      type: "text",
      notNull: true
    },
    status: {
      type: "text",
      notNull: true,
      default: "started"
    },
    attempt: {
      type: "integer",
      notNull: true,
      default: 1
    },
    correlation_id: {
      type: "text"
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    }
  });

  pgm.addConstraint("runs", "runs_tenant_id_id_unique", {
    unique: ["tenant_id", "id"]
  });
  pgm.addConstraint("runs", "runs_tenant_mailbox_provider_message_attempt_unique", {
    unique: ["tenant_id", "mailbox_id", "provider_message_id", "attempt"]
  });
  pgm.addConstraint("runs", "runs_tenant_mailbox_fk", {
    foreignKeys: {
      columns: ["tenant_id", "mailbox_id"],
      references: "mailboxes(tenant_id, id)",
      onDelete: "cascade"
    }
  });
  pgm.addConstraint("runs", "runs_tenant_thread_fk", {
    foreignKeys: {
      columns: ["tenant_id", "thread_id"],
      references: "threads(tenant_id, id)",
      onDelete: "cascade"
    }
  });
  pgm.addConstraint("runs", "runs_tenant_message_fk", {
    foreignKeys: {
      columns: ["tenant_id", "message_id"],
      references: "messages(tenant_id, id)",
      onDelete: "cascade"
    }
  });

  pgm.createTable("drafts", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()")
    },
    tenant_id: {
      type: "uuid",
      notNull: true,
      references: "tenants",
      onDelete: "cascade"
    },
    mailbox_id: {
      type: "uuid",
      notNull: true
    },
    thread_id: {
      type: "uuid",
      notNull: true
    },
    message_id: {
      type: "uuid",
      notNull: true
    },
    provider_draft_id: {
      type: "text"
    },
    status: {
      type: "text",
      notNull: true,
      default: "created"
    },
    body_text: {
      type: "text"
    },
    body_html: {
      type: "text"
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    }
  });

  pgm.addConstraint("drafts", "drafts_tenant_mailbox_message_unique", {
    unique: ["tenant_id", "mailbox_id", "message_id"]
  });
  pgm.addConstraint("drafts", "drafts_tenant_mailbox_fk", {
    foreignKeys: {
      columns: ["tenant_id", "mailbox_id"],
      references: "mailboxes(tenant_id, id)",
      onDelete: "cascade"
    }
  });
  pgm.addConstraint("drafts", "drafts_tenant_thread_fk", {
    foreignKeys: {
      columns: ["tenant_id", "thread_id"],
      references: "threads(tenant_id, id)",
      onDelete: "cascade"
    }
  });
  pgm.addConstraint("drafts", "drafts_tenant_message_fk", {
    foreignKeys: {
      columns: ["tenant_id", "message_id"],
      references: "messages(tenant_id, id)",
      onDelete: "cascade"
    }
  });

  pgm.createTable("docs", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()")
    },
    tenant_id: {
      type: "uuid",
      notNull: true,
      references: "tenants",
      onDelete: "cascade"
    },
    source: {
      type: "text",
      notNull: true
    },
    title: {
      type: "text",
      notNull: true
    },
    status: {
      type: "text",
      notNull: true,
      default: "pending"
    },
    storage_uri: {
      type: "text"
    },
    metadata: {
      type: "jsonb",
      notNull: true,
      default: pgm.func("'{}'::jsonb")
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    }
  });

  pgm.addConstraint("docs", "docs_tenant_id_id_unique", {
    unique: ["tenant_id", "id"]
  });

  pgm.createTable("chunks", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()")
    },
    tenant_id: {
      type: "uuid",
      notNull: true,
      references: "tenants",
      onDelete: "cascade"
    },
    doc_id: {
      type: "uuid",
      notNull: true
    },
    sequence: {
      type: "integer",
      notNull: true
    },
    content: {
      type: "text",
      notNull: true
    },
    status: {
      type: "text",
      notNull: true,
      default: "active"
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    }
  });

  pgm.addConstraint("chunks", "chunks_tenant_id_id_unique", {
    unique: ["tenant_id", "id"]
  });
  pgm.addConstraint("chunks", "chunks_tenant_doc_sequence_unique", {
    unique: ["tenant_id", "doc_id", "sequence"]
  });
  pgm.addConstraint("chunks", "chunks_tenant_doc_fk", {
    foreignKeys: {
      columns: ["tenant_id", "doc_id"],
      references: "docs(tenant_id, id)",
      onDelete: "cascade"
    }
  });

  pgm.createTable("embeddings", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()")
    },
    tenant_id: {
      type: "uuid",
      notNull: true,
      references: "tenants",
      onDelete: "cascade"
    },
    chunk_id: {
      type: "uuid",
      notNull: true
    },
    model: {
      type: "text",
      notNull: true
    },
    dims: {
      type: "integer"
    },
    vector: {
      type: "vector",
      notNull: true
    },
    status: {
      type: "text",
      notNull: true,
      default: "active"
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    }
  });

  pgm.addConstraint("embeddings", "embeddings_tenant_id_id_unique", {
    unique: ["tenant_id", "id"]
  });
  pgm.addConstraint("embeddings", "embeddings_tenant_chunk_model_unique", {
    unique: ["tenant_id", "chunk_id", "model"]
  });
  pgm.addConstraint("embeddings", "embeddings_tenant_chunk_fk", {
    foreignKeys: {
      columns: ["tenant_id", "chunk_id"],
      references: "chunks(tenant_id, id)",
      onDelete: "cascade"
    }
  });

  pgm.createTable("audit_events", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()")
    },
    tenant_id: {
      type: "uuid",
      notNull: true,
      references: "tenants",
      onDelete: "cascade"
    },
    mailbox_id: {
      type: "uuid",
      notNull: true
    },
    run_id: {
      type: "uuid",
      notNull: true
    },
    stage: {
      type: "text",
      notNull: true
    },
    outcome: {
      type: "text",
      notNull: true
    },
    occurred_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    },
    error_category: {
      type: "text"
    },
    payload: {
      type: "jsonb",
      notNull: true,
      default: pgm.func("'{}'::jsonb")
    },
    model: {
      type: "text"
    },
    model_version: {
      type: "text"
    },
    evidence_ids: {
      type: "jsonb",
      notNull: true,
      default: pgm.func("'[]'::jsonb")
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    }
  });

  pgm.addConstraint("audit_events", "audit_events_tenant_mailbox_fk", {
    foreignKeys: {
      columns: ["tenant_id", "mailbox_id"],
      references: "mailboxes(tenant_id, id)",
      onDelete: "cascade"
    }
  });
  pgm.addConstraint("audit_events", "audit_events_tenant_run_fk", {
    foreignKeys: {
      columns: ["tenant_id", "run_id"],
      references: "runs(tenant_id, id)",
      onDelete: "cascade"
    }
  });

  pgm.addIndex("chunks", ["tenant_id", "doc_id"]);
  pgm.addIndex("embeddings", ["tenant_id", "chunk_id"]);
  pgm.addIndex("audit_events", ["tenant_id", "run_id"]);
  pgm.addIndex("audit_events", ["tenant_id", "mailbox_id", { name: "created_at", sort: "desc" }]);
};

exports.down = (pgm) => {
  pgm.dropIndex("audit_events", ["tenant_id", "mailbox_id", { name: "created_at", sort: "desc" }]);
  pgm.dropIndex("audit_events", ["tenant_id", "run_id"]);
  pgm.dropIndex("embeddings", ["tenant_id", "chunk_id"]);
  pgm.dropIndex("chunks", ["tenant_id", "doc_id"]);

  pgm.dropTable("audit_events");
  pgm.dropTable("embeddings");
  pgm.dropTable("chunks");
  pgm.dropTable("docs");
  pgm.dropTable("drafts");
  pgm.dropTable("runs");
  pgm.dropTable("messages");
  pgm.dropTable("threads");

  pgm.dropConstraint("mailboxes", "mailboxes_tenant_id_id_unique");
  pgm.dropConstraint("mailboxes", "mailboxes_tenant_provider_email_unique");
  pgm.dropConstraint("mailboxes", "mailboxes_tenant_provider_mailbox_unique");

  pgm.dropColumns("mailboxes", ["provider_mailbox_id", "email_address", "updated_at", "last_sync_at"]);
  pgm.dropColumns("tenants", ["status", "updated_at"]);
};
