CREATE TABLE "assignment_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"points" integer NOT NULL,
	CONSTRAINT "assignment_results_student_assignment_unique" UNIQUE("student_id","assignment_id"),
	CONSTRAINT "assignment_results_points_check" CHECK ("assignment_results"."points" >= 0)
);
--> statement-breakpoint
CREATE TABLE "course_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discipline_id" uuid NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "course_materials_discipline_title_unique" UNIQUE("discipline_id","title")
);
--> statement-breakpoint
ALTER TABLE "assignment_results" ADD CONSTRAINT "assignment_results_student_id_students_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_results" ADD CONSTRAINT "assignment_results_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_materials" ADD CONSTRAINT "course_materials_discipline_id_disciplines_id_fk" FOREIGN KEY ("discipline_id") REFERENCES "public"."disciplines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignment_results_assignment_idx" ON "assignment_results" USING btree ("assignment_id");