CREATE TABLE `instagramSessions` (
	`userId` text PRIMARY KEY NOT NULL,
	`createdAt` integer NOT NULL,
	`session` text NOT NULL,
	`instagramUserId` text NOT NULL,
	`username` text,
	`status` text DEFAULT 'ok' NOT NULL,
	`checkedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
