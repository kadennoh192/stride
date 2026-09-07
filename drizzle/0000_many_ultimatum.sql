CREATE TABLE `changes` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `changes_owner_seq` ON `changes` (`owner`,`seq`);--> statement-breakpoint
CREATE TABLE `dedup` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE TABLE `fields` (
	`owner` text NOT NULL,
	`entity` text NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`stamp` text NOT NULL,
	PRIMARY KEY(`owner`, `entity`, `key`)
);
--> statement-breakpoint
CREATE TABLE `watch_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`created` text NOT NULL,
	`expires` text NOT NULL
);
