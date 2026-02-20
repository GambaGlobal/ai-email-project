exports.up = (pgm) => {
  pgm.createTable("doc_ingestion_failures", {
    id: {
      type: "bigserial",
      primaryKey: true
    },
    tenant_id: {
      type: "uuid",
      notNull: true,
      references: "tenants",
      onDelete: "cascade"
    },
    correlation_id: {
      type: "text",
      notNull: true
    },
    job_id: {
      type: "text",
      notNull: true
    },
    stage: {
      type: "text",
      notNull: true,
      default: "doc_ingestion"
    },
    error_class: {
      type: "text",
      notNull: true
    },
    error_code: {
      type: "text"
    },
    error_message: {
      type: "text",
      notNull: true
    },
    error_stack: {
      type: "text"
    },
    attempt: {
      type: "integer",
      notNull: true,
      default: 1
    },
    max_attempts: {
      type: "integer",
      notNull: true,
      default: 1
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    }
  });

  pgm.addIndex("doc_ingestion_failures", ["tenant_id", { name: "created_at", sort: "desc" }]);
  pgm.addIndex("doc_ingestion_failures", ["tenant_id", "correlation_id"]);
  pgm.addIndex("doc_ingestion_failures", ["tenant_id", "job_id"]);

  pgm.sql("ALTER TABLE doc_ingestion_failures ENABLE ROW LEVEL SECURITY;");
  pgm.sql(`
    CREATE POLICY doc_ingestion_failures_tenant_isolation
    ON doc_ingestion_failures
    USING (tenant_id = app_current_tenant_id())
    WITH CHECK (tenant_id = app_current_tenant_id());
  `);
};

exports.down = (pgm) => {
  pgm.sql("DROP POLICY IF EXISTS doc_ingestion_failures_tenant_isolation ON doc_ingestion_failures;");
  pgm.sql("ALTER TABLE doc_ingestion_failures DISABLE ROW LEVEL SECURITY;");
  pgm.dropTable("doc_ingestion_failures");
};
