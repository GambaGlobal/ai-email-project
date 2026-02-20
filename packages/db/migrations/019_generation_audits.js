exports.up = (pgm) => {
  pgm.createTable("generation_audits", {
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
    citation_contract_version: {
      type: "text",
      notNull: true
    },
    reason: {
      type: "text",
      notNull: true
    },
    query: {
      type: "text",
      notNull: true
    },
    sources: {
      type: "jsonb",
      notNull: true
    },
    correlation_id: {
      type: "text"
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    }
  });

  pgm.createIndex("generation_audits", ["tenant_id"], {
    name: "generation_audits_tenant_id_idx"
  });

  pgm.createIndex("generation_audits", ["tenant_id", "created_at"], {
    name: "generation_audits_tenant_created_at_idx"
  });

  pgm.createIndex("generation_audits", ["correlation_id"], {
    name: "generation_audits_correlation_id_idx"
  });

  pgm.sql("ALTER TABLE generation_audits ENABLE ROW LEVEL SECURITY;");
  pgm.sql(`
    CREATE POLICY generation_audits_tenant_isolation
    ON generation_audits
    USING (tenant_id = app_current_tenant_id())
    WITH CHECK (tenant_id = app_current_tenant_id());
  `);
};

exports.down = (pgm) => {
  pgm.sql("DROP POLICY IF EXISTS generation_audits_tenant_isolation ON generation_audits;");
  pgm.sql("ALTER TABLE generation_audits DISABLE ROW LEVEL SECURITY;");
  pgm.dropTable("generation_audits");
};
