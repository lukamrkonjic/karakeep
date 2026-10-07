import { describe, expect, it } from "vitest";

import {
  assetFileName,
  contentDisposition,
  extensionOf,
  internetShortcut,
  linkFileName,
  noteFileName,
  safeFileName,
  uniqueNamer,
  zipFileName,
} from "./bookmarkFiles";

describe("assetFileName", () => {
  it("names it after the title, with the file's extension", () => {
    expect(
      assetFileName({
        title: "Sunset over the bay",
        fileName: "IMG_2041.JPG",
        contentType: "image/jpeg",
        fallback: "Picture",
      }),
    ).toBe("Sunset over the bay.JPG");
  });

  it("doesn't add the extension twice", () => {
    expect(
      assetFileName({
        title: "scan.pdf",
        fileName: "upload.pdf",
        contentType: "application/pdf",
        fallback: "PDF",
      }),
    ).toBe("scan.pdf");
  });

  it("keeps the file's own name when untitled", () => {
    expect(
      assetFileName({
        title: "  ",
        fileName: "chords.png",
        contentType: "image/png",
        fallback: "Picture",
      }),
    ).toBe("chords.png");
  });

  it("takes the extension from the type when the name has none", () => {
    expect(
      assetFileName({
        title: "Lesson 3",
        fileName: null,
        contentType: "video/mp4",
        fallback: "Video",
      }),
    ).toBe("Lesson 3.mp4");
    expect(
      assetFileName({
        title: null,
        fileName: null,
        contentType: "image/webp",
        fallback: "Picture 2026-10-07",
      }),
    ).toBe("Picture 2026-10-07.webp");
  });
});

describe("extensionOf", () => {
  it("knows the usual types, parameters and all", () => {
    expect(extensionOf("image/jpeg")).toBe(".jpg");
    expect(extensionOf("video/quicktime")).toBe(".mov");
    expect(extensionOf("text/markdown; charset=utf-8")).toBe(".md");
    expect(extensionOf("application/x-unknown")).toBe("");
    expect(extensionOf(null)).toBe("");
  });
});

describe("noteFileName", () => {
  it("uses the title, else the first line without its Markdown", () => {
    expect(noteFileName("Practice plan", "- scales")).toBe("Practice plan.md");
    expect(noteFileName(null, "\n## Chord changes\nG C D")).toBe(
      "Chord changes.md",
    );
    expect(noteFileName(null, "- [ ] restring the guitar")).toBe(
      "restring the guitar.md",
    );
    expect(noteFileName(undefined, "   ")).toBe("Note.md");
  });
});

describe("links", () => {
  it("names a link by its title, else its address", () => {
    expect(linkFileName("Fingerstyle basics", "https://example.com/a")).toBe(
      "Fingerstyle basics.url",
    );
    expect(linkFileName(null, "https://www.example.com/tabs/")).toBe(
      "example.com/tabs.url",
    );
  });

  it("writes an internet shortcut", () => {
    expect(internetShortcut("https://example.com/?a=1")).toBe(
      "[InternetShortcut]\r\nURL=https://example.com/?a=1\r\n",
    );
    expect(internetShortcut("https://x.test/\r\nevil")).toBe(
      "[InternetShortcut]\r\nURL=https://x.test/evil\r\n",
    );
  });
});

describe("safeFileName", () => {
  it("replaces what Windows refuses and keeps the extension", () => {
    expect(safeFileName('AC/DC: "Live" <1991>?.jpg')).toBe(
      "AC_DC_ _Live_ _1991__.jpg",
    );
    expect(safeFileName("example.com/tabs.url")).toBe("example.com_tabs.url");
  });

  it("drops dots and spaces at the ends, and control characters", () => {
    expect(safeFileName("  .hidden. .md")).toBe("hidden.md");
    expect(safeFileName("tab\there\u0007.txt")).toBe("tab_here_.txt");
  });

  it("avoids Windows' device names and empty names", () => {
    expect(safeFileName("CON.txt")).toBe("CON_.txt");
    expect(safeFileName("lpt1")).toBe("lpt1_");
    expect(safeFileName("....pdf")).toBe("file.pdf");
  });

  it("shortens long names, keeping the extension whole", () => {
    const name = safeFileName(`${"🎸".repeat(200)}.mp4`, 20);
    expect(name.endsWith(".mp4")).toBe(true);
    expect(Array.from(name)).toHaveLength(20);
  });
});

describe("uniqueNamer", () => {
  it("numbers repeats, whatever their case", () => {
    const claim = uniqueNamer();
    expect(claim("a.jpg")).toBe("a.jpg");
    expect(claim("A.jpg")).toBe("A (2).jpg");
    expect(claim("a.jpg")).toBe("a (3).jpg");
    expect(claim("a (2).jpg")).toBe("a (2) (2).jpg");
    expect(claim("note.md")).toBe("note.md");
  });
});

describe("zipFileName", () => {
  it("names the zip after the list, else vrana", () => {
    expect(zipFileName("Guitar", 12)).toBe("Guitar (12 items).zip");
    expect(zipFileName(undefined, 3)).toBe("vrana (3 items).zip");
    expect(zipFileName("Riffs / Licks", 2)).toBe("Riffs _ Licks (2 items).zip");
  });
});

describe("contentDisposition", () => {
  it("gives an ASCII name and the UTF-8 one", () => {
    expect(contentDisposition("Café sketch.jpg")).toBe(
      "attachment; filename=\"Cafe sketch.jpg\"; filename*=UTF-8''Caf%C3%A9%20sketch.jpg",
    );
    expect(contentDisposition("ギター.mp4")).toBe(
      "attachment; filename=\"download.mp4\"; filename*=UTF-8''%E3%82%AE%E3%82%BF%E3%83%BC.mp4",
    );
    expect(contentDisposition("it's (live).mp4")).toContain(
      "filename*=UTF-8''it%27s%20%28live%29.mp4",
    );
  });
});
