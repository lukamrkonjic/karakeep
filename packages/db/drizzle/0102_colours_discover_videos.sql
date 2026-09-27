CREATE TABLE `discoverItems` (
	`id` text PRIMARY KEY NOT NULL,
	`createdAt` integer NOT NULL,
	`userId` text NOT NULL,
	`pinId` text NOT NULL,
	`mediaKey` text,
	`title` text,
	`thumbUrl` text NOT NULL,
	`width` integer,
	`height` integer,
	`media` text NOT NULL,
	`seedBookmarkId` text,
	`embedding` blob,
	`score` real DEFAULT 0 NOT NULL,
	`suggestedListId` text,
	`status` text DEFAULT 'new' NOT NULL,
	`listId` text,
	`bookmarkId` text,
	`decidedAt` integer,
	`error` text,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`seedBookmarkId`) REFERENCES `bookmarks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`suggestedListId`) REFERENCES `bookmarkLists`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`listId`) REFERENCES `bookmarkLists`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`bookmarkId`) REFERENCES `bookmarks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `discoverItems_userId_status_idx` ON `discoverItems` (`userId`,`status`,`score`);--> statement-breakpoint
CREATE INDEX `discoverItems_seedBookmarkId_idx` ON `discoverItems` (`seedBookmarkId`);--> statement-breakpoint
CREATE INDEX `discoverItems_bookmarkId_idx` ON `discoverItems` (`bookmarkId`);--> statement-breakpoint
CREATE UNIQUE INDEX `discoverItems_userId_pinId_unique` ON `discoverItems` (`userId`,`pinId`);--> statement-breakpoint
CREATE TABLE `picturePalettes` (
	`bookmarkId` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`assetId` text NOT NULL,
	`colours` text,
	`sortKey` real,
	FOREIGN KEY (`bookmarkId`) REFERENCES `bookmarks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `picturePalettes_userId_idx` ON `picturePalettes` (`userId`);--> statement-breakpoint
ALTER TABLE `pictureEmbeddings` ADD `duration` real;--> statement-breakpoint
ALTER TABLE `pictureSettings` ADD `palettesEnabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `pictureSettings` ADD `discoverEnabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `pictureSettings` ADD `discoverSchedule` text DEFAULT 'nightly' NOT NULL;