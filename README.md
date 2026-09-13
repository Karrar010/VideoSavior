# VideoSavior

**Live:** https://videosavior.onrender.com (free-tier hosting — spins down
after 15 min idle, so the first request after a quiet period takes ~30-50s
to wake up)

A self-hosted media downloader — paste a link, get an MP4 or MP3. Built as a
sharper take on [reclip](https://github.com/averygan/reclip): same idea (a thin
Flask + yt-dlp + ffmpeg app, no build step, no framework), better interface and
a couple of features reclip doesn't have.

## What's different from reclip

- **Live previews before you commit.** Every queued link is resolved through
  yt-dlp immediately (title, thumbnail, duration, uploader) so you know what
  you're about to pull down.
- **Searchable site index.** The full yt-dlp extractor list (1,379 sites) is
  shipped as data and searchable right in the page — see
  [`SUPPORTED_SITES.md`](SUPPORTED_SITES.md) for the categorized master list
  (video / audio / image / mixed).
- **One-click zip for bulk jobs**, with a `failed_urls.txt` bundled in if any
  link in the batch didn't resolve, instead of silently dropping it.
- **Accessible, keyboard-usable UI**: proper labels, focus states, live
  regions for status updates, no click-only affordances.
- **Dark/light theme** that respects `prefers-color-scheme` and remembers your
  choice.
- **Known-issue detection.** yt-dlp's maintainers track ~136 extractors as
  currently broken upstream. VideoSavior checks a pasted link against that list
  *before* attempting anything, and tells you "this is a known upstream issue,
  not a bug here" instead of a generic failure.
- **Optional browser-cookies auth**, for sites (usually YouTube) that demand
  proof you're not a bot. Reads cookies from a browser already logged in on
  this machine — nothing leaves it.

Core mechanics are intentionally the same as reclip's: no database, no queue
worker, no accounts — paste a link, get a file, done.

## Stack

- **Backend:** Flask + [yt-dlp](https://github.com/yt-dlp/yt-dlp) (the actual
  extraction/downloading engine) + ffmpeg (merging/transcoding).
- **Frontend:** vanilla HTML/CSS/JS, no build step, no framework.

## Setup

### Prerequisites

- Python 3.10+
- [ffmpeg](https://ffmpeg.org/download.html) on your `PATH` (required for MP4
  muxing and all MP3 extraction)

### Run locally

```bash
python -m venv .venv
source .venv/bin/activate   # .venv\Scripts\activate on Windows
pip install -r requirements.txt
python app.py
```

Then open http://localhost:5050.

### Run with Docker

```bash
docker build -t videosavior .
docker run -p 5050:5050 videosavior
```

### Deploy (Render, free)

`render.yaml` and the `Dockerfile` are ready as-is — Render's Docker runtime
installs ffmpeg and dependencies automatically. In Render: **New → Blueprint**
→ connect this repo → **Deploy Blueprint**. No environment variables needed;
`PORT` is injected by Render and read in `app.py`.

## Known limitation: YouTube on the live deployment

YouTube downloads don't work on the hosted Render instance — YouTube's
bot-detection flags Render's datacenter IP address itself, regardless of
whether valid login cookies are attached (confirmed: the exact same cookies
that work when run locally get blocked identically from Render). This is a
known problem for anyone self-hosting yt-dlp-based tools on any cloud
provider, not something fixable in this codebase without a paid residential
proxy. Every other supported site is unaffected. Run VideoSavior locally
(see Setup below) for YouTube downloads — the server-side cookie/EJS setup
below still applies there, it just isn't blocked by IP reputation on your
own network.

### Server-side cookie auth (for self-hosted deployments)

`YTDLP_COOKIES_FILE` (env var) points at a Netscape-format `cookies.txt` -
falls back to a `cookies.txt` dropped next to `app.py` if unset. This lets a
logged-in session apply automatically for every visitor, since there's no
browser on a cloud host for the `browser` field's `--cookies-from-browser`
to read from. Use a throwaway account's cookies, never your main one — see
the git history on this file for the full reasoning and export steps.

Also requires a JS runtime for yt-dlp's EJS challenge solver (works around
YouTube's "n" parameter obfuscation) - the `Dockerfile` installs Node 22 for
this; running outside Docker needs Node 22+ on `PATH` and `pip install
"yt-dlp[default]"` (not plain `yt-dlp`).

## Analytics

Page views and clicks are tracked via [PostHog](https://posthog.com) (see the
snippet in `templates/index.html`). View them in the PostHog dashboard under
**Web analytics** (traffic overview), **Activity** (live event stream), or
**Persons** (per-visitor sessions/location/device).

## How it works

1. `POST /api/info` resolves a URL through yt-dlp (no download) and returns
   title, thumbnail, duration, uploader, and the resolutions actually
   available for that video.
2. `POST /api/download` downloads one clip server-side into a temp directory
   and streams it back as an attachment, then deletes the temp directory.
3. `POST /api/download/bulk` does the same for a list of URLs and zips the
   results.

All three accept an optional `browser` field (`chrome`, `firefox`, `edge`,
`brave`, `opera`, or `vivaldi`) that gets passed to yt-dlp as
`--cookies-from-browser`. Close the browser first if it locks its cookie
database — this is a known yt-dlp/Chromium limitation
([yt-dlp#7271](https://github.com/yt-dlp/yt-dlp/issues/7271)), not something
VideoSavior can work around.

## Supported sites

VideoSavior supports whatever yt-dlp supports — currently **1,379 distinct
sites** across **1,731 extractors** (YouTube, TikTok, Instagram, X, Reddit,
Facebook, Vimeo, Twitch, Dailymotion, SoundCloud, Bandcamp, Pinterest, Tumblr,
Threads, Bilibili, VK, Snapchat, Loom, Flickr, Imgur, and hundreds more). See
[`SUPPORTED_SITES.md`](SUPPORTED_SITES.md) for the full categorized list, or
use the search box on the page itself.

## Legal

Only download content you own or have explicit permission/rights to download.
This tool doesn't circumvent DRM and inherits whatever restrictions yt-dlp
respects upstream.
