exports.up = (pgm) => {
  pgm.addColumns("mail_notification_receipts", {
    enqueued_at: {
      type: "timestamptz"
    },
    enqueued_job_id: {
      type: "text"
    },
    last_error: {
      type: "text"
    }
  });

  pgm.addIndex("mail_notification_receipts", ["tenant_id", "enqueued_at"]);
};

exports.down = (pgm) => {
  pgm.dropIndex("mail_notification_receipts", ["tenant_id", "enqueued_at"]);
  pgm.dropColumns("mail_notification_receipts", ["enqueued_at", "enqueued_job_id", "last_error"]);
};
