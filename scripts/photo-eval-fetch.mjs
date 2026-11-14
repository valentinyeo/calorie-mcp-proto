// Download any missing Nutrition5k plate from the manifest. Existing files stay.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "eval/photo-manifest.json"), "utf8"));
const photosDir = path.join(root, "eval/photos");
fs.mkdirSync(photosDir, { recursive: true });

let fetched = 0;
for (const dish of manifest.dishes) {
  const dest = path.join(photosDir, `${dish.id}.png`);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) continue;
  const res = await fetch(dish.url);
  if (!res.ok) throw new Error(`${dish.id} HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000 || buf[0] !== 0x89) throw new Error(`${dish.id} is not a PNG`);
  fs.writeFileSync(dest, buf);
  fetched += 1;
  console.log(`fetched ${dish.id}`);
}
console.log(`fetch done new=${fetched} total=${manifest.dishes.length}`);
