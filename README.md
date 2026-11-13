# Facebook Video Archive

A Node.js command-line wrapper around [yt-dlp](https://github.com/yt-dlp/yt-dlp) for building a personal, Tube Archivist style library from Facebook video or page URLs.

## Requirements

- Node.js 18 or newer
- `yt-dlp` installed and available on `PATH` (or pass `--yt-dlp PATH`)
- `ffmpeg` available on `PATH` for metadata embedding and format merging

Facebook changes its website frequently, so a URL only works while yt-dlp's Facebook extractor supports it. Use this only for videos you own or have permission to archive, and follow Facebook's terms and applicable copyright rules.

## Use

Pass a single video URL:

```sh
npm run archive -- "https://www.facebook.com/watch/?v=123456789"
```

Pass multiple URLs:

```sh
npm run archive -- "https://www.facebook.com/watch/?v=123" "https://fb.watch/example/"
```

Or make `urls.txt` with one URL per line (lines beginning with `#` are ignored):

```sh
npm run archive -- --input urls.txt --output ./library
```

For videos your logged-in account can access, yt-dlp can read cookies from a supported local browser profile:

```sh
npm run archive -- --input urls.txt --browser chrome
```

Supported browser names and profile syntax depend on yt-dlp; see its `--cookies-from-browser` help. Keep your browser profile and any exported cookies private.

## Library layout

Downloads are organized as:

```text
library/
  <uploader>/
    <playlist or Videos>/
      <date> - <title> [<video-id>].mp4
      <date> - <title> [<video-id>].info.json
      <date> - <title> [<video-id>].description
      <date> - <title> [<video-id>].jpg
  download-archive.txt
```

`download-archive.txt` lets yt-dlp skip videos it has already downloaded on later runs. Remove an entry from that file if you intentionally want to retry that video.
