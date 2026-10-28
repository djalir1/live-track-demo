// Renders the PWA / home-screen icons into public/icons from one SVG (the
// app's gradient tile + map pin, as in the header logo). Re-run after a
// brand change:  node scripts/generate-pwa-icons.mjs
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const OUT = new URL("../public/icons/", import.meta.url);
mkdirSync(OUT, { recursive: true });

// Lucide "map-pin", 24×24 viewBox, stroked.
const pin = `<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>`;

/** @param {{ rounded: boolean, pinScale: number }} o  pinScale = pin box as a share of the tile */
function svg({ rounded, pinScale }) {
  const size = 512,
    box = size * pinScale,
    off = (size - box) / 2,
    s = box / 24;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#3b6ef0"/><stop offset="1" stop-color="#7c4ddf"/>
  </linearGradient></defs>
  <rect width="${size}" height="${size}" rx="${rounded ? 112 : 0}" fill="url(#g)"/>
  <g transform="translate(${off} ${off + box * 0.02}) scale(${s})" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${pin}</g>
</svg>`;
}

const jobs = [
  // "any" icons: rounded tile, as browsers show them as-is.
  ["icon-192.png", 192, { rounded: true, pinScale: 0.56 }],
  ["icon-512.png", 512, { rounded: true, pinScale: 0.56 }],
  // Maskable: full-bleed, pin inside the central 80% safe zone (Android crops).
  ["maskable-512.png", 512, { rounded: false, pinScale: 0.46 }],
  ["maskable-192.png", 192, { rounded: false, pinScale: 0.46 }],
  // iOS adds its own rounded mask and ignores transparency.
  ["apple-touch-icon.png", 180, { rounded: false, pinScale: 0.52 }],
  ["favicon-32.png", 32, { rounded: true, pinScale: 0.62 }],
];
for (const [name, px, o] of jobs) {
  await sharp(Buffer.from(svg(o)))
    .resize(px, px)
    .png()
    .toFile(new URL(name, OUT).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  console.log("wrote", name);
}
// Scalable favicon for modern browsers.
import { writeFileSync } from "node:fs";
writeFileSync(new URL("icon.svg", OUT), svg({ rounded: true, pinScale: 0.56 }));
console.log("wrote icon.svg");
