const EMBEDDING_DIMENSIONS = 1536;

exports.up = (pgm) => {
  pgm.sql("CREATE EXTENSION IF NOT EXISTS vector;");

  pgm.addConstraint("doc_versions", "doc_versions_tenant_id_id_unique", {
    unique: ["tenant_id", "id"]
  });

  pgm.createTable("doc_chunks", {
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
    version_id: {
      type: "uuid",
      notNull: true
    },
    chunk_index: {
      type: "integer",
      notNull: true
    },
    start_char: {
      type: "integer",
      notNull: true
    },
    end_char: {
      type: "integer",
      notNull: true
    },
    content: {
      type: "text",
      notNull: true
    },
    content_sha256: {
      type: "text",
      notNull: true
    },
    embedding: {
      type: `vector(${EMBEDDING_DIMENSIONS})`,
      notNull: true
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    }
  });

  pgm.addConstraint("doc_chunks", "doc_chunks_tenant_id_id_unique", {
    unique: ["tenant_id", "id"]
  });

  pgm.addConstraint("doc_chunks", "doc_chunks_tenant_version_chunk_unique", {
    unique: ["tenant_id", "version_id", "chunk_index"]
  });

  pgm.addConstraint("doc_chunks", "doc_chunks_tenant_doc_fk", {
    foreignKeys: {
      columns: ["tenant_id", "doc_id"],
      references: "docs(tenant_id, id)",
      onDelete: "cascade"
    }
  });

  pgm.addConstraint("doc_chunks", "doc_chunks_tenant_version_fk", {
    foreignKeys: {
      columns: ["tenant_id", "version_id"],
      references: "doc_versions(tenant_id, id)",
      onDelete: "cascade"
    }
  });

  pgm.addIndex("doc_chunks", ["tenant_id"], {
    name: "doc_chunks_tenant_id_idx"
  });

  pgm.addIndex("doc_chunks", ["tenant_id", "version_id"], {
    name: "doc_chunks_tenant_version_idx"
  });

  pgm.addIndex("doc_chunks", ["tenant_id", "doc_id", "version_id"], {
    name: "doc_chunks_tenant_doc_version_idx"
  });

  pgm.sql(`
    CREATE INDEX doc_chunks_embedding_ivfflat_idx
    ON doc_chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
  `);

  pgm.sql("ALTER TABLE doc_chunks ENABLE ROW LEVEL SECURITY;");
  pgm.sql(`
    CREATE POLICY doc_chunks_tenant_isolation
    ON doc_chunks
    USING (tenant_id = app_current_tenant_id())
    WITH CHECK (tenant_id = app_current_tenant_id());
  `);
};

exports.down = (pgm) => {
  pgm.sql("DROP POLICY IF EXISTS doc_chunks_tenant_isolation ON doc_chunks;");
  pgm.sql("ALTER TABLE doc_chunks DISABLE ROW LEVEL SECURITY;");
  pgm.sql("DROP INDEX IF EXISTS doc_chunks_embedding_ivfflat_idx;");
  pgm.dropTable("doc_chunks");
  pgm.dropConstraint("doc_versions", "doc_versions_tenant_id_id_unique");
};
