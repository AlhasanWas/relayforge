-- CreateEnum
CREATE TYPE "api_key_role" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "audit_actor_type" AS ENUM ('API_KEY', 'SYSTEM');

-- CreateEnum
CREATE TYPE "provider_adapter_type" AS ENUM ('MOCKPAY');

-- CreateEnum
CREATE TYPE "incoming_event_status" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "rejection_reason" AS ENUM ('CONNECTION_DISABLED', 'MISSING_SIGNATURE_HEADERS', 'MALFORMED_SIGNATURE_HEADERS', 'INVALID_SIGNATURE', 'TIMESTAMP_OUTSIDE_TOLERANCE', 'INVALID_PAYLOAD', 'PAYLOAD_CONFLICT');

-- CreateEnum
CREATE TYPE "transaction_status" AS ENUM ('SUCCEEDED', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ledger_account_type" AS ENUM ('ASSET', 'LIABILITY');

-- CreateEnum
CREATE TYPE "ledger_transaction_kind" AS ENUM ('PAYMENT_CAPTURED', 'PAYMENT_REFUNDED');

-- CreateEnum
CREATE TYPE "posting_direction" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "delivery_status" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "dead_letter_reason" AS ENUM ('MAX_ATTEMPTS_EXHAUSTED', 'NON_RETRYABLE_RESPONSE', 'ENDPOINT_UNAVAILABLE');

-- CreateEnum
CREATE TYPE "attempt_outcome" AS ENUM ('SUCCESS', 'RETRYABLE_FAILURE', 'PERMANENT_FAILURE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "outbox_topic" AS ENUM ('EVENT_PROCESSING_REQUESTED', 'WEBHOOK_DELIVERY_REQUESTED');

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "role" "api_key_role" NOT NULL,
    "prefix" TEXT NOT NULL,
    "key_hash" CHAR(64) NOT NULL,
    "last_used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "actor_type" "audit_actor_type" NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_definitions" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "adapter_type" "provider_adapter_type" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_connections" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "provider_definition_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "public_ingress_key" TEXT NOT NULL,
    "signing_secret_encrypted" TEXT NOT NULL,
    "timestamp_tolerance_sec" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incoming_events" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "provider_connection_id" UUID NOT NULL,
    "external_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "signature_valid" BOOLEAN NOT NULL,
    "status" "incoming_event_status" NOT NULL DEFAULT 'RECEIVED',
    "processing_attempts" INTEGER NOT NULL DEFAULT 0,
    "failure_reason" TEXT,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "incoming_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rejected_webhook_attempts" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "provider_connection_id" UUID NOT NULL,
    "reason" "rejection_reason" NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "body_bytes" INTEGER NOT NULL,
    "request_id" TEXT NOT NULL,
    "source_ip" TEXT,
    "metadata" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rejected_webhook_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "provider_connection_id" UUID NOT NULL,
    "external_payment_id" TEXT NOT NULL,
    "status" "transaction_status" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "refunded_amount_minor" BIGINT NOT NULL DEFAULT 0,
    "created_by_event_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "type" "ledger_account_type" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_transactions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "source_event_id" UUID NOT NULL,
    "kind" "ledger_transaction_kind" NOT NULL,
    "external_reference_id" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_postings" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "ledger_transaction_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "direction" "posting_direction" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_postings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "event_types" TEXT[],
    "signing_secret_encrypted" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "endpoint_id" UUID NOT NULL,
    "replay_of_delivery_id" UUID,
    "payload" JSONB NOT NULL,
    "status" "delivery_status" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL,
    "next_attempt_at" TIMESTAMPTZ(3),
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "dead_lettered_at" TIMESTAMPTZ(3),
    "dead_letter_reason" "dead_letter_reason",
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_attempts" (
    "id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "outcome" "attempt_outcome" NOT NULL,
    "response_status" INTEGER,
    "error_code" TEXT,
    "error_message" TEXT,
    "response_body" TEXT,
    "duration_ms" INTEGER,
    "started_at" TIMESTAMPTZ(3),
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_messages" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "topic" "outbox_topic" NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "available_at" TIMESTAMPTZ(3) NOT NULL,
    "publish_attempts" INTEGER NOT NULL DEFAULT 0,
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "published_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_prefix_key" ON "api_keys"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_workspace_id_id_idx" ON "api_keys"("workspace_id", "id" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_workspace_id_id_idx" ON "audit_logs"("workspace_id", "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "provider_definitions_slug_key" ON "provider_definitions"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "provider_connections_public_ingress_key_key" ON "provider_connections"("public_ingress_key");

-- CreateIndex
CREATE INDEX "provider_connections_workspace_id_id_idx" ON "provider_connections"("workspace_id", "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "provider_connections_id_workspace_id_key" ON "provider_connections"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "incoming_events_workspace_id_id_idx" ON "incoming_events"("workspace_id", "id" DESC);

-- CreateIndex
CREATE INDEX "incoming_events_received_at_idx" ON "incoming_events"("received_at") WHERE (status = 'RECEIVED');

-- CreateIndex
CREATE UNIQUE INDEX "incoming_events_provider_connection_id_external_event_id_key" ON "incoming_events"("provider_connection_id", "external_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "incoming_events_id_workspace_id_key" ON "incoming_events"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "rejected_webhook_attempts_workspace_id_id_idx" ON "rejected_webhook_attempts"("workspace_id", "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "transactions_created_by_event_id_key" ON "transactions"("created_by_event_id");

-- CreateIndex
CREATE INDEX "transactions_workspace_id_id_idx" ON "transactions"("workspace_id", "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "transactions_provider_connection_id_external_payment_id_key" ON "transactions"("provider_connection_id", "external_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_id_workspace_id_key" ON "transactions"("id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_workspace_id_code_currency_key" ON "ledger_accounts"("workspace_id", "code", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_id_workspace_id_currency_key" ON "ledger_accounts"("id", "workspace_id", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_source_event_id_key" ON "ledger_transactions"("source_event_id");

-- CreateIndex
CREATE INDEX "ledger_transactions_workspace_id_id_idx" ON "ledger_transactions"("workspace_id", "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_transaction_id_kind_external_reference__key" ON "ledger_transactions"("transaction_id", "kind", "external_reference_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_id_workspace_id_currency_key" ON "ledger_transactions"("id", "workspace_id", "currency");

-- CreateIndex
CREATE INDEX "ledger_postings_ledger_transaction_id_idx" ON "ledger_postings"("ledger_transaction_id");

-- CreateIndex
CREATE INDEX "ledger_postings_account_id_idx" ON "ledger_postings"("account_id");

-- CreateIndex
CREATE INDEX "webhook_endpoints_workspace_id_id_idx" ON "webhook_endpoints"("workspace_id", "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "webhook_endpoints_id_workspace_id_key" ON "webhook_endpoints"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_workspace_id_id_idx" ON "webhook_deliveries"("workspace_id", "id" DESC);

-- CreateIndex
CREATE INDEX "webhook_deliveries_workspace_id_status_id_idx" ON "webhook_deliveries"("workspace_id", "status", "id" DESC);

-- CreateIndex
CREATE INDEX "webhook_deliveries_next_attempt_at_idx" ON "webhook_deliveries"("next_attempt_at") WHERE (status = 'PENDING');

-- CreateIndex
CREATE INDEX "webhook_deliveries_lease_expires_at_idx" ON "webhook_deliveries"("lease_expires_at") WHERE (status = 'PROCESSING');

-- CreateIndex
CREATE UNIQUE INDEX "webhook_deliveries_original_key" ON "webhook_deliveries"("event_id", "endpoint_id") WHERE (replay_of_delivery_id IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "webhook_deliveries_active_replay_key" ON "webhook_deliveries"("replay_of_delivery_id") WHERE (status = 'PENDING' OR status = 'PROCESSING');

-- CreateIndex
CREATE UNIQUE INDEX "delivery_attempts_delivery_id_attempt_number_key" ON "delivery_attempts"("delivery_id", "attempt_number");

-- CreateIndex
CREATE INDEX "outbox_messages_unpublished_idx" ON "outbox_messages"("available_at") WHERE (published_at IS NULL);

-- CreateIndex
CREATE INDEX "outbox_messages_aggregate_id_idx" ON "outbox_messages"("aggregate_id");

-- CreateIndex
CREATE INDEX "outbox_messages_published_idx" ON "outbox_messages"("published_at") WHERE (published_at IS NOT NULL);

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_provider_definition_id_fkey" FOREIGN KEY ("provider_definition_id") REFERENCES "provider_definitions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "incoming_events" ADD CONSTRAINT "incoming_events_provider_connection_id_workspace_id_fkey" FOREIGN KEY ("provider_connection_id", "workspace_id") REFERENCES "provider_connections"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "rejected_webhook_attempts" ADD CONSTRAINT "rejected_webhook_attempts_provider_connection_id_workspace_fkey" FOREIGN KEY ("provider_connection_id", "workspace_id") REFERENCES "provider_connections"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_provider_connection_id_workspace_id_fkey" FOREIGN KEY ("provider_connection_id", "workspace_id") REFERENCES "provider_connections"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_created_by_event_id_workspace_id_fkey" FOREIGN KEY ("created_by_event_id", "workspace_id") REFERENCES "incoming_events"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_transaction_id_workspace_id_fkey" FOREIGN KEY ("transaction_id", "workspace_id") REFERENCES "transactions"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_source_event_id_workspace_id_fkey" FOREIGN KEY ("source_event_id", "workspace_id") REFERENCES "incoming_events"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_ledger_transaction_id_workspace_id_currenc_fkey" FOREIGN KEY ("ledger_transaction_id", "workspace_id", "currency") REFERENCES "ledger_transactions"("id", "workspace_id", "currency") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_account_id_workspace_id_currency_fkey" FOREIGN KEY ("account_id", "workspace_id", "currency") REFERENCES "ledger_accounts"("id", "workspace_id", "currency") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_event_id_workspace_id_fkey" FOREIGN KEY ("event_id", "workspace_id") REFERENCES "incoming_events"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_workspace_id_fkey" FOREIGN KEY ("endpoint_id", "workspace_id") REFERENCES "webhook_endpoints"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_replay_of_delivery_id_fkey" FOREIGN KEY ("replay_of_delivery_id") REFERENCES "webhook_deliveries"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "webhook_deliveries"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
