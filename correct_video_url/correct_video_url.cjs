// tools/cleanup_video_url_null.js
// Firestore の sisiwaka_touen_artworks で、media 配列内の video_url === "NULL" を削除する。
// 実行: node tools/cleanup_video_url_null.js
//
// 前提:
// - Cloud Shell / GCP 環境で gcloud auth 済み（ADC）
// - プロジェクトは gcloud config set project <PROJECT_ID> で選択済み
// - npm i @google-cloud/firestore を（プロジェクトのどこかで）実行済み

const { Firestore } = require('@google-cloud/firestore');

const COLLECTION = 'sisiwaka_touen_artworks';

// ドキュメントIDが 1〜3桁の数字だけを対象にする
const ID_RE = /^\d{1,3}$/;

// "NULL" を大小区別せず＆前後空白無視で判定
const isStringNullLiteral = (v) =>
	typeof v === 'string' && v.trim().toUpperCase() === 'NULL';

// 環境変数 DRY_RUN=1 で書き込みせずに確認だけ
const DRY_RUN = process.env.DRY_RUN === '1';

async function main() {
	const db = new Firestore();

	const colRef = db.collection(COLLECTION);
	const snap = await colRef.get();

	let docsChecked = 0;
	let docsUpdated = 0;
	let elementsFixed = 0;

	let batch = db.batch();
	let opsInBatch = 0;

	for (const doc of snap.docs) {
		docsChecked++;

		if (!ID_RE.test(doc.id)) {
			continue; // 指定どおり、1〜3桁の数値IDのみ対象
		}

		const data = doc.data();
		const media = Array.isArray(data.media) ? data.media : null;
		if (!media || media.length === 0) continue;

		let changed = false;

		const newMedia = media.map((item, idx) => {
			if (item && typeof item === 'object' && 'video_url' in item) {
				if (isStringNullLiteral(item.video_url)) {
					// video_url を削除した新しいオブジェクトを返す
					const { video_url, ...rest } = item;
					changed = true;
					elementsFixed++;
					return rest;
				}
			}
			return item;
		});

		if (changed) {
			docsUpdated++;
			if (!DRY_RUN) {
				batch.update(doc.ref, { media: newMedia });
				opsInBatch++;

				// Firestore バッチは最大 500 書き込み。余裕を持ってコミット。
				if (opsInBatch >= 450) {
					await batch.commit();
					batch = db.batch();
					opsInBatch = 0;
				}
			} else {
				console.log(`[DRY_RUN] Would update doc ${doc.id}`);
			}
		}
	}

	if (!DRY_RUN && opsInBatch > 0) {
		await batch.commit();
	}

	console.log('--- Summary ---');
	console.log(`Docs checked : ${docsChecked}`);
	console.log(`Docs updated : ${docsUpdated}`);
	console.log(`Items fixed  : ${elementsFixed}`);
	console.log(DRY_RUN ? 'Mode        : DRY_RUN (no writes)' : 'Mode        : WRITE');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
