import { Hono } from "hono";

import assets from "./public/assets";
import guestShares from "./public/guestShares";

const app = new Hono()
  .route("/assets", assets)
  // Fork: a guest link's files (Share with a guest…).
  .route("/shares", guestShares);

export default app;
