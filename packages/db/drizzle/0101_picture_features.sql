CREATE TABLE `pictureJobRuns` (
	`userId` text NOT NULL,
	`job` text NOT NULL,
	`status` text NOT NULL,
	`finishedAt` integer,
	`error` text,
	`detail` text,
	PRIMARY KEY(`userId`, `job`),
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pictureListSuggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`createdAt` integer NOT NULL,
	`userId` text NOT NULL,
	`bookmarkId` text NOT NULL,
	`listId` text NOT NULL,
	`score` real NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bookmarkId`) REFERENCES `bookmarks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`listId`) REFERENCES `bookmarkLists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pictureListSuggestions_userId_idx` ON `pictureListSuggestions` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `pictureListSuggestions_listId_idx` ON `pictureListSuggestions` (`listId`);--> statement-breakpoint
CREATE UNIQUE INDEX `pictureListSuggestions_bookmarkId_listId_unique` ON `pictureListSuggestions` (`bookmarkId`,`listId`);--> statement-breakpoint
CREATE TABLE `pictureSettings` (
	`userId` text PRIMARY KEY NOT NULL,
	`fingerprintSchedule` text DEFAULT 'hourly' NOT NULL,
	`similarEnabled` integer DEFAULT true NOT NULL,
	`similarLevel` text DEFAULT 'related' NOT NULL,
	`describeEnabled` integer DEFAULT true NOT NULL,
	`describeLevel` text DEFAULT 'balanced' NOT NULL,
	`suggestionsEnabled` integer DEFAULT true NOT NULL,
	`suggestionsLevel` text DEFAULT 'likely' NOT NULL,
	`suggestionsScope` text DEFAULT 'new' NOT NULL,
	`suggestionsSince` integer NOT NULL,
	`duplicatesSchedule` text DEFAULT 'nightly' NOT NULL,
	`importDuplicateLevel` text DEFAULT 'near' NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pictureTextQueries` (
	`id` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`embedding` blob,
	`error` text,
	`createdAt` integer NOT NULL,
	`usedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pictureTextQueries_usedAt_idx` ON `pictureTextQueries` (`usedAt`);--> statement-breakpoint
ALTER TABLE `listSubscriptions` ADD `skipNearDuplicates` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `pictureEmbeddings` ADD `suggested` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Fork: every account gets its Settings → Pictures, the defaults. List
-- suggestions are for pictures saved from now on (the "new" ones), not for
-- the whole library at once.
INSERT INTO `pictureSettings` (`userId`, `suggestionsSince`)
SELECT `id`, CAST(strftime('%s', 'now') AS INTEGER) FROM `user`;
