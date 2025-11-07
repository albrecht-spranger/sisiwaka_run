document.addEventListener('DOMContentLoaded', () => {
	//
	// swiper作成
	//
	const swiper = new Swiper(".swiper", {
		centeredSlides: true,         // スライドを常に中央に
		loop: true,
		speed: 500,
		// スライドの表示枚数
		slidesPerView: 1,
		breakpoints: {
			// PC表示では画像を3枚に
			768: {
				slidesPerView: 3,
			},
		},
		spaceBetween: 0,     // ← ここで空白をゼロに
		autoplay: {
			delay: 3000,
			disableOnInteraction: false,
		},
		pagination: {
			el: ".swiper-pagination",
			clickable: true,
		},
		navigation: {
			nextEl: ".swiper-button-next",
			prevEl: ".swiper-button-prev",
		},
	});

	//
	// lightbox：スライダー画像をクリックしたら大きな画像を開く
	//
	const thumbs = document.querySelectorAll('.swiper-slide img');
	const lightbox = document.getElementById('lightbox');
	const imgEl = document.getElementById('lightboxImage');
	const videoEl = document.getElementById('lightboxVideo');

	// サムネイルクリックで開く
	thumbs.forEach(img => {
		img.addEventListener('click', () => {
			const isVideo = img.dataset.type === 'video' && img.dataset.video_src;
			if (isVideo) {
				openVideo({
					src: img.dataset.video_src,
					poster: img.dataset.poster || img.src,
					alt: img.alt || ''
				});
			} else {
				openImage({
					src: img.src,
					alt: img.alt || ''
				});
			}
		});
	});

	function showOverlay() {
		lightbox.style.display = 'flex';
		document.body.style.overflow = 'hidden';
		// ⇒背景のスクロールを停止
		lightbox.tabIndex = -1;
		lightbox.focus();
	}

	function hideOverlay() {
		lightbox.style.display = 'none';
		document.body.style.overflow = '';
		// ⇒背景のスクロールを再開
		lightbox.removeAttribute('tabindex');
	}

	// 画像を開く
	function openImage({ src, alt }) {
		// まず動画を隠す／停止
		resetVideo();

		imgEl.src = src;
		imgEl.alt = alt;
		imgEl.style.display = 'block';
		videoEl.style.display = 'none';

		showOverlay();
		requestAnimationFrame(() => imgEl.classList.add('show'));
	}

	// 動画を開く
	function openVideo({ src, poster, alt }) {
		// まず画像を隠す
		imgEl.classList.remove('show', 'closing');
		imgEl.style.display = 'none';

		// 動画をセット
		// autoplayはブラウザ仕様で無音なら通ることが多いので muted を付与
		videoEl.style.display = 'block';
		videoEl.setAttribute('playsinline', '');
		videoEl.setAttribute('controls', '');
		videoEl.muted = true;     // 自動再生したい場合はtrue推奨
		videoEl.loop = false;     // ループしたければ true
		if (poster) videoEl.poster = poster;

		// src を入れ直して読み込み
		// （毎回確実に読み込み直し、前回の続き再生を避ける）
		videoEl.src = src;
		videoEl.load();

		showOverlay();

		// 少し待ってからアニメ＆再生開始
		requestAnimationFrame(() => {
			videoEl.classList.add('show');
			// 自動再生（音声はmutedなので多くの環境で開始可能）
			videoEl.play().catch(() => {
				/* ブラウザが拒否した場合は無視（コントロールから再生可能） */
			});
		});
	}

	// オーバーレイ（レイヤ or 中身のどこをクリックしても）で閉じる
	lightbox.addEventListener('click', (e) => {
		// 動画のコントロール操作やスクラブ時は閉じないように、
		// クリック元が video の内部コントロールっぽいときはスキップ
		const isInsideControls = e.target === videoEl || videoEl.contains(e.target);
		if (isInsideControls) return;

		closeLightbox();
	});

	// Esc キーで閉じる
	document.addEventListener('keydown', (e) => {
		const isOpen = lightbox.style.display === 'flex';
		if (isOpen && (e.key === 'Escape' || e.key === 'Esc')) {
			closeLightbox();
		}
	});

	// ====== 閉じる処理 ======
	function closeLightbox() {
		const opened = document.querySelector('#lightbox .lightbox-media.show');
		if (!opened) { hideOverlay(); return; }

		// 開いている要素（img or video）に閉じるアニメを適用
		opened.classList.remove('show');
		opened.classList.add('closing');
		opened.addEventListener('transitionend', handleCloseEnd, { once: true });
	}

	function handleCloseEnd() {
		// 両方のメディア要素の closing を外し、非表示に戻す
		imgEl.classList.remove('closing');
		videoEl.classList.remove('closing');

		// 動画は停止＆ソース解放（帯域節約）
		resetVideo();

		hideOverlay();
	}

	function resetVideo() {
		try {
			videoEl.pause();
		} catch { }
		videoEl.removeAttribute('poster');
		// ソースを空にして完全停止 → 次回クリックでロードし直す
		videoEl.removeAttribute('src');
		videoEl.load();
		videoEl.style.display = 'none';
		videoEl.classList.remove('show', 'closing');
	}
});
