-- Moved to the top by hand: the composite foreign keys below need this unique key to exist.
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_organization_id_unique" UNIQUE("organization_id","id");--> statement-breakpoint
CREATE TYPE "public"."invoice_direction" AS ENUM('issued', 'received');--> statement-breakpoint
CREATE TYPE "public"."invoice_kind" AS ENUM('invoice', 'proforma', 'credit_note');--> statement-breakpoint
CREATE TYPE "public"."invoice_source_status" AS ENUM('draft', 'open', 'paid', 'cancelled');--> statement-breakpoint
CREATE TABLE "companies" (
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
	"name" text NOT NULL,
	"ico" text,
	"dic" text,
	"street" text,
	"city" text,
	"postal_code" text,
	"country" text,
	"email" text,
	"phone" text,
	CONSTRAINT "companies_organization_source_external_unique" UNIQUE("organization_id","source","external_id"),
	CONSTRAINT "companies_organization_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "companies_country_format" CHECK ("companies"."country" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "contacts" (
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
	"company_id" uuid,
	"name" text,
	"email" text,
	"phone" text,
	CONSTRAINT "contacts_organization_source_external_unique" UNIQUE("organization_id","source","external_id"),
	CONSTRAINT "contacts_organization_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
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
	"invoice_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"description" text NOT NULL,
	"quantity_milli" integer,
	"unit" text,
	"unit_price_minor" bigint,
	"vat_rate_basis_points" integer,
	"total_minor" bigint NOT NULL,
	CONSTRAINT "invoice_lines_organization_source_external_unique" UNIQUE("organization_id","source","external_id"),
	CONSTRAINT "invoice_lines_organization_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "invoice_lines_position_positive" CHECK ("invoice_lines"."position" >= 1),
	CONSTRAINT "invoice_lines_vat_rate_range" CHECK ("invoice_lines"."vat_rate_basis_points" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "invoice_payments" (
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
	"invoice_id" uuid NOT NULL,
	"paid_on" date NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	CONSTRAINT "invoice_payments_organization_source_external_unique" UNIQUE("organization_id","source","external_id"),
	CONSTRAINT "invoice_payments_organization_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "invoice_payments_currency_format" CHECK ("invoice_payments"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "invoices" (
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
	"company_id" uuid,
	"number" text NOT NULL,
	"variable_symbol" text,
	"kind" "invoice_kind" NOT NULL,
	"direction" "invoice_direction" NOT NULL,
	"source_status" "invoice_source_status" NOT NULL,
	"issued_on" date NOT NULL,
	"taxable_supply_on" date,
	"due_on" date NOT NULL,
	"paid_on" date,
	"currency" text NOT NULL,
	"subtotal_minor" bigint NOT NULL,
	"vat_minor" bigint NOT NULL,
	"total_minor" bigint NOT NULL,
	CONSTRAINT "invoices_organization_source_external_unique" UNIQUE("organization_id","source","external_id"),
	CONSTRAINT "invoices_organization_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "invoices_currency_format" CHECK ("invoices"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "invoices_total_sign" CHECK ("invoices"."kind" = 'credit_note' or "invoices"."total_minor" >= 0),
	CONSTRAINT "invoices_variable_symbol_format" CHECK ("invoices"."variable_symbol" ~ '^[0-9]{1,10}$')
);
--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_connection_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."integration_connections"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_connection_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."integration_connections"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_fk" FOREIGN KEY ("organization_id","company_id") REFERENCES "public"."companies"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_connection_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."integration_connections"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_fk" FOREIGN KEY ("organization_id","invoice_id") REFERENCES "public"."invoices"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_connection_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."integration_connections"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_fk" FOREIGN KEY ("organization_id","invoice_id") REFERENCES "public"."invoices"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_connection_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."integration_connections"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_company_fk" FOREIGN KEY ("organization_id","company_id") REFERENCES "public"."companies"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "companies_organization_ico_idx" ON "companies" USING btree ("organization_id","ico");--> statement-breakpoint
CREATE INDEX "contacts_organization_company_idx" ON "contacts" USING btree ("organization_id","company_id");--> statement-breakpoint
CREATE INDEX "invoice_lines_organization_invoice_idx" ON "invoice_lines" USING btree ("organization_id","invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_payments_organization_invoice_idx" ON "invoice_payments" USING btree ("organization_id","invoice_id");--> statement-breakpoint
CREATE INDEX "invoices_organization_due_idx" ON "invoices" USING btree ("organization_id","due_on");--> statement-breakpoint
CREATE INDEX "invoices_organization_company_idx" ON "invoices" USING btree ("organization_id","company_id");