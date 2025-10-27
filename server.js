// server.js（抜粋 or 追記）
// 事前に: npm i @google-cloud/firestore
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { Firestore } from "@google-cloud/firestore";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = process.env.PORT || 8080;

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
      const ymd = dt ? `${dt.getFullYear()}/${dt.getMonth()+1}/${dt.getDate()}` : "";
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
//  作品詳細
// ================================= 
// 先頭付近にあるはずの共通
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

// 作品詳細 /detail?id=123
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
      return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;
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
