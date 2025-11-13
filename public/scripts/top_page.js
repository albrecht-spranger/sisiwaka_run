// /assets/js/updates.js
document.addEventListener('DOMContentLoaded', () => {
	// .update_article クラスを持つ要素をすべて取得
	const update_articles = document.querySelectorAll('.update_article');

	update_articles.forEach((text) => {
		// 行の高さを取得
		const style = window.getComputedStyle(text);
		let line_height = parseFloat(style.lineHeight);
		const full_height = text.scrollHeight;

		// 1行ぶんより高ければ「複数行」と判定
		const has_more = full_height > line_height + 1; // 誤差分 +1

		if (has_more) {
			// 複数行 → 折りたたみ対象
			text.classList.add("has_more");
			text.classList.add("is_collapsed");
			text.setAttribute("aria-expanded", "false");

			// クリックで開閉
			text.addEventListener("click", function () {
				const expanded = text.getAttribute("aria-expanded") === "true";
				if (expanded) {
					// 今 開いている → 閉じる
					text.setAttribute("aria-expanded", "false");
					text.classList.add("is_collapsed");
				} else {
					// 今 閉じている → 開く
					text.setAttribute("aria-expanded", "true");
					text.classList.remove("is_collapsed");
				}
			});
		} else {
			// 1行以内 → 何もしない（矢印も出さない）
			text.classList.remove("is_collapsed");
			text.removeAttribute("aria-expanded");
			text.classList.remove("has_more");
		}
	});
});
