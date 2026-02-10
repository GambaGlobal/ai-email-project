exports.up = (pgm) => {
  pgm.sql("CREATE EXTENSION IF NOT EXISTS vector;");
  pgm.sql("CREATE EXTENSION IF NOT EXISTS pgcrypto;");

  pgm.createTable("tenants", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()")
    },
    name: {
      type: "text",
      notNull: true
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    }
  });

  pgm.createTable("mailboxes", {
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
    provider: {
      type: "text",
      notNull: true
    },
    address: {
      type: "text",
      notNull: true
    },
    status: {
      type: "text",
      notNull: true,
      default: "disconnected"
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    }
  });

  pgm.addConstraint("mailboxes", "mailboxes_tenant_provider_address_unique", {
    unique: ["tenant_id", "provider", "address"]
  });

  pgm.createTable("telemetry_events", {
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
    mailbox_id: {
      type: "uuid",
      references: "mailboxes",
      onDelete: "set null"
    },
    name: {
      type: "text",
      notNull: true
    },
    occurred_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    },
    props: {
      type: "jsonb",
      notNull: true,
      default: pgm.func("'{}'::jsonb")
    }
  });

  pgm.createIndex("telemetry_events", ["tenant_id", { name: "occurred_at", sort: "desc" }]);
  pgm.createIndex("telemetry_events", ["tenant_id", "name"]);
};

exports.down = (pgm) => {
  pgm.dropTable("telemetry_events");
  pgm.dropTable("mailboxes");
  pgm.dropTable("tenants");
  pgm.sql("DROP EXTENSION IF EXISTS pgcrypto;");
  pgm.sql("DROP EXTENSION IF EXISTS vector;");
};
