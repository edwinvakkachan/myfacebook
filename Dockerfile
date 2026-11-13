FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=3000 \
    LIBRARY_DIR=/library

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg ca-certificates \
    && python3 -m pip install --break-system-packages --no-cache-dir yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public

EXPOSE 3000
CMD ["npm", "start"]
