FROM local/picoclaw-patched:launcher

RUN apk add --no-cache \
    bash \
    build-base \
    cairo-dev \
    curl \
    giflib-dev \
    git \
    jpeg-dev \
    nodejs \
    npm \
    pango-dev \
    pixman-dev \
    pkgconf \
    python3

RUN npm install -g pnpm@10.33.0

WORKDIR /workspace/airi-main

COPY docker/pico-avatar-allinone/defaults /opt/pico-avatar/defaults
COPY docker/pico-avatar-allinone/entrypoint.sh /usr/local/bin/pico-avatar-allinone-entrypoint

RUN chmod +x /usr/local/bin/pico-avatar-allinone-entrypoint

ENTRYPOINT ["/usr/local/bin/pico-avatar-allinone-entrypoint"]
