/**
 * Fork: CLIP's tokenizer, which turns a description into the numbers the
 * text half of the picture model reads — byte-level BPE, as Hugging Face's
 * `tokenizers` runs the model's tokenizer.json (Immich uses the same):
 *
 * 1. NFC, runs of whitespace to one space, lower case;
 * 2. split into words, numbers (a digit each) and runs of punctuation;
 * 3. each piece's UTF-8 bytes as printable characters (GPT-2's byte map);
 * 4. BPE merges, with "</w>" marking a piece's last symbol;
 * 5. <|startoftext|> … <|endoftext|>, cut to 77 and padded with
 *    <|endoftext|>.
 */

export const CONTEXT_LENGTH = 77;
const START = "<|startoftext|>";
const END = "<|endoftext|>";

const PIECES =
  /<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+/gu;

/** GPT-2's map from a byte to a printable character standing for it. */
function byteCharacters(): string[] {
  const bytes: number[] = [];
  const range = (from: string, to: string) => {
    for (let b = from.charCodeAt(0); b <= to.charCodeAt(0); b++) {
      bytes.push(b);
    }
  };
  range("!", "~");
  range("¡", "¬");
  range("®", "ÿ");
  const chars = [...bytes];
  let extra = 0;
  for (let b = 0; b < 256; b++) {
    if (!bytes.includes(b)) {
      bytes.push(b);
      chars.push(256 + extra++);
    }
  }
  const map: string[] = [];
  bytes.forEach((b, i) => (map[b] = String.fromCharCode(chars[i])));
  return map;
}

/** The parts of tokenizer.json this reads. */
export interface TokenizerJson {
  model: {
    vocab: Record<string, number>;
    // [a, b] pairs, or "a b" in older files.
    merges: ([string, string] | string)[];
  };
}

export class ClipTokenizer {
  private readonly byteChars = byteCharacters();
  private readonly encoder = new TextEncoder();
  private readonly ranks = new Map<string, number>();
  private readonly cache = new Map<string, number[]>();
  private readonly start: number;
  private readonly end: number;

  constructor(
    private readonly vocab: Record<string, number>,
    merges: TokenizerJson["model"]["merges"],
  ) {
    merges.forEach((merge, rank) => {
      this.ranks.set(Array.isArray(merge) ? merge.join(" ") : merge, rank);
    });
    const start = vocab[START];
    const end = vocab[END];
    if (start === undefined || end === undefined) {
      throw new Error("Not a CLIP tokenizer: no start/end tokens");
    }
    this.start = start;
    this.end = end;
  }

  static fromJson(json: TokenizerJson): ClipTokenizer {
    return new ClipTokenizer(json.model.vocab, json.model.merges);
  }

  /** The description as the model reads it: 77 token ids. */
  encode(text: string): Int32Array {
    const ids: number[] = [];
    const normalized = text
      .normalize("NFC")
      .replace(/\s+/gu, " ")
      .toLowerCase();
    for (const [piece] of normalized.matchAll(PIECES)) {
      // Typed in a description, these are just text.
      if (piece === START || piece === END) {
        continue;
      }
      ids.push(...this.pieceIds(piece));
    }
    const tokens = new Int32Array(CONTEXT_LENGTH).fill(this.end);
    tokens[0] = this.start;
    const kept = ids.slice(0, CONTEXT_LENGTH - 2);
    tokens.set(kept, 1);
    tokens[kept.length + 1] = this.end;
    return tokens;
  }

  private pieceIds(piece: string): number[] {
    const cached = this.cache.get(piece);
    if (cached) {
      return cached;
    }
    const symbols = Array.from(
      this.encoder.encode(piece),
      (b) => this.byteChars[b],
    );
    symbols[symbols.length - 1] += "</w>";
    const ids = this.bpe(symbols).map(
      (symbol) => this.vocab[symbol] ?? this.end,
    );
    if (this.cache.size < 10_000) {
      this.cache.set(piece, ids);
    }
    return ids;
  }

  /** Merges the best-ranked pair, everywhere it occurs, until none is left. */
  private bpe(symbols: string[]): string[] {
    let word = symbols;
    while (word.length > 1) {
      let best = -1;
      let bestRank = Infinity;
      for (let i = 0; i < word.length - 1; i++) {
        const rank = this.ranks.get(`${word[i]} ${word[i + 1]}`);
        if (rank !== undefined && rank < bestRank) {
          best = i;
          bestRank = rank;
        }
      }
      if (best < 0) {
        break;
      }
      const [a, b] = [word[best], word[best + 1]];
      const merged: string[] = [];
      for (let i = 0; i < word.length; ) {
        if (i < word.length - 1 && word[i] === a && word[i + 1] === b) {
          merged.push(a + b);
          i += 2;
        } else {
          merged.push(word[i]);
          i += 1;
        }
      }
      word = merged;
    }
    return word;
  }
}
