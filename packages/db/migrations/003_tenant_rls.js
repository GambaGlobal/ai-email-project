exports.up = (pgm) => {
  pgm.sql("CREATE EXTENSION IF NOT EXISTS pgcrypto;");

  pgm.sql(`
    CREATE OR REPLACE FUNCTION app_current_tenant_id()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
    $$;
  `);

  const tables = [
    "mailboxes",
    "threads",
    "messages",
    "runs",
    "drafts",
    "docs",
    "chunks",
    "embeddings",
    "audit_events"
  ];

  tables.forEach((table) => {
    pgm.sql(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    pgm.sql(`
      CREATE POLICY ${table}_tenant_isolation
      ON ${table}
      USING (tenant_id = app_current_tenant_id())
      WITH CHECK (tenant_id = app_current_tenant_id());
    `);
  });

  pgm.sql("ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;");
  pgm.sql(`
    CREATE POLICY tenants_tenant_isolation
    ON tenants
    USING (id = app_current_tenant_id())
    WITH CHECK (id = app_current_tenant_id());
  `);
};

exports.down = (pgm) => {
  pgm.sql("DROP POLICY IF EXISTS tenants_tenant_isolation ON tenants;");
  pgm.sql("ALTER TABLE tenants DISABLE ROW LEVEL SECURITY;");

  const tables = [
    "audit_events",
    "embeddings",
    "chunks",
    "docs",
    "drafts",
    "runs",
    "messages",
    "threads",
    "mailboxes"
  ];

  tables.forEach((table) => {
    pgm.sql(`DROP POLICY IF EXISTS ${table}_tenant_isolation ON ${table};`);
    pgm.sql(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY;`);
  });

  pgm.sql("DROP FUNCTION IF EXISTS app_current_tenant_id();");
};
