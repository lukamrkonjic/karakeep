CREATE TABLE `pictureSeen` (
	`bookmarkId` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`openedAt` integer,
	`discoveredAt` integer,
	`discoverPosition` integer,
	FOREIGN KEY (`bookmarkId`) REFERENCES `bookmarks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pictureSeen_userId_idx` ON `pictureSeen` (`userId`,`discoveredAt`);