// Rasterize the existing Tako vector mark; no new character design.
const fs = require("node:fs/promises");
const sharp = require("sharp");
(async () => {
  const svg = await fs.readFile("assets/tako-icon.svg");
  await sharp(svg).png().toFile("assets/icon.png");
  const foreground = svg.toString().replace(/<rect[^>]+\/>/, "");
  await sharp(Buffer.from(foreground))
    .png()
    .toFile("assets/android-icon-foreground.png");
})();
