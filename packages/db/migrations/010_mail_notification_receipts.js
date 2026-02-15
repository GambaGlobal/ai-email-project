exports.up = (pgm) => {
  pgm.createTable("mail_notification_receipts", {
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
      references: "mailboxes",
      onDelete: "set null"
    },
    provider: {
      type: "text",
      notNull: true
    },
    message_id: {
      type: "text",
      notNull: true
    },
    gmail_history_id: {
      type: "text"
    },
    received_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    },
    payload: {
      type: "jsonb",
      notNull: true,
      default: pgm.func("'{}'::jsonb")
    }
  });

  pgm.addConstraint("mail_notification_receipts", "mail_notification_receipts_unique", {
    unique: ["tenant_id", "provider", "message_id"]
  });

  pgm.addIndex("mail_notification_receipts", ["tenant_id", { name: "received_at", sort: "desc" }]);
  pgm.addIndex("mail_notification_receipts", ["tenant_id", "provider", "message_id"]);

  pgm.sql("ALTER TABLE mail_notification_receipts ENABLE ROW LEVEL SECURITY;");
  pgm.sql(`
    CREATE POLICY mail_notification_receipts_tenant_isolation
    ON mail_notification_receipts
    USING (tenant_id = app_current_tenant_id())
    WITH CHECK (tenant_id = app_current_tenant_id());
  `);
};

exports.down = (pgm) => {
  pgm.sql(
    "DROP POLICY IF EXISTS mail_notification_receipts_tenant_isolation ON mail_notification_receipts;"
  );
  pgm.sql("ALTER TABLE mail_notification_receipts DISABLE ROW LEVEL SECURITY;");
  pgm.dropTable("mail_notification_receipts");
};
