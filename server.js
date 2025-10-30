// server.js（抜粋 or 追記）
// 事前に: npm i @google-cloud/firestore
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { Firestore } from "@google-cloud/firestore";

import dotenv from "dotenv";
dotenv.config(); // .env を読み込む

const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;
const ADMIN_REALM = process.env.ADMIN_REALM || "Restricted Area";
const BASIC_OFF =
	(process.env.BASIC_AUTH || "").toLowerCase() === "off" ||
	process.env.NODE_ENV === "development";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = process.env.PORT || 8080;

// ★★★debug
app.use((req, res, next) => {
	console.log(`[REQ] ${req.method} ${req.url}`);
	next();
});

// EJS & 静的ファイル
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

// Firestore クライアント（ADC 利用: Cloud Shell/Runなら認証済）
const db = new Firestore();

// util: 日付フォーマット（YYYY/M/D）
function formatYmd(tsOrDate) {
	if (!tsOrDate) return "";
	const d = tsOrDate.toDate ? tsOrDate.toDate() : new Date(tsOrDate);
	const y = d.getFullYear();
	const m = d.getMonth() + 1;
	const day = d.getDate();
	return `${y}/${m}/${day}`;
}

// ルート（index）
app.get("/", async (req, res) => {
	try {
		const snap = await db.collection("sisiwaka_touen_updates")
			.where("valid", "==", true)
			.orderBy("created_at", "desc")
			.limit(5)
			.get();

		const updates_list = snap.docs.map(doc => {
			const d = doc.data();
			const dt = d.created_at?.toDate?.();
			const ymd = dt ? `${dt.getFullYear()}/${dt.getMonth() + 1}/${dt.getDate()}` : "";
			return { created_at_ymd: ymd, article: d.article || "" };
		});

		res.render("index", { updates_list });
	} catch (e) {
		console.error(e);
		res.render("index", {
			updates_list: [{ created_at_ymd: new Date().toLocaleDateString("ja-JP"), article: "更新情報の取得に失敗しました。" }]
		});
	}
});

app.listen(port, "0.0.0.0", () => {
	console.log(`listening on http://0.0.0.0:${port}`);
});


// ================================
//  作品一覧
// ================================
/** Firestore→表示用データに整形 */
function pickThumbnail(mediaArr = []) {
	// valid=true かつ kind=image の最小 sort_order を選ぶ
	const imgs = mediaArr.filter(m => m && m.valid === true && m.kind === "image");
	if (imgs.length === 0) return null;
	imgs.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
	return imgs[0].image_url || null;
}

app.get("/works", async (req, res) => {
	try {
		let docs;

		// 本命: valid==true を a.id DESC 相当で並べる → artwork_id DESC
		// ※ 初回は複合インデックス（valid asc + artwork_id desc）が必要
		try {
			const snap = await db.collection("sisiwaka_touen_artworks")
				.where("valid", "==", true)
				.orderBy("artwork_id", "desc")
				.get();
			docs = snap.docs.map(d => d.data());
		} catch (err) {
			if (err && err.code === 9) {
				console.warn("[INFO] artworks: composite index not ready. Falling back.");
				const snap = await db.collection("sisiwaka_touen_artworks")
					.orderBy("artwork_id", "desc")
					.limit(500) // 必要に応じて増減
					.get();
				docs = snap.docs.map(d => d.data()).filter(a => a.valid === true);
			} else {
				throw err;
			}
		}

		// products（Isotopeに必要な最小情報へ整形）
		const all_products = docs.map(a => {
			const techniques = Array.isArray(a.techniques)
				? a.techniques
					.filter(t => t && (t.valid === true || t.valid === undefined))
					.map(t => t.slug)
				: [];
			return {
				id: a.artwork_id,                       // 作品ID（数値 or 文字列どちらでもOK）
				name: a.name || "",
				category: a.category_slug || "",
				coloring: a.coloring_slug || "",
				in_stock: !!a.in_stock,
				thumbnail_url: pickThumbnail(a.media) || "/images/noimage.png",
				techniques,                             // ["shinogi","nerikomi",...]
			};
		});

		// マスタ（チェックボックス用）
		// PHP版は「実在カテゴリだけ」でしたが、まずは valid=true 全件を出します
		const [catsSnap, techSnap, colSnap] = await Promise.all([
			db.collection("sisiwaka_touen_categories").where("valid", "==", true).get(),
			db.collection("sisiwaka_touen_techniques").where("valid", "==", true).orderBy("sort_order", "asc").get(),
			db.collection("sisiwaka_touen_colorings").where("valid", "==", true).get(),
		]);

		const categories = catsSnap.docs.map(d => ({ slug: d.id, ...(d.data() || {}) }));
		const techniques = techSnap.docs.map(d => ({ slug: d.id, ...(d.data() || {}) }));
		const colorings = colSnap.docs.map(d => ({ slug: d.id, ...(d.data() || {}) }));

		res.render("works", { all_products, categories, techniques, colorings });
	} catch (e) {
		console.error("[/works Error]", e);
		res.status(500).send("エラーが発生しました。");
	}
});


// =================================
// 作品詳細 /detail?id=123
// ================================= 
app.get("/detail", async (req, res) => {
	// id バリデーション（数値を期待。数値でなくても artwork_id と一致すればOKにしてもよい）
	const idParam = req.query.id;
	const idNum = Number(idParam);
	if (!idParam || Number.isNaN(idNum)) {
		console.error("[/detail] invalid id:", idParam);
		return res.status(400).send("エラーが発生しました。");
	}

	try {
		// ===== 作品本体（artworks から1件）=====
		// valid も見るなら複合インデックスが要る場合があるので、まず artwork_id のみで取得→コード側で valid を確認
		const artSnap = await db
			.collection("sisiwaka_touen_artworks")
			.where("artwork_id", "==", idNum)
			.limit(1)
			.get();

		if (artSnap.empty) {
			console.error(`[detail] Artwork not found (ID=${idNum}).`);
			return res.status(404).send("エラーが発生しました。");
		}

		const art = artSnap.docs[0].data();
		if (art.valid === false) {
			console.error(`[detail] Artwork invalid (ID=${idNum}).`);
			return res.status(404).send("エラーが発生しました。");
		}

		// ===== ラベル展開（カテゴリ / 色合い）=====
		const [catDoc, colDoc] = await Promise.all([
			art.category_slug
				? db.collection("sisiwaka_touen_categories").doc(String(art.category_slug)).get()
				: null,
			art.coloring_slug
				? db.collection("sisiwaka_touen_colorings").doc(String(art.coloring_slug)).get()
				: null,
		]);
		const categoryLabel =
			catDoc && catDoc.exists ? (catDoc.data().label_ja || art.category_slug) : (art.category_slug || "");
		const coloringLabel =
			colDoc && colDoc.exists ? (colDoc.data().label_ja || art.coloring_slug) : (art.coloring_slug || "");

		// ===== 画像・動画（media 配列から valid=true を sort_order→id で整列）=====
		const mediaArr = Array.isArray(art.media) ? [...art.media] : [];
		mediaArr.sort((a, b) => {
			const soA = a?.sort_order ?? 0;
			const soB = b?.sort_order ?? 0;
			if (soA !== soB) return soA - soB;
			return (a?.id ?? 0) - (b?.id ?? 0);
		});
		const media_rows = mediaArr.filter(m => m && m.valid === true).map(m => ({
			image_url: m.image_url || "",
			video_url: m.video_url || null,
			alt_ja: m.alt_ja || "",
		}));

		// ===== 技法ラベル（techniques 配列の valid=true を抽出して label_ja を取得）=====
		const techSlugs =
			Array.isArray(art.techniques)
				? art.techniques.filter(t => t && (t.valid === true || t.valid === undefined)).map(t => t.slug)
				: [];

		// 重複排除
		const uniqTechSlugs = [...new Set(techSlugs)];
		// まとめて取得（件数少ない想定。多い時は10件ずつ分割 or 個別getでもOK）
		const techDocs = await Promise.all(
			uniqTechSlugs.map(slug => db.collection("sisiwaka_touen_techniques").doc(String(slug)).get())
		);
		const techniques = techDocs
			.filter(d => d.exists && (d.data().valid !== false))
			.map(d => d.data().label_ja || d.id);

		// ===== 日付フォーマット（Y/n/j）=====
		const fmtYmd = (v) => {
			const d = v?.toDate ? v.toDate() : (v ? new Date(v) : null);
			if (!d || Number.isNaN(d.getTime())) return "―";
			return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
		};

		// EJS に渡すオブジェクト（PHPの配列に近い形へ整形）
		const artwork = {
			id: art.artwork_id,
			name: art.name || "",
			description_title: art.description_title || "タイトル未定",
			description: art.description || "",
			spec: art.spec || "",
			clay: art.clay || "",
			glaze: art.glaze || "",
			notes: art.notes || "",
			in_stock: !!art.in_stock,
			shop_url: art.shop_url || "",
			instagram_url: art.instagram_url || "",
			completion_date: fmtYmd(art.completion_date),
			update_date: fmtYmd(art.update_date),
			category: categoryLabel || "(用途)",
			coloring: coloringLabel || "(色合い)",
		};

		// 描画
		return res.render("detail", {
			artwork,
			media_rows,
			techniques, // ["しのぎ", "練り込み", ...]
		});
	} catch (e) {
		console.error("[/detail Error]", e);
		return res.status(500).send("エラーが発生しました。");
	}
});

// ============================
//  更新
// ============================
function requireBasicAuth(req, res, next) {
	// 一時的にベーシック認証を無効化
	if (BASIC_OFF) return next();

	const h = req.headers.authorization || "";
	// "Basic base64(user:pass)" を想定
	if (!h.startsWith("Basic ")) {
		res.set("WWW-Authenticate", `Basic realm="${ADMIN_REALM}"`);
		return res.status(401).send("Authentication required.");
	}
	const base64 = h.slice(6).trim();
	let user = "", pass = "";
	try {
		const decoded = Buffer.from(base64, "base64").toString("utf8");
		const idx = decoded.indexOf(":");
		user = decoded.slice(0, idx);
		pass = decoded.slice(idx + 1);
	} catch (_) {
		// 解析失敗時も401
	}
	if (user === ADMIN_USER && pass === ADMIN_PASS) return next();

	res.set("WWW-Authenticate", `Basic realm="${ADMIN_REALM}"`);
	return res.status(401).send("Authentication required.");
}

// /admin 以下のルートはすべて認証必須に
app.use("/admin", requireBasicAuth);

// /admin/static/* は認証後に配信
app.use(
	"/admin/static",
	requireBasicAuth,
	express.static(path.join(__dirname, "admin_static"))
);

// 先頭で Firestore 初期化済み想定
// const db = new Firestore();

function toDateInputValue(tsOrStr) {
	// Firestore Timestamp or string → <input type="date"> の 'YYYY-MM-DD'
	const d = tsOrStr?.toDate ? tsOrStr.toDate() : (tsOrStr ? new Date(tsOrStr) : null);
	if (!d || Number.isNaN(d.getTime())) return "";
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

app.get("/admin/edit", async (req, res) => {
	// id バリデーション（数値前提。文字列IDを使うなら変えてOK）
	const idParam = req.query.id;
	const idNum = Number(idParam);
	if (!idParam || Number.isNaN(idNum)) {
		console.error("[/admin/edit] invalid id:", idParam);
		return res.status(400).send("エラーが発生しました。");
	}

	try {
		// ====== 作品本体 ======
		const artSnap = await db
			.collection("sisiwaka_touen_artworks")               // ← 別名なら変更
			.where("artwork_id", "==", idNum)
			.limit(1)
			.get();

		if (artSnap.empty) {
			console.error(`[edit] Artwork not found (ID=${idNum}).`);
			return res.status(404).send("エラーが発生しました。");
		}
		const art = artSnap.docs[0].data();
		if (art.valid === false) {
			console.error(`[edit] Artwork invalid (ID=${idNum}).`);
			return res.status(404).send("エラーが発生しました。");
		}

		// ====== media（sort_order, id で昇順 & そのまま全件表示）======
		const mediaArr = Array.isArray(art.media) ? [...art.media] : [];
		mediaArr.sort((a, b) => {
			const sa = a?.sort_order ?? 0;
			const sb = b?.sort_order ?? 0;
			if (sa !== sb) return sa - sb;
			return (a?.id ?? 0) - (b?.id ?? 0);
		});
		const media_list = mediaArr.map(m => ({
			id: m.id,
			image_url: m.image_url || "",
			video_url: m.video_url || null,
			valid: !!m.valid,
		}));

		// ====== 使われている技法（slug配列）======
		const usedTechSlugs = Array.isArray(art.techniques)
			? art.techniques
				.filter(t => t && (t.valid === true || t.valid === undefined))
				.map(t => t.slug)
			: [];

		// ====== マスタ一覧 ======
		const [techSnap, catSnap, colSnap] = await Promise.all([
			db.collection("sisiwaka_touen_techniques").where("valid", "==", true).get(),
			db.collection("sisiwaka_touen_categories").where("valid", "==", true).orderBy("sort_order", "asc").get(),
			db.collection("sisiwaka_touen_colorings").where("valid", "==", true).get(),
		]);

		const techniques_list = techSnap.docs.map(d => ({ slug: d.id, ...(d.data() || {}) }));
		const category_list = catSnap.docs.map(d => ({ slug: d.id, ...(d.data() || {}) }));
		const coloring_list = colSnap.docs.map(d => ({ slug: d.id, ...(d.data() || {}) }));

		// EJSへ渡す形（PHP配列に近づける）
		const artwork = {
			id: art.artwork_id,
			description_title: art.description_title || "",
			name: art.name || "",
			category: art.category_slug || "",
			coloring: art.coloring_slug || "",
			description: art.description || "",
			spec: art.spec || "",
			clay: art.clay || "",
			glaze: art.glaze || "",
			notes: art.notes || "",
			instagram_url: art.instagram_url || "",
			in_stock: !!art.in_stock,
			shop_url: art.shop_url || "",
			valid: !!art.valid,
			completion_date_value: toDateInputValue(art.completion_date),
			update_date_display: (() => {
				const d = art.update_date?.toDate ? art.update_date.toDate() : (art.update_date ? new Date(art.update_date) : null);
				if (!d || Number.isNaN(d.getTime())) return "―";
				return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
			})(),
		};

		res.render("admin/edit", {
			artwork,
			media_list,
			used_techniques: usedTechSlugs,  // ["shinogi",...]
			techniques_list,                 // [{slug,label_ja,...}]
			category_list,                   // [{slug,label_ja,...}]
			coloring_list,                   // [{slug,label_ja,...}]
		});
	} catch (e) {
		console.error("[/admin/edit Error]", e);
		res.status(500).send("エラーが発生しました。");
	}
});

// 先頭の import 付近（既に Firestore は import済み）に追加
import { FieldValue, Timestamp } from "@google-cloud/firestore";

// フォームを読む（上に書いてあれば重複不要）
app.use(express.urlencoded({ extended: true }));

// PHPの set_flash 相当は簡易にクエリで持ち回り（detail/works側で req.query を拾って表示）
function redirect303(res, url) {
	// PHPの redirect(..., 303) に合わせる
	return res.redirect(303, url);
}

// ---- /admin/edit_process （PHPの edit_process.php の等価処理）----
app.post("/admin/edit_process", requireBasicAuth, async (req, res) => {
	// 1) IDの検証
	const idParam = req.body.id;
	const idNum = Number(idParam);
	if (!idParam || Number.isNaN(idNum)) {
		console.error("[/admin/edit_process] invalid id:", idParam);
		return redirect303(res, `/detail?id=${encodeURIComponent(idParam || "")}&flash_error=invalid_id`);
	}

	// 2) 入力の取り出し（PHPの変数と対応）
	const name = req.body.name ?? "";
	const description_title = req.body.description_title ?? "";
	const description = req.body.description ?? "";
	const category = req.body.category ?? "other";
	const spec = req.body.spec ?? "";
	const coloring = (req.body.coloring ?? null);           // 未送信は null 扱い
	const clay = req.body.clay ?? "";
	const glaze = req.body.glaze ?? "";
	const notes = req.body.notes ?? "";
	const in_stock = req.body.in_stock === "1";
	const shop_url = req.body.shop_url ?? "";
	const instagram_url = req.body.instagram_url ?? "";
	const completion_date_str = (req.body.completion_date === "") ? null : (req.body.completion_date ?? null);
	const valid = (req.body.valid === "1" || (Array.isArray(req.body.valid) && req.body.valid.includes("1")));

	// techniques[] は 0件/1件/複数件の3パターンに備える
	const rawTech = req.body.techniques ?? req.body["techniques[]"];
	const selectedTechSlugs = Array.isArray(rawTech) ? rawTech : (rawTech ? [rawTech] : []);

	// YYYY-MM-DD → Firestore Timestamp|null
	const toTimestamp = (yyyy_mm_dd) => {
		if (!yyyy_mm_dd) return null;
		const d = new Date(yyyy_mm_dd);
		return Number.isNaN(d.getTime()) ? null : Timestamp.fromDate(d);
	};

	try {
		// 3) 作品ドキュメント取得（artwork_id で一意検索）
		const snap = await db.collection("sisiwaka_touen_artworks")
			.where("artwork_id", "==", idNum)
			.limit(1)
			.get();

		if (snap.empty) {
			console.error(`[edit_process] Artwork not found (ID=${idNum}).`);
			return redirect303(res, `/detail?id=${idNum}&flash_error=not_found`);
		}

		const docRef = snap.docs[0].ref;
		const current = snap.docs[0].data() || {};

		// 4) メディア valid 更新
		//    PHP: $_POST['media'][media_id] に 0/1 が入る → current.media[].valid を上書き
		const mediaFlags = (req.body.media && typeof req.body.media === "object") ? req.body.media : {};
		const nextMedia = Array.isArray(current.media)
			? current.media.map((m) => {
				if (!m || m.id === undefined || m.id === null) return m;

				const key = String(m.id);
				if (!Object.prototype.hasOwnProperty.call(mediaFlags, key)) {
					// → 未送信＝未チェック → false を上書き
					return { ...m, valid: false };
				}
				// 送られてきたら "1" 判定（単値だけなのでシンプル）
				const v = mediaFlags[key];
				const isValid = (v === "1" || v === 1 || v === true || v === "true");
				return { ...m, valid: isValid };
			})
			: [];

		// 5) 技法：全削除→選択分を {slug, valid:true} で上書き（RDBのDELETE→INSERT に相当）
		const nextTechniques = selectedTechSlugs.map((slug) => ({ slug, valid: true }));

		// 6) そのほかのフィールドを Firestore へ
		//    PHPの「coloring未送信はNULL」は、ここでは空→null に正規化
		const coloring_slug = (coloring === null || coloring === undefined || coloring === "") ? null : String(coloring);

		const nextDoc = {
			name,
			description_title,
			description,
			category_slug: category ?? "other",
			spec,
			coloring_slug,                                // null 許容
			clay,
			glaze,
			notes,
			in_stock: !!in_stock,
			shop_url,
			instagram_url,
			completion_date: toTimestamp(completion_date_str), // null or Timestamp
			valid: !!valid,
			update_date: FieldValue.serverTimestamp(),    // 更新時刻
			media: nextMedia,
			techniques: nextTechniques,
		};

		await docRef.update(nextDoc);

		// 7) リダイレクト（PHPの挙動に合わせる）
		if (!nextDoc.valid) {
			// 作品を無効化した場合は一覧へ
			return redirect303(res, `/works?flash=作品を削除しました。`);
		}
		// 有効のままなら詳細へ
		return redirect303(res, `/detail?id=${idNum}&flash=作品詳細を更新しました。`);

	} catch (e) {
		console.error("[/admin/edit_process] update error:", e);
		// 失敗時は編集画面へ戻す（PHPは edit.php だったが Node 版では /admin/edit）
		return redirect303(res, `/admin/edit?id=${idNum}&flash_error=作品詳細の書き込みでエラーが発生しました。`);
	}
});
