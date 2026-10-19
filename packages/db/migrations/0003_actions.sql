CREATE TYPE "public"."action_approval_level" AS ENUM('user', 'none');--> statement-breakpoint
CREATE TYPE "public"."action_status" AS ENUM('proposed', 'approved', 'executing', 'succeeded', 'failed', 'verified', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."action_type" AS ENUM('invoice_reminder');--> statement-breakpoint
CREATE TYPE "public"."approval_decision" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TABLE "actions" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" "action_type" NOT NULL,
	"status" "action_status" DEFAULT 'proposed' NOT NULL,
	"trigger_code" text NOT NULL,
	"trigger_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preview" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"approval_level" "action_approval_level" NOT NULL,
	"expires_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"proposed_by_type" "audit_actor_type" NOT NULL,
	"proposed_by_user_id" uuid,
	"result_reference" text,
	"error_code" text,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "actions_organization_idempotency_key_unique" UNIQUE("organization_id","idempotency_key"),
	CONSTRAINT "actions_organization_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "actions_user_proposer_has_id" CHECK ("actions"."proposed_by_type" <> 'user' or "actions"."proposed_by_user_id" is not null),
	CONSTRAINT "actions_idempotency_key_not_empty" CHECK (length("actions"."idempotency_key") > 0)
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"decision" "approval_decision" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvals_action_id_unique" UNIQUE("action_id")
);
--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_proposed_by_user_id_users_id_fk" FOREIGN KEY ("proposed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_action_fk" FOREIGN KEY ("organization_id","action_id") REFERENCES "public"."actions"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actions_organization_status_idx" ON "actions" USING btree ("organization_id","status");