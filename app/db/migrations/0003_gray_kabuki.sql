ALTER TABLE "lesson_changes" ADD COLUMN "new_date" date;--> statement-breakpoint
ALTER TABLE "lesson_changes" ADD COLUMN "new_starts_at" time;--> statement-breakpoint
ALTER TABLE "lesson_changes" ADD COLUMN "new_ends_at" time;--> statement-breakpoint
ALTER TABLE "lesson_changes" ADD COLUMN "new_room" text;