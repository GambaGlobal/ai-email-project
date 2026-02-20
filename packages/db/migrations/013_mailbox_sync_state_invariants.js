exports.up = (pgm) => {
  pgm.sql(`
    UPDATE mailbox_sync_state
    SET
      pending_max_history_id = last_history_id,
      updated_at = now()
    WHERE pending_max_history_id < last_history_id;
  `);

  pgm.addConstraint("mailbox_sync_state", "mailbox_sync_state_pending_gte_last", {
    check: "pending_max_history_id >= last_history_id"
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint("mailbox_sync_state", "mailbox_sync_state_pending_gte_last");
};
