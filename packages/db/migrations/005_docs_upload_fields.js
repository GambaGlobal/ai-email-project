exports.up = (pgm) => {
  pgm.addColumns("docs", {
    filename: {
      type: "text"
    },
    size_bytes: {
      type: "bigint"
    },
    category: {
      type: "text"
    },
    storage_provider: {
      type: "text"
    },
    storage_key: {
      type: "text"
    },
    indexed_at: {
      type: "timestamptz"
    },
    error_message: {
      type: "text"
    }
  });

  pgm.sql("UPDATE docs SET filename = title WHERE filename IS NULL");
  pgm.sql("UPDATE docs SET size_bytes = 0 WHERE size_bytes IS NULL");
  pgm.sql("UPDATE docs SET category = 'Policies' WHERE category IS NULL");
  pgm.sql("UPDATE docs SET storage_provider = 's3' WHERE storage_provider IS NULL");
  pgm.sql("UPDATE docs SET storage_key = '' WHERE storage_key IS NULL");
  pgm.sql(
    "UPDATE docs SET status = 'queued' WHERE status NOT IN ('queued', 'indexing', 'ready', 'failed')"
  );

  pgm.alterColumn("docs", "filename", { notNull: true });
  pgm.alterColumn("docs", "size_bytes", { notNull: true });
  pgm.alterColumn("docs", "category", { notNull: true });
  pgm.alterColumn("docs", "storage_provider", { notNull: true });
  pgm.alterColumn("docs", "storage_key", { notNull: true });

  pgm.addConstraint("docs", "docs_category_check", {
    check: "category IN ('Policies', 'Itineraries', 'FAQs', 'Packing')"
  });

  pgm.addConstraint("docs", "docs_status_check", {
    check: "status IN ('queued', 'indexing', 'ready', 'failed')"
  });

  pgm.createIndex("docs", ["tenant_id", { name: "created_at", sort: "desc" }]);
};

exports.down = (pgm) => {
  pgm.dropIndex("docs", ["tenant_id", { name: "created_at", sort: "desc" }]);
  pgm.dropConstraint("docs", "docs_status_check");
  pgm.dropConstraint("docs", "docs_category_check");

  pgm.dropColumns("docs", [
    "filename",
    "size_bytes",
    "category",
    "storage_provider",
    "storage_key",
    "indexed_at",
    "error_message"
  ]);
};
