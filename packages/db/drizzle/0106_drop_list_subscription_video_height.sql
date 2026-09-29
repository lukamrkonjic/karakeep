-- YouTube lists as subscriptions were taken out again (0105 added this
-- column for them). Any YouTube subscription goes; its videos stay, and its
-- record of what it took lets go of it, as when a subscription is removed.
UPDATE `listSubscriptionImports` SET `subscriptionId` = NULL WHERE `subscriptionId` IN (SELECT `id` FROM `listSubscriptions` WHERE `kind` = 'youtube');--> statement-breakpoint
DELETE FROM `listSubscriptions` WHERE `kind` = 'youtube';--> statement-breakpoint
ALTER TABLE `listSubscriptions` DROP COLUMN `maxVideoHeight`;
