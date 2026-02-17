exports.up = (pgm) => {
  pgm.createTable("canonical_qa", {
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
      type: "uuid"
    },
    version_id: {
      type: "uuid"
    },
    question: {
      type: "text",
      notNull: true
    },
    answer: {
      type: "text",
      notNull: true
    },
    status: {
      type: "text",
      notNull: true,
      default: "DRAFT"
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

  pgm.addConstraint("canonical_qa", "canonical_qa_status_check", {
    check: "status IN ('DRAFT', 'APPROVED', 'ARCHIVED')"
  });

  pgm.addConstraint("canonical_qa", "canonical_qa_tenant_doc_fk", {
    foreignKeys: {
      columns: ["tenant_id", "doc_id"],
      references: "docs(tenant_id, id)",
      onDelete: "set null"
    }
  });

  pgm.addConstraint("canonical_qa", "canonical_qa_tenant_version_fk", {
    foreignKeys: {
      columns: ["tenant_id", "version_id"],
      references: "doc_versions(tenant_id, id)",
      onDelete: "set null"
    }
  });

  pgm.createIndex("canonical_qa", ["tenant_id"], {
    name: "canonical_qa_tenant_id_idx"
  });

  pgm.createIndex("canonical_qa", ["tenant_id", "status"], {
    name: "canonical_qa_tenant_status_idx"
  });

  pgm.createIndex("canonical_qa", ["question"], {
    name: "canonical_qa_question_idx"
  });

  pgm.sql(`
    CREATE OR REPLACE FUNCTION set_canonical_qa_updated_at()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$;
  `);

  pgm.sql("DROP TRIGGER IF EXISTS canonical_qa_set_updated_at ON canonical_qa;");
  pgm.sql(`
    CREATE TRIGGER canonical_qa_set_updated_at
    BEFORE UPDATE ON canonical_qa
    FOR EACH ROW
    EXECUTE FUNCTION set_canonical_qa_updated_at();
  `);

  pgm.sql("ALTER TABLE canonical_qa ENABLE ROW LEVEL SECURITY;");
  pgm.sql(`
    CREATE POLICY canonical_qa_tenant_isolation
    ON canonical_qa
    USING (tenant_id = app_current_tenant_id())
    WITH CHECK (tenant_id = app_current_tenant_id());
  `);
};

exports.down = (pgm) => {
  pgm.sql("DROP POLICY IF EXISTS canonical_qa_tenant_isolation ON canonical_qa;");
  pgm.sql("ALTER TABLE canonical_qa DISABLE ROW LEVEL SECURITY;");
  pgm.sql("DROP TRIGGER IF EXISTS canonical_qa_set_updated_at ON canonical_qa;");
  pgm.sql("DROP FUNCTION IF EXISTS set_canonical_qa_updated_at();");
  pgm.dropTable("canonical_qa");
};
