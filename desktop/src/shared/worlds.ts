/**
 * The isolated world the page capture runs in.
 *
 * It shares the DOM with the page but not its JavaScript context, which is
 * the whole reason the capture can be handed a credentialed fetch: the page
 * itself can never reach into this world to borrow it. It is the same
 * isolation a browser extension's content script gets, and without it a
 * privileged fetch bridge would hand every site you visit a way to read your
 * logged-in data from any other site.
 *
 * Any number above 0 works; 0 is the page's own world.
 */
export const CAPTURE_WORLD = 732;
