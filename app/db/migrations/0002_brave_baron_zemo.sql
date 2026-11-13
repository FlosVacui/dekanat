ALTER TABLE "requests" ADD COLUMN "purpose" text;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "payment_year" integer;--> statement-breakpoint
-- Существующие заявки получают значения по умолчанию (пакет 3.4): справка из деканата — «По месту требования»,
-- справка об оплате — прошлый год, но не раньше 2024. Без этого ограничение по виду ниже не встало бы.
-- Год считается по часовому поясу вуза по умолчанию (Europe/Moscow), как остальные даты приложения.
UPDATE "requests" SET "purpose" = 'on_demand' WHERE "kind" = 'dean_certificate' AND "purpose" IS NULL;--> statement-breakpoint
UPDATE "requests" SET "payment_year" = greatest(2024, extract(year from (now() AT TIME ZONE 'Europe/Moscow'))::int - 1) WHERE "kind" = 'tuition_certificate' AND "payment_year" IS NULL;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_purpose_check" CHECK ("requests"."purpose" is null or "requests"."purpose" in ('pension_fund', 'passport_office', 'parents_workplace', 'student_workplace', 'tax_office', 'social_security', 'insurance', 'library', 'university', 'embassy', 'mosgortrans', 'traffic_police', 'on_demand', 'residence', 'railway_tickets', 'summons', 'study_period'));--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_payment_year_check" CHECK ("requests"."payment_year" is null or "requests"."payment_year" >= 2024);--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_fields_by_kind_check" CHECK (("requests"."kind" = 'dean_certificate' and "requests"."purpose" is not null and "requests"."payment_year" is null)
        or ("requests"."kind" = 'tuition_certificate' and "requests"."purpose" is null and "requests"."payment_year" is not null)
        or ("requests"."kind" = 'financial_aid' and "requests"."purpose" is null and "requests"."payment_year" is null));
