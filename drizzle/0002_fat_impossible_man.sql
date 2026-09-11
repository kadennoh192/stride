CREATE TABLE `reminder_deliveries` (
	`job` text NOT NULL,
	`endpoint` text NOT NULL,
	`round` integer NOT NULL,
	`delivered` integer NOT NULL,
	PRIMARY KEY(`job`, `endpoint`, `round`)
);
--> statement-breakpoint
CREATE TABLE `reminder_schedule_queue` (
	`owner` text NOT NULL,
	`entity` text NOT NULL,
	`revision` text NOT NULL,
	PRIMARY KEY(`owner`, `entity`)
);
--> statement-breakpoint
ALTER TABLE `reminder_jobs` ADD `round` integer DEFAULT 0 NOT NULL;