// import_artworks.js
import { Firestore, Timestamp } from "@google-cloud/firestore";
import fs from "fs";
import { parse } from "csv-parse/sync";

// === 設定: ドキュメントIDの付け方 ===
// true なら Firestore 自動ID、false なら "artwork-<id>" を使用
const USE_AUTO_DOC_ID = false;

const firestore = new Firestore(); // Cloud Shell/Run ならADCでOK

const toBool = (v) => {
	const s = String(v ?? "").trim().toLowerCase();
	return s === "1" || s === "true" || s === "yes";
};

const toNum = (v) => (v === "" || v == null ? null : Number(v));

const toTimestamp = (v) => {
	if (v === undefined || v === null) return null;
	const s = String(v).trim();
	if (!s || /^null$/i.test(s) || /^0000-00-00/.test(s)) return null;

	let d;

	// YYYY-MM-DD
	if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
		// 日付型は 00:00:00（ローカル扱い）でOK
		d = new Date(s + "T00:00:00");
	}
	// YYYY-MM-DD hh:mm:ss
	else if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(s)) {
		// スペースをTに変えて ISO 風に（ローカル時間として解釈）
		d = new Date(s.replace(" ", "T"));
	}
	// UNIX millis
	else if (/^\d{13}$/.test(s)) {
		d = new Date(Number(s));
	}
	// それ以外は Date に任せる（例：ISO 文字列）
	else {
		d = new Date(s);
	}

	if (isNaN(d.getTime())) return null; // 無効なら null を返す
	return Timestamp.fromDate(d);
};

function readCsv(path) {
	const buf = fs.readFileSync(path);
	return parse(buf, { columns: true, skip_empty_lines: true, bom: true });
}

async function writeBatched(colName, docs) {
	const col = firestore.collection(colName);
	const BATCH_LIMIT = 500;
	let batch = firestore.batch();
	let count = 0;

	for (const d of docs) {
		const ref = d.__id ? col.doc(String(d.__id)) : col.doc();
		const { __id, ...data } = d;
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

async function main() {
	const base = "./imports";

	// 必須CSV（ヘッダあり）
	const artworks = readCsv(`${base}/sisiwaka_touen_table_artworks.csv`);
	const media = readCsv(`${base}/sisiwaka_touen_table_artwork_media.csv`);
	const techs = readCsv(`${base}/sisiwaka_touen_table_artwork_techniques.csv`);

	// 紐づけ用インデックス
	const mediaByArtwork = new Map();
	for (const m of media) {
		const k = String(m.artwork_id);
		const entry = {
			id: toNum(m.id),
			kind: m.kind, // "image" | "video"
			image_url: m.image_url || null,
			video_url: m.video_url || null,
			alt_ja: m.alt_ja || null,
			alt_en: m.alt_en || null,
			sort_order: toNum(m.sort_order) ?? 0,
			valid: toBool(m.valid),
		};
		mediaByArtwork.set(k, [...(mediaByArtwork.get(k) || []), entry]);
	}
	// 並び順保証
	for (const [k, arr] of mediaByArtwork) {
		arr.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
	}

	const techsByArtwork = new Map();
	for (const t of techs) {
		const k = String(t.artwork_id);
		const entry = { slug: t.techniques_slug, valid: toBool(t.valid) };
		techsByArtwork.set(k, [...(techsByArtwork.get(k) || []), entry]);
	}

	// artworks → Firestore
	const outDocs = artworks.map((a) => {
		const idStr = String(a.id);

		// ドキュメントID決定
		const docId = USE_AUTO_DOC_ID ? undefined : `${idStr}`;

		return {
			__id: docId,                         // set用内部フィールド（上で取り除く）
			artwork_id: toNum(a.id),             // MySQLのidを保持（検索用）
			name: a.name || null,
			description_title: a.description_title || null,
			description: a.description || null,
			category_slug: a.category || null,   // slug をそのまま
			coloring_slug: a.coloring || null,   // slug をそのまま
			spec: a.spec || null,
			clay: a.clay || null,
			glaze: a.glaze || null,
			notes: a.notes || null,
			in_stock: toBool(a.in_stock),
			shop_url: a.shop_url || null,
			instagram_url: a.instagram_url || null,
			completion_date: toTimestamp(a.completion_date),
			update_date: toTimestamp(a.update_date) || Timestamp.now(),
			valid: toBool(a.valid),

			// 付随データ（valid=falseも含める）
			media: mediaByArtwork.get(idStr) || [],
			techniques: techsByArtwork.get(idStr) || [],

			migrated_at: Timestamp.now(),
		};
	});

	await writeBatched("sisiwaka_touen_artworks", outDocs);

	console.log("✅ artworks import done.");
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
