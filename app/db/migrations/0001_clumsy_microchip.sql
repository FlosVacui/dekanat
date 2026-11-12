CREATE TABLE "login_attempts" (
	"ip" text NOT NULL,
	"login" text NOT NULL,
	"fails" integer NOT NULL,
	"next_allowed_at" timestamp with time zone NOT NULL,
	"last_attempt_at" timestamp with time zone NOT NULL,
	CONSTRAINT "login_attempts_ip_login_pk" PRIMARY KEY("ip","login")
);
--> statement-breakpoint
CREATE TABLE "login_ip_windows" (
	"ip" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"attempts" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_streaks" (
	"login" text PRIMARY KEY NOT NULL,
	"fails" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "request_events" ADD COLUMN "ip" text;--> statement-breakpoint
CREATE INDEX "login_attempts_last_idx" ON "login_attempts" USING btree ("last_attempt_at");--> statement-breakpoint
CREATE INDEX "login_ip_windows_start_idx" ON "login_ip_windows" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX "request_events_by_user_idx" ON "request_events" USING btree ("by_user_id","created_at");