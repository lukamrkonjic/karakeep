CREATE TABLE `projectItems` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`kind` text NOT NULL,
	`bookmarkId` text,
	`text` text,
	`style` text,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`w` real NOT NULL,
	`h` real NOT NULL,
	`z` real DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bookmarkId`) REFERENCES `bookmarks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `projectItems_projectId_idx` ON `projectItems` (`projectId`);--> statement-breakpoint
CREATE INDEX `projectItems_bookmarkId_idx` ON `projectItems` (`bookmarkId`);--> statement-breakpoint
CREATE UNIQUE INDEX `projectItems_projectId_bookmarkId_unique` ON `projectItems` (`projectId`,`bookmarkId`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `projects_userId_updatedAt_idx` ON `projects` (`userId`,`updatedAt`);--> statement-breakpoint
CREATE TABLE `smartListLeftOut` (
	`listId` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`lists` text NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`listId`) REFERENCES `bookmarkLists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Fork: the lists left out of colours were one choice for the account (List
-- settings → Colours); each smart list now picks its own. Those that asked
-- for a colour keep leaving them out, as their own choice — except a list
-- their rules name, which they always showed.
INSERT INTO `smartListLeftOut` (`listId`, `userId`, `lists`, `updatedAt`)
SELECT sl.`id`, sl.`userId`, json_group_array(lo.`value`), CAST(strftime('%s', 'now') AS INTEGER)
FROM `bookmarkLists` sl
JOIN `user` u ON u.`id` = sl.`userId`
JOIN json_each(CASE WHEN json_valid(u.`uiPreferences`) THEN u.`uiPreferences` ELSE '{}' END, '$.colourLeftOutLists') lo
WHERE sl.`type` = 'smart'
  AND sl.`query` LIKE '%color:%'
  AND instr(sl.`query`, lo.`value`) = 0
GROUP BY sl.`id`, sl.`userId`;
