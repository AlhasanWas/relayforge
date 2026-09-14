-- =============================================================================
-- Invariants that Prisma cannot express: CHECK constraints, append-only and
-- immutability triggers, final-state guards, and deferred double-entry balance
-- checks. Hand-written; the preceding migration is generated from schema.prisma.
--
-- Every rule is exercised by test/integration/database-invariants.int-spec.ts.
-- Violations raise SQLSTATE 23514 (check_violation) or 23001 (restrict_violation).
-- =============================================================================

-- ---- Shared -----------------------------------------------------------------

CREATE FUNCTION reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

-- ---- api_keys ---------------------------------------------------------------

CREATE FUNCTION api_keys_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'api_keys rows cannot be deleted; revoke the key instead'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.id, NEW.workspace_id, NEW.prefix, NEW.key_hash, NEW.role, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.workspace_id, OLD.prefix, OLD.key_hash, OLD.role, OLD.created_at) THEN
    RAISE EXCEPTION 'api key % identity columns are immutable', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'api key % is revoked and revocation is permanent', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER api_keys_guard BEFORE UPDATE OR DELETE ON api_keys
  FOR EACH ROW EXECUTE FUNCTION api_keys_guard();

-- ---- audit_logs -------------------------------------------------------------

CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- ---- provider_connections ---------------------------------------------------

ALTER TABLE provider_connections
  ADD CONSTRAINT provider_connections_timestamp_tolerance_check
    CHECK (timestamp_tolerance_sec IS NULL OR timestamp_tolerance_sec > 0);

-- ---- incoming_events --------------------------------------------------------

ALTER TABLE incoming_events
  ADD CONSTRAINT incoming_events_signature_valid_check CHECK (signature_valid),
  ADD CONSTRAINT incoming_events_payload_hash_check CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT incoming_events_processing_attempts_check CHECK (processing_attempts >= 0),
  ADD CONSTRAINT incoming_events_processed_at_check
    CHECK ((status <> 'RECEIVED') = (processed_at IS NOT NULL)),
  ADD CONSTRAINT incoming_events_failure_reason_check
    CHECK ((status = 'FAILED') = (failure_reason IS NOT NULL));

CREATE FUNCTION incoming_events_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'incoming_events rows cannot be deleted'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.id, NEW.workspace_id, NEW.provider_connection_id, NEW.external_event_id,
      NEW.event_type, NEW.payload, NEW.payload_hash, NEW.signature_valid, NEW.received_at)
     IS DISTINCT FROM
     (OLD.id, OLD.workspace_id, OLD.provider_connection_id, OLD.external_event_id,
      OLD.event_type, OLD.payload, OLD.payload_hash, OLD.signature_valid, OLD.received_at) THEN
    RAISE EXCEPTION 'incoming event % identity and payload are immutable', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'RECEIVED' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'incoming event % is in final status %', OLD.id, OLD.status
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER incoming_events_guard BEFORE UPDATE OR DELETE ON incoming_events
  FOR EACH ROW EXECUTE FUNCTION incoming_events_guard();

-- ---- rejected_webhook_attempts ----------------------------------------------

ALTER TABLE rejected_webhook_attempts
  ADD CONSTRAINT rejected_webhook_attempts_payload_hash_check CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT rejected_webhook_attempts_body_bytes_check CHECK (body_bytes >= 0);

CREATE TRIGGER rejected_webhook_attempts_append_only BEFORE UPDATE OR DELETE ON rejected_webhook_attempts
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- ---- transactions -----------------------------------------------------------

ALTER TABLE transactions
  ADD CONSTRAINT transactions_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT transactions_amount_check CHECK (amount_minor > 0),
  ADD CONSTRAINT transactions_refunded_amount_check
    CHECK (refunded_amount_minor >= 0 AND refunded_amount_minor <= amount_minor),
  ADD CONSTRAINT transactions_status_refund_check CHECK (
    CASE status
      WHEN 'SUCCEEDED' THEN refunded_amount_minor = 0
      WHEN 'FAILED' THEN refunded_amount_minor = 0
      WHEN 'PARTIALLY_REFUNDED' THEN refunded_amount_minor > 0 AND refunded_amount_minor < amount_minor
      WHEN 'REFUNDED' THEN refunded_amount_minor = amount_minor
    END
  );

CREATE FUNCTION transactions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'transactions rows cannot be deleted'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.id, NEW.workspace_id, NEW.provider_connection_id, NEW.external_payment_id,
      NEW.currency, NEW.amount_minor, NEW.created_by_event_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.workspace_id, OLD.provider_connection_id, OLD.external_payment_id,
      OLD.currency, OLD.amount_minor, OLD.created_by_event_id, OLD.created_at) THEN
    RAISE EXCEPTION 'transaction % identity, amount and currency are immutable', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER transactions_guard BEFORE UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION transactions_guard();

-- ---- ledger -----------------------------------------------------------------

ALTER TABLE ledger_accounts
  ADD CONSTRAINT ledger_accounts_code_check CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  ADD CONSTRAINT ledger_accounts_currency_check CHECK (currency ~ '^[A-Z]{3}$');

ALTER TABLE ledger_transactions
  ADD CONSTRAINT ledger_transactions_currency_check CHECK (currency ~ '^[A-Z]{3}$');

ALTER TABLE ledger_postings
  ADD CONSTRAINT ledger_postings_amount_check CHECK (amount_minor > 0);

CREATE TRIGGER ledger_accounts_append_only BEFORE UPDATE OR DELETE ON ledger_accounts
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER ledger_transactions_append_only BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER ledger_postings_append_only BEFORE UPDATE OR DELETE ON ledger_postings
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- A journal is open only inside the database transaction that created it. The
-- header row's xmin equals the current transaction id only in that transaction,
-- so this rejects postings appended to a committed journal, including balanced
-- pairs that the balance check alone would accept. Journals and their postings
-- must therefore not be written inside a savepoint.
CREATE FUNCTION ledger_postings_require_open_journal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ledger_transactions
     WHERE id = NEW.ledger_transaction_id
       AND xmin = pg_current_xact_id()::xid
  ) THEN
    RAISE EXCEPTION 'ledger transaction % does not exist or is closed; postings must be written with their journal',
      NEW.ledger_transaction_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_postings_require_open_journal BEFORE INSERT ON ledger_postings
  FOR EACH ROW EXECUTE FUNCTION ledger_postings_require_open_journal();

CREATE FUNCTION ledger_assert_balanced(p_ledger_transaction_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_postings bigint;
  v_debits numeric;
  v_credits numeric;
BEGIN
  SELECT count(*),
         coalesce(sum(amount_minor) FILTER (WHERE direction = 'DEBIT'), 0),
         coalesce(sum(amount_minor) FILTER (WHERE direction = 'CREDIT'), 0)
    INTO v_postings, v_debits, v_credits
    FROM ledger_postings
   WHERE ledger_transaction_id = p_ledger_transaction_id;

  IF v_postings < 2 THEN
    RAISE EXCEPTION 'ledger transaction % has % posting(s); at least 2 are required',
      p_ledger_transaction_id, v_postings
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_debits <> v_credits THEN
    RAISE EXCEPTION 'ledger transaction % is unbalanced: debits %, credits %',
      p_ledger_transaction_id, v_debits, v_credits
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE FUNCTION ledger_transactions_check_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ledger_assert_balanced(NEW.id);
  RETURN NULL;
END;
$$;

CREATE FUNCTION ledger_postings_check_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ledger_assert_balanced(NEW.ledger_transaction_id);
  RETURN NULL;
END;
$$;

-- Deferred to COMMIT so a journal and its postings can be inserted in any order
-- within one transaction but can never be committed unbalanced.
CREATE CONSTRAINT TRIGGER ledger_transactions_balanced
  AFTER INSERT ON ledger_transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_transactions_check_balanced();

CREATE CONSTRAINT TRIGGER ledger_postings_balanced
  AFTER INSERT ON ledger_postings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_postings_check_balanced();

-- ---- webhook_endpoints ------------------------------------------------------

ALTER TABLE webhook_endpoints
  ADD CONSTRAINT webhook_endpoints_url_check CHECK (url ~ '^https?://'),
  ADD CONSTRAINT webhook_endpoints_event_types_check CHECK (cardinality(event_types) > 0);

CREATE FUNCTION webhook_endpoints_reject_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'webhook_endpoints rows cannot be deleted; set deleted_at instead'
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER webhook_endpoints_soft_delete_only BEFORE DELETE ON webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION webhook_endpoints_reject_delete();

-- ---- webhook_deliveries -----------------------------------------------------

ALTER TABLE webhook_deliveries
  ADD CONSTRAINT webhook_deliveries_attempts_check
    CHECK (max_attempts > 0 AND attempt_count >= 0 AND attempt_count <= max_attempts),
  ADD CONSTRAINT webhook_deliveries_lease_check
    CHECK ((status = 'PROCESSING') = (lease_owner IS NOT NULL)
           AND (lease_owner IS NULL) = (lease_expires_at IS NULL)),
  ADD CONSTRAINT webhook_deliveries_pending_check
    CHECK (status <> 'PENDING' OR next_attempt_at IS NOT NULL),
  ADD CONSTRAINT webhook_deliveries_succeeded_check
    CHECK ((status = 'SUCCEEDED') = (delivered_at IS NOT NULL)),
  ADD CONSTRAINT webhook_deliveries_dead_letter_check
    CHECK ((status = 'DEAD_LETTER') = (dead_lettered_at IS NOT NULL)
           AND (dead_lettered_at IS NULL) = (dead_letter_reason IS NULL)),
  ADD CONSTRAINT webhook_deliveries_replay_check
    CHECK (replay_of_delivery_id IS NULL OR replay_of_delivery_id <> id);

CREATE FUNCTION webhook_deliveries_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'webhook_deliveries rows cannot be deleted'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.id, NEW.workspace_id, NEW.event_id, NEW.endpoint_id, NEW.replay_of_delivery_id,
      NEW.payload, NEW.max_attempts, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.workspace_id, OLD.event_id, OLD.endpoint_id, OLD.replay_of_delivery_id,
      OLD.payload, OLD.max_attempts, OLD.created_at) THEN
    RAISE EXCEPTION 'webhook delivery % identity and payload are immutable', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status IN ('SUCCEEDED', 'DEAD_LETTER') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'webhook delivery % is in final status %; replay creates a new delivery',
      OLD.id, OLD.status
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.attempt_count < OLD.attempt_count THEN
    RAISE EXCEPTION 'webhook delivery % attempt_count cannot decrease', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER webhook_deliveries_guard BEFORE UPDATE OR DELETE ON webhook_deliveries
  FOR EACH ROW EXECUTE FUNCTION webhook_deliveries_guard();

-- ---- delivery_attempts ------------------------------------------------------

ALTER TABLE delivery_attempts
  ADD CONSTRAINT delivery_attempts_attempt_number_check CHECK (attempt_number > 0),
  ADD CONSTRAINT delivery_attempts_response_status_check
    CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599),
  ADD CONSTRAINT delivery_attempts_duration_check CHECK (duration_ms IS NULL OR duration_ms >= 0),
  ADD CONSTRAINT delivery_attempts_outcome_check
    CHECK ((outcome = 'UNKNOWN') = (duration_ms IS NULL));

CREATE TRIGGER delivery_attempts_append_only BEFORE UPDATE OR DELETE ON delivery_attempts
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- ---- outbox_messages --------------------------------------------------------
-- Published rows may be deleted by retention pruning: the outbox is a handoff
-- mechanism, not history.

ALTER TABLE outbox_messages
  ADD CONSTRAINT outbox_messages_publish_attempts_check CHECK (publish_attempts >= 0),
  ADD CONSTRAINT outbox_messages_lease_check
    CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL)),
  ADD CONSTRAINT outbox_messages_published_check
    CHECK (published_at IS NULL OR lease_owner IS NULL);
