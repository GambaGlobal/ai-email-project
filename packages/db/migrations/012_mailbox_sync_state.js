exports.up = (pgm) => {
  pgm.createTable("mailbox_sync_state", {
    tenant_id: {
      type: "uuid",
      notNull: true,
      references: "tenants",
      onDelete: "cascade"
    },
    mailbox_id: {
      type: "uuid",
      notNull: true,
      references: "mailboxes",
      onDelete: "cascade"
    },
    provider: {
      type: "text",
      notNull: true
    },
    last_history_id: {
      type: "numeric(20,0)",
      notNull: true,
      default: 0
    },
    pending_max_history_id: {
      type: "numeric(20,0)",
      notNull: true,
      default: 0
    },
    last_correlation_id: {
      type: "uuid"
    },
    pending_updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    },
    last_processed_at: {
      type: "timestamptz"
    },
    enqueued_at: {
      type: "timestamptz"
    },
    enqueued_job_id: {
      type: "text"
    },
    last_error: {
      type: "text"
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    }
  });

  pgm.addConstraint("mailbox_sync_state", "mailbox_sync_state_tenant_mailbox_provider_unique", {
    unique: ["tenant_id", "mailbox_id", "provider"]
  });

  pgm.addIndex("mailbox_sync_state", ["tenant_id", "mailbox_id"]);

  pgm.sql("ALTER TABLE mailbox_sync_state ENABLE ROW LEVEL SECURITY;");
  pgm.sql(`
    CREATE POLICY mailbox_sync_state_tenant_isolation
    ON mailbox_sync_state
    USING (tenant_id = app_current_tenant_id())
    WITH CHECK (tenant_id = app_current_tenant_id());
  `);
};

exports.down = (pgm) => {
  pgm.sql("DROP POLICY IF EXISTS mailbox_sync_state_tenant_isolation ON mailbox_sync_state;");
  pgm.sql("ALTER TABLE mailbox_sync_state DISABLE ROW LEVEL SECURITY;");
  pgm.dropTable("mailbox_sync_state");
};
