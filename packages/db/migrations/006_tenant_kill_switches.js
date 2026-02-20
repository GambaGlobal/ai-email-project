exports.up = (pgm) => {
  pgm.createTable("tenant_kill_switches", {
    tenant_id: {
      type: "uuid",
      notNull: true,
      references: "tenants",
      onDelete: "cascade"
    },
    key: {
      type: "text",
      notNull: true
    },
    is_enabled: {
      type: "boolean",
      notNull: true,
      default: false
    },
    reason: {
      type: "text"
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    }
  });

  pgm.addConstraint("tenant_kill_switches", "tenant_kill_switches_tenant_key_unique", {
    unique: ["tenant_id", "key"]
  });
  pgm.addIndex("tenant_kill_switches", ["tenant_id", "key"]);

  pgm.sql("ALTER TABLE tenant_kill_switches ENABLE ROW LEVEL SECURITY;");
  pgm.sql(`
    CREATE POLICY tenant_kill_switches_tenant_isolation
    ON tenant_kill_switches
    USING (tenant_id = app_current_tenant_id())
    WITH CHECK (tenant_id = app_current_tenant_id());
  `);
};

exports.down = (pgm) => {
  pgm.sql("DROP POLICY IF EXISTS tenant_kill_switches_tenant_isolation ON tenant_kill_switches;");
  pgm.sql("ALTER TABLE tenant_kill_switches DISABLE ROW LEVEL SECURITY;");
  pgm.dropTable("tenant_kill_switches");
};
