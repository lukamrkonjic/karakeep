CREATE TABLE `smartListRules` (
	`listId` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`rules` text NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`listId`) REFERENCES `bookmarkLists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
