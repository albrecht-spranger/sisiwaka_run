// firestore_import/import_updates.js
import { Firestore, Timestamp } from "@google-cloud/firestore";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";

// === 設定: ドキュメントIDの付け方 ===
// true: Firestore の自動ID / false: 生成規則（upd-YYYYMMDD-HHMMSS-連番）
const USE_AUTO_DOC_ID = true;

// created_at を JST(+09:00) として解釈したい場合は true（Cloud ShellがUTCでもズレない）
const PARSE_AS_JST = true;

const firestore = new Firestore();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMPORT_DIR = path.join(__dirname, "imports");

const toBool = (v) => {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
};

// created_at を Timestamp に。DATE / DATETIME / ISO / ミリ秒 に対応
const toTimestamp = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s || /^null$/i.test(s) || /^0000-00-00/.test(s)) return null;

  let d;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    // 日付のみ
    d = PARSE_AS_JST ? new Date(`${s}T00:00:00+09:00`) : new Date(`${s}T00:00:00`);
  } else if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(s)) {
    // 日時（スペース区切り）
    const isoLike = s.replace(" ", "T");
    d = PARSE_AS_JST ? new Date(`${isoLike}+09:00`) : new Date(isoLike);
  } else if (/^\d{13}$/.test(s)) {
    d = new Date(Number(s));
  } else {
    d = new Date(s); // ISO等
  }
  if (isNaN(d.getTime())) return null;
  return Timestamp.fromDate(d);
};

function readUpdatesCsv() {
  const full = path.join(IMPORT_DIR, "sisiwaka_touen_table_updates.csv");
  if (!fs.existsSync(full)) {
    throw new Error(`CSV not found: ${full}`);
  }
  const buf = fs.readFileSync(full);
  // 改行を含むフィールドを安全に扱うためのオプション（quoted fields対応）
  return parse(buf, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_quotes: true,
  });
}

async function writeBatched(colName, docs) {
  const col = firestore.collection(colName);
  const BATCH_LIMIT = 500;
  let batch = firestore.batch();
  let count = 0;

  for (const d of docs) {
    const id = d.__id;
    const { __id, ...data } = d;
    const ref = id ? col.doc(String(id)) : col.doc(); // 自動ID or 指定ID
    batch.set(ref, data, { merge: true });
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

function buildDocIdFromCreatedAt(ts, seq) {
  if (!ts) return `upd-unknown-${seq}`;
  const d = ts.toDate(); // JS Date
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `upd-${y}${m}${day}-${hh}${mm}${ss}-${seq}`;
}

async function main() {
  const rows = readUpdatesCsv();

  const docs = [];
  let seq = 1;
  for (const r of rows) {
    const createdAt = toTimestamp(r.created_at);
    const data = {
      created_at: createdAt ?? Timestamp.now(),
      article: r.article ?? "",
      valid: toBool(r.valid),
      migrated_at: Timestamp.now(),
    };
    const __id = USE_AUTO_DOC_ID ? undefined : buildDocIdFromCreatedAt(createdAt, seq++);
    docs.push({ __id, ...data });
  }

  await writeBatched("sisiwaka_touen_updates", docs);
  console.log("✅ updates import completed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
