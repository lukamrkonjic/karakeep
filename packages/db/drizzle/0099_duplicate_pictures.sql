CREATE TABLE `duplicatePictures` (
	`id` text PRIMARY KEY NOT NULL,
	`createdAt` integer NOT NULL,
	`userId` text NOT NULL,
	`bookmarkId` text NOT NULL,
	`otherBookmarkId` text NOT NULL,
	`distance` real NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bookmarkId`) REFERENCES `bookmarks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`otherBookmarkId`) REFERENCES `bookmarks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `duplicatePictures_userId_idx` ON `duplicatePictures` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `duplicatePictures_otherBookmarkId_idx` ON `duplicatePictures` (`otherBookmarkId`);--> statement-breakpoint
CREATE UNIQUE INDEX `duplicatePictures_bookmarkId_otherBookmarkId_unique` ON `duplicatePictures` (`bookmarkId`,`otherBookmarkId`);--> statement-breakpoint
CREATE TABLE `pictureDuplicateScans` (
	`userId` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`checkedAt` integer,
	`error` text,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pictureEmbeddings` (
	`bookmarkId` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`assetId` text NOT NULL,
	`model` text NOT NULL,
	`embedding` blob,
	`width` integer,
	`height` integer,
	`compared` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`bookmarkId`) REFERENCES `bookmarks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pictureEmbeddings_userId_idx` ON `pictureEmbeddings` (`userId`,`compared`);