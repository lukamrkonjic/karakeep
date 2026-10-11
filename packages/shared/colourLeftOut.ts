import type { Matcher } from "./types/search";

/**
 * Fork: the lists left out of colours (List settings → Colours, the account
 * preference `colourLeftOutLists`) — their pictures, and those of every list
 * under them, show neither on a colour page nor in a smart list that asks
 * for a colour. A list the smart list's own rules name is the exception:
 * it asked for it.
 */

/** Does it ask for a colour (`color:` anywhere in it, not turned round)? */
export function asksForColour(matcher: Matcher): boolean {
  switch (matcher.type) {
    case "color":
      return !matcher.inverse;
    case "and":
    case "or":
      return matcher.matchers.some(asksForColour);
    default:
      return false;
  }
}

/** The lists it names (`listid:`, either way round). */
export function listsNamedIn(matcher: Matcher): string[] {
  switch (matcher.type) {
    case "listId":
      return [matcher.listId];
    case "and":
    case "or":
      return matcher.matchers.flatMap(listsNamedIn);
    default:
      return [];
  }
}

/** The left-out lists a smart list of this matcher leaves out. */
export function colourLeftOutFor(
  matcher: Matcher,
  leftOut: readonly string[],
): string[] {
  if (leftOut.length === 0 || !asksForColour(matcher)) {
    return [];
  }
  const named = new Set(listsNamedIn(matcher));
  return leftOut.filter((id) => !named.has(id));
}
