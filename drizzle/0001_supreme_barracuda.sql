CREATE TABLE `dispatch_nonces` (
	`nonce` text PRIMARY KEY NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`owner` text NOT NULL,
	`endpoint` text NOT NULL,
	`payload` text NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`owner`, `endpoint`)
);
--> statement-breakpoint
CREATE TABLE `reminder_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`entity` text NOT NULL,
	`due` integer NOT NULL,
	`original_due` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`repeat_minutes` integer DEFAULT 0 NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`lease` integer DEFAULT 0 NOT NULL,
	`last_error` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reminder_due` ON `reminder_jobs` (`state`,`due`);