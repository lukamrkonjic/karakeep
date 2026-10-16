import { Hono } from "hono";

import {
  guestCanSeeAsset,
  guestShareScope,
} from "@karakeep/trpc/lib/guestShares";

import { unauthedMiddleware } from "../../middlewares/auth";
import { serveAsset } from "../../utils/assets";

/**
 * Fork: a guest link's files — the pictures, videos (with ranges, so they
 * seek), posters and banners of the bookmarks its guest can see, by the
 * link's token (packages/trpc/lib/guestShares.ts). Anything else is "not
 * found", whether it exists or not.
 */
const app = new Hono().get(
  "/:token/assets/:assetId",
  unauthedMiddleware,
  async (c) => {
    const { token, assetId } = c.req.param();
    const db = c.var.ctx.db;
    const scope = await guestShareScope(db, token);
    if (!scope || !(await guestCanSeeAsset(db, scope, assetId))) {
      return c.json({ error: "Asset not found" }, { status: 404 });
    }
    // Not "immutable" as the owner's own: a reset link or an unticked list
    // takes it away again.
    return await serveAsset(c, assetId, scope.userId, "private, max-age=3600");
  },
);

export default app;
