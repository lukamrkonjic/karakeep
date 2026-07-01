/**
 * True only when `icon` actually contains an emoji glyph. Lists whose icon is
 * empty, whitespace, or a non-emoji placeholder (e.g. "??") return false so the
 * caller can hide the icon slot instead of rendering a stray character.
 */
export function isEmojiIcon(icon?: string | null): icon is string {
  return typeof icon === "string" && /\p{Extended_Pictographic}/u.test(icon);
}
