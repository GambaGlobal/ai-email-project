exports.up = (pgm) => {
  pgm.addColumns("mail_notification_receipts", {
    processing_status: {
      type: "text",
      notNull: true,
      default: "received"
    },
    processing_attempts: {
      type: "integer",
      notNull: true,
      default: 0
    },
    processing_started_at: {
      type: "timestamptz"
    },
    processed_at: {
      type: "timestamptz"
    },
    last_error_class: {
      type: "text"
    },
    last_error_at: {
      type: "timestamptz"
    }
  });

  pgm.addConstraint("mail_notification_receipts", "mail_notification_receipts_processing_status_check", {
    check:
      "processing_status IN ('received','enqueued','processing','done','failed_transient','failed_permanent','ignored')"
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint(
    "mail_notification_receipts",
    "mail_notification_receipts_processing_status_check"
  );
  pgm.dropColumns("mail_notification_receipts", [
    "processing_status",
    "processing_attempts",
    "processing_started_at",
    "processed_at",
    "last_error_class",
    "last_error_at"
  ]);
};
