exports.up = (pgm) => {
  pgm.createTable("mail_provider_connections", {
    tenant_id: {
      type: "uuid",
      notNull: true,
      references: "tenants",
      onDelete: "cascade"
    },
    provider: {
      type: "text",
      notNull: true
    },
    status: {
      type: "text",
      notNull: true,
      default: "disconnected"
    },
    refresh_token_ciphertext: {
      type: "text"
    },
    refresh_token_iv: {
      type: "text"
    },
    refresh_token_tag: {
      type: "text"
    },
    access_token_ciphertext: {
      type: "text"
    },
    access_token_iv: {
      type: "text"
    },
    access_token_tag: {
      type: "text"
    },
    token_expires_at: {
      type: "timestamptz"
    },
    connected_at: {
      type: "timestamptz"
    },
    last_verified_at: {
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

  pgm.addConstraint("mail_provider_connections", "mail_provider_connections_pkey", {
    primaryKey: ["tenant_id", "provider"]
  });

  pgm.addConstraint(
    "mail_provider_connections",
    "mail_provider_connections_status_check",
    {
      check: "status IN ('connected', 'disconnected', 'reconnect_required')"
    }
  );

  pgm.addIndex("mail_provider_connections", ["tenant_id", "provider"]);
  pgm.sql("ALTER TABLE mail_provider_connections ENABLE ROW LEVEL SECURITY;");

  pgm.sql(`
    CREATE POLICY mail_provider_connections_tenant_isolation
    ON mail_provider_connections
    USING (tenant_id = app_current_tenant_id())
    WITH CHECK (tenant_id = app_current_tenant_id());
  `);
};

exports.down = (pgm) => {
  pgm.sql(
    "DROP POLICY IF EXISTS mail_provider_connections_tenant_isolation ON mail_provider_connections;"
  );
  pgm.sql("ALTER TABLE mail_provider_connections DISABLE ROW LEVEL SECURITY;");
  pgm.dropTable("mail_provider_connections");
};
