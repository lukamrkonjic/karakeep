ALTER TABLE `listSubscriptions` ADD `wholeCarouselSince` integer;--> statement-breakpoint
-- Fork: every subscription goes on as it did. Instagram ones took every
-- picture of a carousel from the start; Pinterest ones only took each pin's
-- own picture, so they stay at "only the first" (null).
UPDATE `listSubscriptions`
SET `wholeCarouselSince` = `createdAt`
WHERE `kind` = 'instagram';
