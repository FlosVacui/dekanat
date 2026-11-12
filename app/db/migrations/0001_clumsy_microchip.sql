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
CREATE INDEX "request_events_by_user_idx" ON "request_events" USING btree ("by_user_id","created_at");--> statement-breakpoint
-- Вручную, не из схемы: права роли приложения на счётчики входа (пакет 3.1). Приложение пишет в них одной атомарной
-- операцией и чистит строки по давности. Список прав в db/migrate-lib.ts пакет 3.1 менять не мог, поэтому выдача здесь:
-- имя роли `dekanat_app` одно и то же в локальной настройке (db/setup-local.mjs) и в Compose (db/docker-init).
-- Роли нет — выдавать некому, шаг пропускается.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dekanat_app') THEN
		GRANT INSERT, UPDATE, DELETE ON login_attempts, login_ip_windows, login_streaks TO "dekanat_app";
	END IF;
END
$$;