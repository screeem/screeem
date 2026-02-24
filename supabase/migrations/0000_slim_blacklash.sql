CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"twitter_handle" text,
	"linkedin_handle" text,
	"updated_at" timestamp with time zone DEFAULT now()
);
