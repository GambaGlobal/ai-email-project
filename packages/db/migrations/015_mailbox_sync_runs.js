exports.up = (pgm) => {
  pgm.createTable("mailbox_sync_runs", {
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
      notNull: true,
      references: "mailboxes",
      onDelete: "cascade"
    },
    provider: {
      type: "text",
      notNull: true
    },
    correlation_id: {
      type: "uuid",
      notNull: true
    },
    from_history_id: {
      type: "text",
      notNull: true
    },
    to_history_id: {
      type: "text",
      notNull: true
    },
    fetched_count: {
      type: "integer",
      notNull: true,
      default: 0
    },
    status: {
      type: "text",
      notNull: true
    },
    last_error_class: {
      type: "text"
    },
    last_error: {
      type: "text"
    },
    started_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    },
    finished_at: {
      type: "timestamptz"
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    }
  });

  pgm.addConstraint("mailbox_sync_runs", "mailbox_sync_runs_status_check", {
    check: "status IN ('done','failed_transient','failed_permanent')"
  });

  pgm.addIndex("mailbox_sync_runs", ["tenant_id", "mailbox_id", { name: "started_at", sort: "desc" }]);
  pgm.addIndex("mailbox_sync_runs", ["tenant_id", "correlation_id"]);

  pgm.sql("ALTER TABLE mailbox_sync_runs ENABLE ROW LEVEL SECURITY;");
  pgm.sql(`
    CREATE POLICY mailbox_sync_runs_tenant_isolation
    ON mailbox_sync_runs
    USING (tenant_id = app_current_tenant_id())
    WITH CHECK (tenant_id = app_current_tenant_id());
  `);
};

exports.down = (pgm) => {
  pgm.sql("DROP POLICY IF EXISTS mailbox_sync_runs_tenant_isolation ON mailbox_sync_runs;");
  pgm.sql("ALTER TABLE mailbox_sync_runs DISABLE ROW LEVEL SECURITY;");
  pgm.dropTable("mailbox_sync_runs");
};
