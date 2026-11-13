# Facebook Video Archive

A personal video library with a web interface, backed by your MongoDB server and `yt-dlp`. It can save Facebook videos you own or are allowed to archive, then search and play the downloaded files in a browser.

Facebook changes its website often, so extraction depends on the current `yt-dlp` support. Use only videos you have permission to save.

## Run with Docker Compose

1. Set `MONGODB_URI` in `.env` (or copy `.env.example` if the file is missing). For Atlas, copy the driver URI from Atlas. Set `MONGODB_DATABASE=facebook_archive` or choose another database name. Local Compose reads these values from `.env`; Portainer can inject them as stack environment variables.
2. Start the app from this folder:

   ```sh
   docker compose up -d --build
   ```

3. Open [http://localhost:8080](http://localhost:8080).

The app stores downloaded videos and metadata in `./library`. The video catalog uses MongoDB collection `facebook_videos`; download history and logs use `facebook_download_jobs`.

View application logs with:

```sh
docker compose logs -f facebook-archive
```

Logs are JSON records with timestamps, severity, event names, and request/download context. `LOG_LEVEL=debug` includes HTTP request logs. Compose rotates container logs to keep the local log files bounded. The MongoDB server is selected by `MONGODB_URI` and runs separately (for example, MongoDB Atlas).

### Optional Facebook cookies

For videos your signed-in account is allowed to view, put an yt-dlp-compatible Netscape cookie file at `./config/cookies.txt` and set this in `.env`:

```dotenv
COOKIE_FILE=/config/cookies.txt
```

Restart the app with `docker compose up -d`. Treat that file like a password. The web UI is bound to localhost by default.

## Web library

The interface provides URL submission, download status, title/creator search, thumbnails, and in-browser playback. One URL per line is supported, with up to 20 links per submission. Download jobs and the catalog are stored in MongoDB; media files remain in the mounted library folder.

## Run the Node server directly

Install dependencies, make sure `.env` contains `MONGODB_URI`, then start the server:

```sh
npm install
npm start
```

The configured MongoDB user needs read/write permission on the database named by `MONGODB_DATABASE` (default `facebook_archive`). URL-encode special characters in the URI username or password.

## Run the original CLI without Docker

Install Node.js 18+, `yt-dlp`, and `ffmpeg`, then use:

```sh
npm run archive -- "https://www.facebook.com/watch/?v=123456789"
npm run archive -- --input urls.txt --output ./library
```

The standalone CLI writes an archive list so repeated runs skip previously downloaded items.
