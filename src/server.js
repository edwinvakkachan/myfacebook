import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import process from 'node:process';
import 'dotenv/config';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, '../public');
const libraryDir = path.resolve(process.env.LIBRARY_DIR || './library');
const port = Number(process.env.PORT || 3000);
const logLevels = { debug: 10, info: 20, warn: 30, error: 40 };
const configuredLevel = logLevels[process.env.LOG_LEVEL] ? process.env.LOG_LEVEL : 'info';
const videoExtensions = new Set(['.mp4', '.mkv', '.webm', '.mov', '.m4v']);
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const mimeTypes = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
};

function log(level, event, fields = {}) {
  if (logLevels[level] < logLevels[configuredLevel]) return;
  const record = JSON.stringify({ timestamp: new Date().toISOString(), level, service: 'facebook-archive', event, ...fields });
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(record);
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function isFacebookUrl(value) {
  try {
    const u = new URL(value);
    return ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.watch'].includes(u.hostname.toLowerCase());
  } catch { return false; }
}

async function scanLibrary(dir = libraryDir, found = []) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return found; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await scanLibrary(full, found);
    } else if (entry.isFile() && entry.name.endsWith('.info.json')) {
      try {
        const info = JSON.parse(await readFile(full, 'utf8'));
        const siblings = await readdir(path.dirname(full));
        const stem = entry.name.slice(0, -'.info.json'.length);
        const videoName = siblings.find((name) => name.startsWith(`${stem}.`) && videoExtensions.has(path.extname(name).toLowerCase()));
        if (!videoName) continue;
        const thumbnailName = siblings.find((name) => name.startsWith(`${stem}.`) && imageExtensions.has(path.extname(name).toLowerCase()));
        const relative = (name) => path.relative(libraryDir, name).split(path.sep).join('/');
        found.push({
          video: relative(path.join(path.dirname(full), videoName)),
          thumbnail: thumbnailName ? relative(path.join(path.dirname(full), thumbnailName)) : null,
          id: String(info.id || stem), title: info.title || stem,
          uploader: info.uploader || info.channel || 'Unknown uploader',
          uploadDate: info.upload_date || '', duration: info.duration || null,
          description: info.description || '', webpageUrl: info.webpage_url || '',
        });
      } catch (error) {
        log('warn', 'metadata_parse_failed', { file: path.relative(libraryDir, full), error: error.message });
      }
    }
  }
  return found;
}

async function syncLibrary() {
  const videos = await scanLibrary();
  if (videos.length) {
    await videoCollection.bulkWrite(videos.map((video) => ({
      updateOne: {
        filter: { video: video.video },
        update: { $set: { ...video, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
        upsert: true,
      },
    })), { ordered: false });
  }
  await videoCollection.deleteMany({ video: { $nin: videos.map((video) => video.video) } });
  log('info', 'library_synced', { videoCount: videos.length });
  return videos.length;
}

function isFacebookUrlList(body) {
  return Array.isArray(body.urls) && body.urls.length > 0 && body.urls.length <= 20
    && body.urls.every((value) => typeof value === 'string' && isFacebookUrl(value.trim()));
}

async function readRequestBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 64_000) throw new Error('Request body is too large.');
  }
  return JSON.parse(body || '{}');
}

async function startDownload(url) {
  const id = randomUUID();
  const startedAt = new Date();
  const record = { id, url, status: 'running', startedAt, output: '' };
  await jobCollection.insertOne(record);
  const args = [
    '--ignore-errors', '--no-overwrites', '--newline', '--no-color', '--download-archive', path.join(libraryDir, 'download-archive.txt'),
    '--write-info-json', '--write-description', '--write-thumbnail', '--embed-metadata', '--windows-filenames',
    '--output', path.join(libraryDir, '%(uploader,channel|Unknown uploader)s', '%(playlist_title|Videos)s', '%(upload_date)s - %(title).180B [%(id)s].%(ext)s'),
  ];
  if (process.env.COOKIE_FILE) args.push('--cookies', process.env.COOKIE_FILE);
  args.push(url);
  log('info', 'download_started', { jobId: id, url });
  const child = spawn(process.env.YTDLP_PATH || 'yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  let lastPersist = 0;
  const append = (chunk) => {
    output = (output + chunk.toString()).slice(-12_000);
    if (Date.now() - lastPersist > 1500) {
      lastPersist = Date.now();
      void jobCollection.updateOne({ id }, { $set: { output } }).catch((error) => log('error', 'job_log_persist_failed', { jobId: id, error: error.message }));
    }
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.on('error', async (error) => {
    output = `${output}\n${error.message}`.slice(-12_000);
    await jobCollection.updateOne({ id }, { $set: { status: 'failed', output, finishedAt: new Date(), exitCode: null } });
    log('error', 'download_process_error', { jobId: id, error: error.message });
  });
  child.on('close', async (code, signal) => {
    const status = code === 0 ? 'complete' : 'failed';
    await jobCollection.updateOne({ id }, { $set: { status, output, finishedAt: new Date(), exitCode: code } });
    log(status === 'complete' ? 'info' : 'error', 'download_finished', { jobId: id, status, exitCode: code, signal, elapsedMs: Date.now() - startedAt.getTime() });
    if (status === 'complete') {
      try { await syncLibrary(); } catch (error) { log('error', 'library_sync_failed', { jobId: id, error: error.message }); }
    }
  });
  return { id, url, status: 'running', startedAt };
}

async function serveFile(req, res, filePath) {
  const info = await stat(filePath);
  const type = mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;
  if (range && type.startsWith('video/')) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) { res.writeHead(416); res.end(); return; }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
    if (start > end || start >= info.size) { res.writeHead(416, { 'content-range': `bytes */${info.size}` }); res.end(); return; }
    res.writeHead(206, { 'content-type': type, 'content-length': end - start + 1, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${info.size}` });
    createReadStream(filePath, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'content-type': type, 'content-length': info.size, 'accept-ranges': 'bytes' });
  createReadStream(filePath).pipe(res);
}

if (!process.env.MONGODB_URI) {
  throw new Error('MONGODB_URI is missing. Add it to .env or the process environment.');
}
const client = new MongoClient(process.env.MONGODB_URI);
try {
  await client.connect();
} catch (error) {
  log('error', 'mongodb_connection_failed', { error: error.message });
  throw error;
}
const db = client.db(process.env.MONGODB_DATABASE || 'facebook_archive');
const videoCollection = db.collection('facebook_videos');
const jobCollection = db.collection('facebook_download_jobs');
await videoCollection.createIndex({ video: 1 }, { unique: true });
await videoCollection.createIndex({ uploadDate: -1, title: 1 });
await jobCollection.createIndex({ startedAt: -1 });
await jobCollection.updateMany({ status: 'running' }, { $set: { status: 'failed', finishedAt: new Date(), output: 'Container restarted before this download finished.' } });
await import('node:fs/promises').then(({ mkdir }) => mkdir(libraryDir, { recursive: true }));
log('info', 'mongodb_connected', { database: db.databaseName });
try { await syncLibrary(); } catch (error) { log('error', 'initial_library_sync_failed', { error: error.message }); }

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/api/videos') {
      const videos = await videoCollection.find({}, { projection: { _id: 0 } }).sort({ uploadDate: -1, title: 1 }).toArray();
      sendJson(res, 200, videos);
    } else if (req.method === 'GET' && url.pathname === '/api/jobs') {
      const result = await jobCollection.find({}, { projection: { _id: 0 } }).sort({ startedAt: -1 }).limit(20).toArray();
      sendJson(res, 200, result);
    } else if (req.method === 'POST' && url.pathname === '/api/downloads') {
      const body = await readRequestBody(req);
      if (!isFacebookUrlList(body)) { sendJson(res, 400, { error: 'Enter 1 to 20 valid Facebook URLs.' }); return; }
      const urls = [...new Set(body.urls.map((value) => value.trim()))];
      const created = await Promise.all(urls.map(startDownload));
      sendJson(res, 202, created);
    } else if (req.method === 'GET' && url.pathname === '/media') {
      const relative = url.searchParams.get('file') || '';
      const filePath = path.resolve(libraryDir, relative);
      if (!filePath.startsWith(`${libraryDir}${path.sep}`)) { res.writeHead(403); res.end(); return; }
      if (!videoExtensions.has(path.extname(filePath).toLowerCase()) && !imageExtensions.has(path.extname(filePath).toLowerCase())) { res.writeHead(415); res.end(); return; }
      await serveFile(req, res, filePath);
    } else if (req.method === 'GET') {
      const asset = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const filePath = path.resolve(publicDir, asset);
      if (!filePath.startsWith(`${publicDir}${path.sep}`)) { res.writeHead(403); res.end(); return; }
      await serveFile(req, res, filePath);
    } else {
      sendJson(res, 405, { error: 'Method not allowed.' });
    }
  } catch (error) {
    log('error', 'request_failed', { method: req.method, path: req.url, error: error.message });
    if (!res.headersSent) sendJson(res, 500, { error: error.message || 'Unexpected server error.' });
    else res.destroy(error);
  } finally {
    log('debug', 'http_request', { method: req.method, path: req.url, status: res.statusCode, elapsedMs: Date.now() - started });
  }
});

server.listen(port, '0.0.0.0', () => log('info', 'server_listening', { port, libraryDir }));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    log('info', 'shutdown_started', { signal });
    server.close();
    await client.close();
    process.exit(0);
  });
}
