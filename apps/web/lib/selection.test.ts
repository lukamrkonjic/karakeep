import { beforeEach, describe, expect, it } from "vitest";

import type { ZBookmark } from "@karakeep/shared/types/bookmarks";

import useBulkActionsStore from "./bulkActions";
import {
  idsBetween,
  selectAllLoaded,
  selectRangeTo,
  startSelection,
  toggleSelection,
} from "./selection";

const bookmark = (id: string, userId = "me") => ({ id, userId }) as ZBookmark;
const mine = (b: ZBookmark) => b.userId === "me";

describe("idsBetween", () => {
  const order = ["a", "b", "c", "d", "e"];

  it("takes both ends and everything between, either way round", () => {
    expect(idsBetween(order, "b", "d")).toEqual(["b", "c", "d"]);
    expect(idsBetween(order, "d", "b")).toEqual(["b", "c", "d"]);
    expect(idsBetween(order, "c", "c")).toEqual(["c"]);
  });

  it("falls back to the target alone when the start isn't there", () => {
    expect(idsBetween(order, "x", "c")).toEqual(["c"]);
    expect(idsBetween(order, "a", "x")).toEqual([]);
  });
});

describe("selecting", () => {
  beforeEach(() => {
    useBulkActionsStore.setState({
      isBulkEditEnabled: false,
      selectedBookmarkIds: [],
      visibleBookmarks: ["a", "b", "c", "d", "e"].map((id) =>
        bookmark(id, id === "c" ? "someone-else" : "me"),
      ),
    });
  });

  it("stays in select mode when the last one is unticked", () => {
    startSelection("a");
    toggleSelection("a");
    expect(useBulkActionsStore.getState()).toMatchObject({
      isBulkEditEnabled: true,
      selectedBookmarkIds: [],
    });
  });

  it("Shift-click adds the range since the last one picked, skipping others' bookmarks", () => {
    startSelection("a");
    selectRangeTo("d", mine);
    expect(useBulkActionsStore.getState().selectedBookmarkIds).toEqual([
      "a",
      "b",
      "d",
    ]);
  });

  it("select all takes only what may be picked", () => {
    selectAllLoaded(mine);
    expect(useBulkActionsStore.getState()).toMatchObject({
      isBulkEditEnabled: true,
      selectedBookmarkIds: ["a", "b", "d", "e"],
    });
  });
});
