// /assets/js/updates.js
document.addEventListener('DOMContentLoaded', () => {
	// .update_article クラスを持つ要素をすべて取得
	const update_articles = document.querySelectorAll('.update_article');

	update_articles.forEach((text) => {
		text.addEventListener('click', () => {
			if (text.getAttribute('aria-expanded') === 'true') {
				text.setAttribute('aria-expanded', 'false');
				text.classList.add('is_collapsed');
				text.classList.remove('is_expanded');
			} else {
				text.setAttribute('aria-expanded', 'true');
				text.classList.remove('is_collapsed');
				text.classList.add('is_expanded');
			}
		});
	});
});
