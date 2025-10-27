# ---------- deps stage: Composerでライブラリを取得 ----------
FROM composer:2 AS deps
WORKDIR /app
# プロジェクトのcomposerファイルだけ先にコピー（キャッシュ効く）
COPY composer.json composer.lock ./
RUN composer install --no-dev --prefer-dist --classmap-authoritative --optimize-autoloader

# ---------- app stage: nginx + php-fpm + grpc/protobuf ----------
FROM php:8.2-fpm-bullseye

# 必要パッケージ & nginx/supervisor の導入
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx supervisor git unzip ca-certificates \
    libzip-dev libicu-dev zlib1g-dev libonig-dev \
  && rm -rf /var/lib/apt/lists/*

# PHP 拡張（intl, opcache などは任意）
RUN docker-php-ext-install -j$(nproc) intl opcache

# gRPC / protobuf を PECL 経由で導入
RUN pecl install grpc protobuf \
  && docker-php-ext-enable grpc protobuf

# タイムゾーン（必要に応じて）
RUN echo "date.timezone=Asia/Tokyo" > /usr/local/etc/php/conf.d/timezone.ini

# PHP-FPM を 127.0.0.1:9000 で待受（デフォルトでもOKだが明示）
RUN sed -ri 's|^;?listen = .*|listen = 127.0.0.1:9000|g' /usr/local/etc/php-fpm.d/zz-docker.conf

# Nginx の設定テンプレ（$PORT 反映用）
ENV PORT=8080
COPY .docker/nginx.conf.template /etc/nginx/templates/default.conf.template

# supervisord 設定
COPY .docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# アプリ配置
WORKDIR /var/www/html
COPY . .                       # 先にアプリ本体
COPY --from=deps /app/vendor ./vendor  # Composer依存性をコピー

# Nginxのドキュメントルート権限（必要なら）
RUN chown -R www-data:www-data /var/www/html

# Cloud Run は単一ポートをListenする必要がある → Nginxが $PORT をListen
# 起動時にテンプレートを具体化してからsupervisordで2プロセス起動
CMD /bin/sh -lc "envsubst '\$PORT' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf \
  && exec /usr/bin/supervisord -n -c /etc/supervisor/conf.d/supervisord.conf"
