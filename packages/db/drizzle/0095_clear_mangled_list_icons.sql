-- Fork: clear list icons that are nothing but question marks, U+FFFD or
-- blanks. An emoji that went through a non-Unicode code page is stored as
-- "??" (one "?" per UTF-16 half) and was shown in front of the list's name
-- everywhere: the web app, the browser extension, the API. Kept in step with
-- normalizeListIcon() in packages/shared/utils/listUtils.ts, which stops new
-- ones being written.
UPDATE `bookmarkLists`
SET `icon` = ''
WHERE `icon` <> ''
  AND trim(replace(replace(`icon`, '?', ''), char(65533), '')) = '';
