ALTER TABLE "requests" ADD COLUMN "rating" smallint;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "rated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_rating_check" CHECK ("requests"."rating" is null or ("requests"."rating" in (-1, 1) and "requests"."status" = 'issued' and "requests"."rated_at" is not null));