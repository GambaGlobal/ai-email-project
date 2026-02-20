exports.up = (pgm) => {
  pgm.alterColumn("docs", "title", {
    notNull: false
  });

  pgm.addColumns("docs", {
    doc_type: {
      type: "text"
    },
    created_by: {
      type: "uuid"
    }
  });

  pgm.createIndex("docs", ["tenant_id"], {
    name: "docs_tenant_id_idx"
  });

  pgm.createTable("doc_versions", {
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
    version_number: {
      type: "integer",
      notNull: true
    },
    state: {
      type: "text",
      notNull: true,
      default: "UPLOADED"
    },
    source_filename: {
      type: "text"
    },
    mime_type: {
      type: "text"
    },
    bytes: {
      type: "bigint"
    },
    sha256: {
      type: "text"
    },
    raw_file_key: {
      type: "text"
    },
    extracted_text_key: {
      type: "text"
    },
    error_code: {
      type: "text"
    },
    error_message: {
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
    },
    activated_at: {
      type: "timestamptz"
    },
    archived_at: {
      type: "timestamptz"
    }
  });

  pgm.addConstraint("doc_versions", "doc_versions_tenant_doc_fk", {
    foreignKeys: {
      columns: ["tenant_id", "doc_id"],
      references: "docs(tenant_id, id)",
      onDelete: "cascade"
    }
  });

  pgm.addConstraint("doc_versions", "doc_versions_doc_version_unique", {
    unique: ["doc_id", "version_number"]
  });

  pgm.addConstraint("doc_versions", "doc_versions_state_check", {
    check: "state IN ('UPLOADED', 'PROCESSING', 'ACTIVE', 'ARCHIVED', 'ERROR')"
  });

  pgm.createIndex("doc_versions", ["tenant_id"], {
    name: "doc_versions_tenant_id_idx"
  });
  pgm.createIndex("doc_versions", ["tenant_id", "doc_id"], {
    name: "doc_versions_tenant_doc_idx"
  });
  pgm.createIndex("doc_versions", ["doc_id", "state"], {
    name: "doc_versions_doc_state_idx"
  });
  pgm.createIndex("doc_versions", ["doc_id", { name: "version_number", sort: "desc" }], {
    name: "doc_versions_doc_version_desc_idx"
  });

  pgm.sql(`
    CREATE UNIQUE INDEX doc_versions_one_active_per_doc_idx
    ON doc_versions (doc_id)
    WHERE state = 'ACTIVE';
  `);

  pgm.sql("ALTER TABLE doc_versions ENABLE ROW LEVEL SECURITY;");
  pgm.sql(`
    CREATE POLICY doc_versions_tenant_isolation
    ON doc_versions
    USING (tenant_id = app_current_tenant_id())
    WITH CHECK (tenant_id = app_current_tenant_id());
  `);
};

exports.down = (pgm) => {
  pgm.sql("DROP POLICY IF EXISTS doc_versions_tenant_isolation ON doc_versions;");
  pgm.sql("ALTER TABLE doc_versions DISABLE ROW LEVEL SECURITY;");
  pgm.sql("DROP INDEX IF EXISTS doc_versions_one_active_per_doc_idx;");
  pgm.dropTable("doc_versions");

  pgm.dropIndex("docs", ["tenant_id"], {
    name: "docs_tenant_id_idx"
  });

  pgm.dropColumns("docs", ["doc_type", "created_by"]);

  pgm.sql("UPDATE docs SET title = '' WHERE title IS NULL;");
  pgm.alterColumn("docs", "title", {
    notNull: true
  });
};
