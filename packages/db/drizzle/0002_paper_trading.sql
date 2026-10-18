ALTER TABLE "positions" ADD COLUMN "paper" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "exit_reason" text;