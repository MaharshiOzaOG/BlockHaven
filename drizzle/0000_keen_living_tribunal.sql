CREATE TABLE `edits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room` text NOT NULL,
	`x` integer NOT NULL,
	`y` integer NOT NULL,
	`z` integer NOT NULL,
	`type` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `edits_room_id` ON `edits` (`room`,`id`);--> statement-breakpoint
CREATE TABLE `players` (
	`token` text PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`room` text NOT NULL,
	`name` text NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`z` real NOT NULL,
	`yaw` real NOT NULL,
	`seen` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `players_room_seen` ON `players` (`room`,`seen`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`created` integer NOT NULL
);
