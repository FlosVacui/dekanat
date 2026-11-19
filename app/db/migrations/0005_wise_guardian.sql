CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"answer" text,
	"answered_by" uuid,
	"answered_at" timestamp with time zone,
	"ip" text NOT NULL,
	"answer_ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "questions_topic_check" CHECK ("questions"."topic" in ('schedule', 'resits', 'documents', 'stipend', 'other')),
	CONSTRAINT "questions_body_check" CHECK (char_length("questions"."body") between 1 and 1000 and btrim("questions"."body") <> ''),
	CONSTRAINT "questions_status_check" CHECK ("questions"."status" in ('sent', 'answered')),
	CONSTRAINT "questions_answer_check" CHECK ("questions"."answer" is null or (char_length("questions"."answer") between 1 and 1000 and btrim("questions"."answer") <> '')),
	CONSTRAINT "questions_answered_check" CHECK (("questions"."status" = 'sent' and "questions"."answer" is null and "questions"."answered_at" is null)
        or ("questions"."status" = 'answered' and "questions"."answer" is not null and "questions"."answered_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_student_id_students_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_answered_by_users_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "questions_student_idx" ON "questions" USING btree ("student_id","created_at");--> statement-breakpoint
CREATE INDEX "questions_ip_created_idx" ON "questions" USING btree ("ip","created_at");--> statement-breakpoint
CREATE INDEX "questions_answered_by_idx" ON "questions" USING btree ("answered_by","answered_at");