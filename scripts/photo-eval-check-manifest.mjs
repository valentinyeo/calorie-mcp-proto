// Confirm the 100-plate manifest is the Nutrition5k sample this ticket scores.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "eval/photo-manifest.json"), "utf8"));
const dishes = manifest.dishes;
if (!Array.isArray(dishes) || dishes.length !== 100) {
  throw new Error(`expected 100 dishes, got ${dishes?.length}`);
}
const ids = new Set();
for (const dish of dishes) {
  if (!/^dish_\d+$/.test(dish.id)) throw new Error(`bad id ${dish.id}`);
  if (ids.has(dish.id)) throw new Error(`duplicate ${dish.id}`);
  ids.add(dish.id);
  if (!(dish.kcal >= 50)) throw new Error(`kcal below floor ${dish.id} ${dish.kcal}`);
  const prefix = "https://storage.googleapis.com/nutrition5k_dataset/nutrition5k_dataset/imagery/realsense_overhead/";
  if (dish.url !== `${prefix}${dish.id}/rgb.png`) throw new Error(`bad url ${dish.id}`);
}
if (manifest.seed !== 1277) throw new Error("seed changed");
console.log("manifest ok");
