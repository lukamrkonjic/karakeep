import { describe, expect, test } from "vitest";

import { ClipTokenizer, CONTEXT_LENGTH } from "./tokenizer";

// A made-up vocabulary. The real tokenizer.json was checked against Hugging
// Face's `tokenizers` on 462 descriptions (words, contractions, digits,
// accents, combining marks, CJK, emoji, odd whitespace, 100-word ones): all
// the same, but for the start/end markers typed as text, which this drops.
const tokenizer = new ClipTokenizer(
  {
    "<|startoftext|>": 100,
    "<|endoftext|>": 101,
    c: 1,
    a: 2,
    "t</w>": 3,
    "at</w>": 4,
    "cat</w>": 5,
    "'": 6,
    "s</w>": 7,
    "'s</w>": 8,
    "1</w>": 9,
    "2</w>": 10,
    Ã: 11,
    "©</w>": 12,
    "Ã©</w>": 13,
    "!</w>": 14,
  },
  [["a", "t</w>"], ["c", "at</w>"], ["'", "s</w>"], "Ã ©</w>"],
);

const content = (text: string) => {
  const ids = Array.from(tokenizer.encode(text));
  return ids.slice(1, ids.indexOf(101));
};

describe("CLIP tokenizer", () => {
  test("start, the words' tokens, end, padded with end to 77", () => {
    const ids = tokenizer.encode("cat");
    expect(ids.length).toBe(CONTEXT_LENGTH);
    expect(Array.from(ids.slice(0, 4))).toEqual([100, 5, 101, 101]);
    expect(ids.every((id, i) => i < 2 || id === 101)).toBe(true);
  });

  test("merges by rank, lower case, one piece per word", () => {
    expect(content("CAT  cat\tcat")).toEqual([5, 5, 5]);
  });

  test("contractions and digits are pieces of their own", () => {
    expect(content("cat's")).toEqual([5, 8]);
    expect(content("12")).toEqual([9, 10]);
  });

  test("bytes stand in for what isn't ASCII; unknown symbols are end", () => {
    // é is C3 A9 in UTF-8: "Ã" and "©" in GPT-2's byte map.
    expect(content("é")).toEqual([13]);
    expect(content("cat!")).toEqual([5, 14]);
    expect(content("z")).toEqual([]); // "z</w>" isn't in the vocabulary
    expect(Array.from(tokenizer.encode("z").slice(0, 3))).toEqual([
      100, 101, 101,
    ]);
  });

  test("typed start and end markers are dropped", () => {
    expect(content("<|endoftext|> cat")).toEqual([5]);
  });

  test("a long description is cut to fit, keeping the end marker", () => {
    const ids = tokenizer.encode(Array(100).fill("cat").join(" "));
    expect(ids.length).toBe(CONTEXT_LENGTH);
    expect(ids[CONTEXT_LENGTH - 1]).toBe(101);
    expect(ids.filter((id) => id === 5).length).toBe(CONTEXT_LENGTH - 2);
  });
});
