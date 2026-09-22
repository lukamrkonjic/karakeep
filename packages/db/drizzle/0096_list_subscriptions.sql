CREATE TABLE `listSubscriptionImports` (
	`id` text PRIMARY KEY NOT NULL,
	`createdAt` integer NOT NULL,
	`userId` text NOT NULL,
	`subscriptionId` text,
	`externalId` text NOT NULL,
	`mediaKey` text,
	`bookmarkId` text,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subscriptionId`) REFERENCES `listSubscriptions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`bookmarkId`) REFERENCES `bookmarks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `listSubscriptionImports_subscriptionId_idx` ON `listSubscriptionImports` (`subscriptionId`);--> statement-breakpoint
CREATE INDEX `listSubscriptionImports_userId_mediaKey_idx` ON `listSubscriptionImports` (`userId`,`mediaKey`);--> statement-breakpoint
CREATE INDEX `listSubscriptionImports_bookmarkId_idx` ON `listSubscriptionImports` (`bookmarkId`);--> statement-breakpoint
CREATE UNIQUE INDEX `listSubscriptionImports_subscriptionId_externalId_unique` ON `listSubscriptionImports` (`subscriptionId`,`externalId`);--> statement-breakpoint
CREATE TABLE `listSubscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`createdAt` integer NOT NULL,
	`listId` text NOT NULL,
	`userId` text NOT NULL,
	`kind` text DEFAULT 'pinterest' NOT NULL,
	`url` text NOT NULL,
	`name` text,
	`enabled` integer DEFAULT true NOT NULL,
	`lastRunAt` integer,
	`lastStatus` text DEFAULT 'pending',
	`lastError` text,
	`lastImportedCount` integer,
	FOREIGN KEY (`listId`) REFERENCES `bookmarkLists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `listSubscriptions_listId_idx` ON `listSubscriptions` (`listId`);--> statement-breakpoint
CREATE INDEX `listSubscriptions_userId_idx` ON `listSubscriptions` (`userId`);--> statement-breakpoint
CREATE UNIQUE INDEX `listSubscriptions_listId_url_unique` ON `listSubscriptions` (`listId`,`url`);--> statement-breakpoint
ALTER TABLE `user` ADD `subscriptionIntervalHours` integer DEFAULT 12 NOT NULL;