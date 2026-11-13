#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { access, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const help = `Usage:
  npm run archive -- [options] <facebook-url> [facebook-url ...]
  npm run archive -- --input urls.txt [options]

Options:
  --input FILE                 Read one URL per line (# comments allowed)
  --output DIR                 Archive root (default: ./library)
  --browser BROWSER[:PROFILE]  Use a browser's logged-in cookies (e.g. chrome)
  --yt-dlp PATH                yt-dlp executable (default: yt-dlp)
  --help                       Show this help

Examples:
  npm run archive -- "https://www.facebook.com/watch/?v=123456789"
  npm run archive -- --input pages.txt --output "D:/Video Archive" --browser chrome

Only archive videos you own or are authorized to save. Browser cookies grant access
to your account; keep them private. Install yt-dlp and ffmpeg separately.
`;

function parseArgs(argv) {
  const opts = { output: 'library', ytdlp: 'yt-dlp', urls: [], input: null, browser: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (['--input', '--output', '--browser', '--yt-dlp'].includes(arg)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      if (arg === '--input') opts.input = value;
      if (arg === '--output') opts.output = value;
      if (arg === '--browser') opts.browser = value;
      if (arg === '--yt-dlp') opts.ytdlp = value;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else opts.urls.push(arg);
  }
  return opts;
}

function isFacebookUrl(value) {
  try {
    const url = new URL(value);
    return ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.watch'].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error('Use --help for usage.');
    process.exitCode = 2;
    return;
  }
  if (opts.help) {
    console.log(help);
    return;
  }

  if (opts.input) {
    const content = await readFile(opts.input, 'utf8');
    opts.urls.push(...content.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#')));
  }
  const urls = [...new Set(opts.urls)];
  if (!urls.length) {
    console.error('Provide at least one Facebook URL or --input file. Use --help for usage.');
    process.exitCode = 2;
    return;
  }
  const invalid = urls.filter((url) => !isFacebookUrl(url));
  if (invalid.length) {
    console.error(`Only Facebook video/page URLs are accepted. Invalid: ${invalid.join(', ')}`);
    process.exitCode = 2;
    return;
  }

  const outputRoot = path.resolve(opts.output);
  await mkdir(outputRoot, { recursive: true });
  const archiveFile = path.join(outputRoot, 'download-archive.txt');
  const args = [
    '--ignore-errors',
    '--no-overwrites',
    '--download-archive', archiveFile,
    '--write-info-json',
    '--write-description',
    '--write-thumbnail',
    '--embed-metadata',
    '--windows-filenames',
    '--output', path.join(outputRoot, '%(uploader,channel|Unknown uploader)s', '%(playlist_title|Videos)s', '%(upload_date)s - %(title).180B [%(id)s].%(ext)s'),
    ...urls,
  ];
  if (opts.browser) args.unshift('--cookies-from-browser', opts.browser);

  try {
    await access(outputRoot);
  } catch {
    console.error(`Cannot access output directory: ${outputRoot}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Saving ${urls.length} URL(s) into ${outputRoot}`);
  const child = spawn(opts.ytdlp, args, { stdio: 'inherit', windowsHide: true });
  child.on('error', (error) => {
    console.error(`Could not start yt-dlp (${opts.ytdlp}): ${error.message}`);
    console.error('Install yt-dlp or pass its executable path with --yt-dlp.');
    process.exitCode = 1;
  });
  child.on('close', (code, signal) => {
    if (signal) console.error(`yt-dlp stopped by ${signal}`);
    process.exitCode = code ?? 1;
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
