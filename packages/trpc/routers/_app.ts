import { router } from "../index";
import { adminAppRouter } from "./admin";
import { apiKeysAppRouter } from "./apiKeys";
import { assetsAppRouter } from "./assets";
import { backupsAppRouter } from "./backups";
import { bookmarksAppRouter } from "./bookmarks";
import { configAppRouter } from "./config";
import { feedsAppRouter } from "./feeds";
import { highlightsAppRouter } from "./highlights";
import { importSessionsRouter } from "./importSessions";
import { duplicatePicturesAppRouter } from "./duplicatePictures";
import { instagramAppRouter } from "./instagram";
import { invitesAppRouter } from "./invites";
import { listSubscriptionsAppRouter } from "./listSubscriptions";
import { picturesAppRouter } from "./pictures";
import { uiPreferencesAppRouter } from "./uiPreferences";
import { listsAppRouter } from "./lists";
import { promptsAppRouter } from "./prompts";
import { publicBookmarks } from "./publicBookmarks";
import { rulesAppRouter } from "./rules";
import { subscriptionsRouter } from "./subscriptions";
import { tagsAppRouter } from "./tags";
import { usersAppRouter } from "./users";
import { webhooksAppRouter } from "./webhooks";

export const appRouter = router({
  bookmarks: bookmarksAppRouter,
  apiKeys: apiKeysAppRouter,
  users: usersAppRouter,
  lists: listsAppRouter,
  tags: tagsAppRouter,
  prompts: promptsAppRouter,
  admin: adminAppRouter,
  feeds: feedsAppRouter,
  backups: backupsAppRouter,
  highlights: highlightsAppRouter,
  importSessions: importSessionsRouter,
  webhooks: webhooksAppRouter,
  assets: assetsAppRouter,
  rules: rulesAppRouter,
  invites: invitesAppRouter,
  publicBookmarks: publicBookmarks,
  subscriptions: subscriptionsRouter,
  listSubscriptions: listSubscriptionsAppRouter,
  instagram: instagramAppRouter,
  duplicatePictures: duplicatePicturesAppRouter,
  // Fork: Settings → Pictures, similar pictures, search by description,
  // list suggestions.
  pictures: picturesAppRouter,
  uiPreferences: uiPreferencesAppRouter,
  config: configAppRouter,
});
// export type definition of API
export type AppRouter = typeof appRouter;
