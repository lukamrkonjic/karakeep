ALTER TABLE `bookmarkLists` ADD `position` real DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `bookmarkLists_userId_parentId_position_idx` ON `bookmarkLists` (`userId`,`parentId`,`position`);--> statement-breakpoint
-- Backfill position from createdAt so existing lists keep their creation
-- order (newest on top, since sorting is descending by position) instead of
-- all tying at the default of 0.
UPDATE `bookmarkLists` SET `position` = `createdAt`;