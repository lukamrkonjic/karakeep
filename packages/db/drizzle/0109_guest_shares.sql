CREATE TABLE `guestShareLists` (
	`shareId` text NOT NULL,
	`listId` text NOT NULL,
	PRIMARY KEY(`shareId`, `listId`),
	FOREIGN KEY (`shareId`) REFERENCES `guestShares`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`listId`) REFERENCES `bookmarkLists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `guestShareLists_listId_idx` ON `guestShareLists` (`listId`);--> statement-breakpoint
CREATE TABLE `guestShares` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`token` text NOT NULL,
	`name` text NOT NULL,
	`showNotes` integer DEFAULT false NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `guestShares_token_unique` ON `guestShares` (`token`);--> statement-breakpoint
CREATE INDEX `guestShares_userId_idx` ON `guestShares` (`userId`);