BEGIN;

WITH t AS (
  INSERT INTO tenants (id, name, status)
  VALUES
    ('11111111-1111-1111-1111-111111111111', 'Tenant One', 'active'),
    ('22222222-2222-2222-2222-222222222222', 'Tenant Two', 'active')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
SELECT * FROM t;

INSERT INTO mailboxes (
  id,
  tenant_id,
  provider,
  address,
  provider_mailbox_id,
  email_address,
  status
)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'gmail', 't1@example.com', 't1-mailbox', 't1@example.com', 'connected'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'gmail', 't2@example.com', 't2-mailbox', 't2@example.com', 'connected')
ON CONFLICT (id) DO NOTHING;

INSERT INTO threads (id, tenant_id, mailbox_id, provider_thread_id, subject)
VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 't1-thread', 'T1 Subject'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 't2-thread', 'T2 Subject')
ON CONFLICT (id) DO NOTHING;

INSERT INTO messages (
  id,
  tenant_id,
  mailbox_id,
  thread_id,
  provider_message_id,
  direction,
  from_address,
  to_addresses,
  subject,
  sent_at
)
VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 't1-msg', 'inbound', 'guest1@example.com', '["op1@example.com"]', 'Hello T1', now()),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 't2-msg', 'inbound', 'guest2@example.com', '["op2@example.com"]', 'Hello T2', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO runs (
  id,
  tenant_id,
  mailbox_id,
  thread_id,
  message_id,
  provider,
  provider_message_id,
  status
)
VALUES
  ('99999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'gmail', 't1-msg', 'started'),
  ('88888888-8888-8888-8888-888888888888', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'gmail', 't2-msg', 'started')
ON CONFLICT (id) DO NOTHING;

INSERT INTO audit_events (
  id,
  tenant_id,
  mailbox_id,
  run_id,
  stage,
  outcome
)
VALUES
  ('77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '99999999-9999-9999-9999-999999999999', 'notification', 'ok'),
  ('66666666-6666-6666-6666-666666666666', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '88888888-8888-8888-8888-888888888888', 'notification', 'ok')
ON CONFLICT (id) DO NOTHING;

SET app.tenant_id = '11111111-1111-1111-1111-111111111111';
SELECT 't1_mailboxes' AS check, count(*) AS rows FROM mailboxes;
SELECT 't1_threads' AS check, count(*) AS rows FROM threads;
SELECT 't1_messages' AS check, count(*) AS rows FROM messages;
SELECT 't1_runs' AS check, count(*) AS rows FROM runs;
SELECT 't1_audit_events' AS check, count(*) AS rows FROM audit_events;

SET app.tenant_id = '22222222-2222-2222-2222-222222222222';
SELECT 't2_mailboxes' AS check, count(*) AS rows FROM mailboxes;
SELECT 't2_threads' AS check, count(*) AS rows FROM threads;
SELECT 't2_messages' AS check, count(*) AS rows FROM messages;
SELECT 't2_runs' AS check, count(*) AS rows FROM runs;
SELECT 't2_audit_events' AS check, count(*) AS rows FROM audit_events;

RESET app.tenant_id;

ROLLBACK;
