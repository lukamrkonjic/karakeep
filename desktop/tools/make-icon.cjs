/*
 * Draws the Magpie mark and packs it into build/icon.ico.
 *
 *   npx electron tools/make-icon.cjs
 *
 * Rendering happens in a real Electron window because that is the same engine
 * that draws the rest of the app, so the icon cannot drift from the interface
 * it belongs to. The .ico is assembled by hand: the format takes PNG-encoded
 * entries directly, so no image library is needed.
 */
const { app, BrowserWindow } = require("electron");
const { writeFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");

/** Windows picks the nearest of these; 256 is what the installer shows. */
const SIZES = [16, 24, 32, 48, 64, 128, 256];

/*
 * A magpie, reduced until it still reads at 16 pixels: a round head, a blunt
 * beak, a heavy body and the long wedge tail that makes the bird obvious.
 * Flat black on white, which is the palette the rest of the app uses.
 */
const MARK = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="56" fill="#f4f3f1"/>
  <g fill="#1a1a1a">
    <!-- tail: a long wedge sweeping down to the left -->
    <path d="M108 142 L30 210 Q19 220 28 230 Q38 240 48 229 L130 164 Z"/>
    <!-- body -->
    <path d="M196 84 Q214 104 206 132 Q198 162 168 174 Q138 186 114 166
             Q96 150 104 128 Q114 100 146 88 Q174 76 196 84 Z"/>
    <!-- head and beak -->
    <circle cx="180" cy="74" r="30"/>
    <path d="M194 56 L248 42 Q255 40 252 47 L231 84 Z"/>
  </g>
  <!-- the white shoulder patch every magpie has -->
  <path d="M150 112 Q168 104 182 116 Q170 142 148 146 Q138 128 150 112 Z"
        fill="#f4f3f1"/>
  <circle cx="190" cy="68" r="5" fill="#f4f3f1"/>
</svg>`;

function page() {
  const svg = MARK.trim().replace(/"/g, "'");
  return (
    "data:text/html;charset=utf-8," +
    encodeURIComponent(
      `<html><body style="margin:0;background:transparent">${svg.replace(
        "<svg ",
        '<svg width="256" height="256" ',
      )}</body></html>`,
    )
  );
}

/** ICONDIR + one ICONDIRENTRY per image, then the PNG blobs themselves. */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, png } of images) {
    const e = Buffer.alloc(16);
    // 256 is written as 0; the field is a single byte.
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palette size
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += png.length;
  }

  return Buffer.concat([
    header,
    ...entries,
    ...images.map((i) => i.png),
  ]);
}

app.whenReady().then(async () => {
  // Drawn once at full size and scaled down from there. Loading the same long
  // data URL into a fresh window per size fails outright on the second one,
  // and nativeImage resizes with the same compositor anyway.
  const win = new BrowserWindow({
    width: 256,
    height: 256,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    useContentSize: true,
  });
  await win.loadURL(page());
  await new Promise((r) => setTimeout(r, 400));

  let master = null;
  for (let attempt = 0; attempt < 6 && !master; attempt++) {
    try {
      master = await win.webContents.capturePage();
    } catch {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  if (!master) {
    console.error("could not capture the mark");
    app.exit(1);
    return;
  }

  const images = [];
  for (const size of SIZES) {
    const png = (
      size === 256 ? master : master.resize({ width: size, height: size, quality: "best" })
    ).toPNG();
    images.push({ size, png });
    console.log(`  ${size}x${size}`.padEnd(12), png.length, "bytes");
  }
  win.destroy();

  mkdirSync(join(__dirname, "../build"), { recursive: true });
  const out = join(__dirname, "../build/icon.ico");
  writeFileSync(out, buildIco(images));

  // The largest one is kept as a PNG too, for anything that wants one.
  writeFileSync(
    join(__dirname, "../build/icon.png"),
    images[images.length - 1].png,
  );

  console.log("\nwrote", out);
  app.exit(0);
});
