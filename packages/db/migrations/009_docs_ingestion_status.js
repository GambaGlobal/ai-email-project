exports.up = (pgm) => {
  pgm.addColumns("docs", {
    ingestion_status: {
      type: "text",
      notNull: true,
      default: "queued"
    },
    ingestion_status_updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    },
    ingested_at: {
      type: "timestamptz"
    }
  });

  pgm.sql(`
    UPDATE docs
    SET ingestion_status =
      CASE
        WHEN status = 'ready' THEN 'done'
        WHEN status = 'indexing' THEN 'processing'
        WHEN status = 'failed' THEN 'failed'
        ELSE 'queued'
      END
    WHERE ingestion_status IS NULL
       OR ingestion_status NOT IN ('queued', 'processing', 'done', 'failed', 'ignored');
  `);

  pgm.sql(`
    UPDATE docs
    SET ingested_at = indexed_at
    WHERE ingested_at IS NULL
      AND indexed_at IS NOT NULL;
  `);

  pgm.addConstraint("docs", "docs_ingestion_status_check", {
    check: "ingestion_status IN ('queued', 'processing', 'done', 'failed', 'ignored')"
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint("docs", "docs_ingestion_status_check");
  pgm.dropColumns("docs", ["ingestion_status", "ingestion_status_updated_at", "ingested_at"]);
};

