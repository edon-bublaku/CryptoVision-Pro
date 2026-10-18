CREATE TABLE "exchange_keys" (
	"user_id" uuid NOT NULL,
	"env" text NOT NULL,
	"market" text NOT NULL,
	"api_key_enc" text NOT NULL,
	"secret_enc" text NOT NULL,
	"key_hint" text NOT NULL,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_keys_user_id_env_market_pk" PRIMARY KEY("user_id","env","market")
);
--> statement-breakpoint
CREATE TABLE "trade_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"intent_id" text NOT NULL,
	"env" text NOT NULL,
	"market" text NOT NULL,
	"symbol" text NOT NULL,
	"action" text NOT NULL,
	"status" text NOT NULL,
	"request" jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"live_enabled" boolean DEFAULT false NOT NULL,
	"live_enabled_at" timestamp with time zone,
	"kill_switch" boolean DEFAULT false NOT NULL,
	"max_risk_pct" double precision DEFAULT 2 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exchange_keys" ADD CONSTRAINT "exchange_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_intents" ADD CONSTRAINT "trade_intents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_settings" ADD CONSTRAINT "trading_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trade_intents_user_intent_idx" ON "trade_intents" USING btree ("user_id","intent_id");--> statement-breakpoint
CREATE INDEX "trade_intents_user_idx" ON "trade_intents" USING btree ("user_id","created_at");