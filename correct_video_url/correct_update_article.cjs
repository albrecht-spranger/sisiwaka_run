const { Firestore, Timestamp } = require('@google-cloud/firestore');
const COLLECTION = 'sisiwaka_touen_updates';

async function addUpdate() {
	const db = new Firestore();
	const docRef = db.collection(COLLECTION).doc(); // 自動ID

	const articleText = `以下の作品を追加しました。
  ・玉サボテン様コーヒーカップ「黒亀」
  ・柱サボテン様コーヒーカップ「十二刻」
  ・玉サボテン様12足黒マットパスタ皿「玄武皿」
  ・サボテン菊水様コーヒーカップ「アルマジロ」
  ・玉サボテン様しのぎマグカップ「赫耀の秘光」
  ・玉サボテン様練り込みコーヒーカップ「モアレ」
  ・サボテン金剛丸様練り込みコーヒーカップ「雲海のピラミッド」
  ・玉サボテン様乳濁赤結晶どんぶり「翠紅碗」
  ・玉サボテン様練り込みコーヒーカップ「目覚めのフクロウ」
  ・サボテン様練り込みコーヒーカップ「瑪瑙環」
  ・玉サボテン様練り込みコーヒーカップ「瑪瑙晶」
  ・玉サボテン様練り込みコーヒーカップ「瑪瑙墨」
  ・サボテン金剛丸様練り込み中鉢「雪墨嶺」
  ・ねじり金剛丸様練り込みデミタスカップ「牡蠣の群生」`;

	// created_at を Firestore Timestamp に変換
	const createdAt = new Date("2025/10/20 11:03:33.000");
	const timestamp = Timestamp.fromDate(createdAt);

	const valid = true;

	try {
		await docRef.set({
			article: articleText,
			created_at: timestamp,
			valid: valid,
		});

		console.log("✅ Document successfully written!");
	} catch (error) {
		console.error("❌ Error writing document:", error);
	}
}

addUpdate();
