CREATE TABLE "mail_messages" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"source_updated_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"raw_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"thread_external_id" text NOT NULL,
	"history_id" text,
	"received_at" timestamp with time zone NOT NULL,
	"labels" text[] NOT NULL,
	"from_name" text,
	"from_address" text,
	"to_addresses" jsonb NOT NULL,
	"cc_addresses" jsonb NOT NULL,
	"subject" text,
	"message_id_header" text,
	"in_reply_to" text,
	"references" text[] NOT NULL,
	"snippet_encrypted" text NOT NULL,
	"body_encrypted" text NOT NULL,
	"has_attachments" boolean NOT NULL,
	CONSTRAINT "mail_messages_organization_source_external_unique" UNIQUE("organization_id","source","external_id")
);
--> statement-breakpoint
CREATE TABLE "mail_threads" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"source_updated_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"raw_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"subject" text,
	"last_message_at" timestamp with time zone NOT NULL,
	"message_count" integer NOT NULL,
	"unread" boolean NOT NULL,
	"in_inbox" boolean NOT NULL,
	"has_sent" boolean NOT NULL,
	CONSTRAINT "mail_threads_organization_source_external_unique" UNIQUE("organization_id","source","external_id")
);
--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_connection_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."integration_connections"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_threads" ADD CONSTRAINT "mail_threads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_threads" ADD CONSTRAINT "mail_threads_connection_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."integration_connections"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_messages_connection_received_idx" ON "mail_messages" USING btree ("organization_id","connection_id","received_at");--> statement-breakpoint
CREATE INDEX "mail_messages_thread_idx" ON "mail_messages" USING btree ("organization_id","source","thread_external_id");--> statement-breakpoint
CREATE INDEX "mail_threads_connection_last_idx" ON "mail_threads" USING btree ("organization_id","connection_id","last_message_at");