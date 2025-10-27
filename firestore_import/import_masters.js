// firestore_import/import_masters.js
import { Firestore } from "@google-cloud/firestore";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";

const firestore = new Firestore();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMPORT_DIR = path.join(__dirname, "imports");

const toBool = (v) => {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
};
const toNum = (v) => (v === "" || v == null ? null : Number(v));

function readCsvIfExists(filename) {
  const full = path.join(IMPORT_DIR, filename);
  if (!fs.existsSync(full)) {
    console.log(`(skip) CSV not found: ${filename}`);
    return null;
  }
  const buf = fs.readFileSync(full);
  return parse(buf, { columns: true, skip_empty_lines: true, bom: true });
}

async function writeBatched(colName, docs) {
  if (!docs || docs.length === 0) {
    console.log(`→ ${colName}: 0 docs (nothing to write)`);
    return;
  }
  const col = firestore.collection(colName);
  const BATCH_LIMIT = 500;
  let batch = firestore.batch();
  let count = 0;

  for (const d of docs) {
    const id = String(d.__id);
    const { __id, ...data } = d;
    batch.set(col.doc(id), data, { merge: true });
    count++;
    if (count % BATCH_LIMIT === 0) {
      await batch.commit();
      batch = firestore.batch();
    }
  }
  if (count % BATCH_LIMIT !== 0) {
    await batch.commit();
  }
  console.log(`→ ${colName}: ${count} docs written.`);
}

async function main() {
  // 1) categories
  const categories = readCsvIfExists("sisiwaka_touen_table_categories.csv");
  if (categories) {
    const docs = categories.map((c) => ({
      __id: c.slug, // ドキュメントID = slug
      label_ja: c.label_ja ?? null,
      label_en: c.label_en ?? null,
      sort_order: toNum(c.sort_order) ?? 0,
      valid: toBool(c.valid),
    }));
    await writeBatched("sisiwaka_touen_categories", docs);
  }

  // 2) techniques
  const techniques = readCsvIfExists("sisiwaka_touen_table_techniques.csv");
  if (techniques) {
    const docs = techniques.map((t) => ({
      __id: t.slug, // ドキュメントID = slug
      label_ja: t.label_ja ?? null,
      label_en: t.label_en ?? null,
      sort_order: toNum(t.sort_order) ?? 0,
      valid: toBool(t.valid),
    }));
    await writeBatched("sisiwaka_touen_techniques", docs);
  }

  // 3) colorings
  const colorings = readCsvIfExists("sisiwaka_touen_table_colorings.csv");
  if (colorings) {
    const docs = colorings.map((c) => ({
      __id: c.slug, // ドキュメントID = slug
      label_ja: c.label_ja ?? null,
      label_en: c.label_en ?? null,
      valid: toBool(c.valid),
    }));
    await writeBatched("sisiwaka_touen_colorings", docs);
  }

  console.log("✅ masters import completed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
