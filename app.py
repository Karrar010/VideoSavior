import glob
import json
import os
import re
import shutil
import tempfile
import uuid
import zipfile
from pathlib import Path

import yt_dlp
from flask import Flask, after_this_request, jsonify, render_template, request, send_file
from yt_dlp.extractor import gen_extractor_classes

app = Flask(__name__)
BROKEN_SITES_JSON = Path(__file__).parent / "static" / "broken_sites.json"

QUALITY_HEIGHTS = {2160, 1440, 1080, 720, 480, 360, 240}
MP3_BITRATES = {"128", "192", "320"}
MAX_BULK_ITEMS = 15  # keeps the zip (built server-side, then buffered client-side) from ballooning past what a phone's browser can hold in memory
BROWSER_CHOICES = {"chrome", "firefox", "edge", "brave", "opera", "vivaldi"}

# Chromium forks yt-dlp doesn't know by name. Its cookie decryptor works fine
# against them anyway since they share Chrome's cookie DB/encryption format -
# it just needs to be pointed at the fork's actual profile directory instead
# of "chrome"'s own, via cookiesfrombrowser's profile-path override.
UNLISTED_CHROMIUM_FORKS = {
    "helium": os.path.join(os.environ.get("LOCALAPPDATA", ""), "imput", "Helium", "User Data", "Default"),
}


def cookies_from_browser_opt(browser: str) -> tuple | None:
    if browser in UNLISTED_CHROMIUM_FORKS:
        profile = UNLISTED_CHROMIUM_FORKS[browser]
        return ("chrome", profile, None, None) if os.path.isdir(profile) else None
    if browser in BROWSER_CHOICES:
        return (browser, None, None, None)
    return None


# Exported cookies.txt (Netscape format) for a throwaway YouTube account, used
# as a server-side fallback so sites requiring login work for every visitor -
# there's no browser on the host for cookiesfrombrowser to read from.
# YTDLP_COOKIES_FILE overrides the path (e.g. a Render secret file's mount
# point); otherwise a cookies.txt dropped next to app.py is picked up.
_cookies_path = os.environ.get("YTDLP_COOKIES_FILE", "cookies.txt")
if os.path.isfile(_cookies_path):
    # yt-dlp rewrites the cookiejar after use to persist any rotated session
    # cookies - Render's secret-file mount is read-only, so give it a
    # writable copy instead of the original.
    COOKIES_FILE = os.path.join(tempfile.gettempdir(), "yt-dlp-cookies.txt")
    shutil.copyfile(_cookies_path, COOKIES_FILE)
else:
    COOKIES_FILE = None


def apply_cookie_opts(opts: dict, browser: str | None) -> None:
    cookie_opt = cookies_from_browser_opt(browser) if browser else None
    if cookie_opt:
        opts["cookiesfrombrowser"] = cookie_opt
    elif COOKIES_FILE:
        opts["cookiefile"] = COOKIES_FILE
    else:
        return
    # YouTube's default client for logged-in requests (tv_downgraded) is
    # broken as of 2026 ("The page needs to be reloaded" on every request) -
    # https://github.com/yt-dlp/yt-dlp/issues/17389. Force clients that still work.
    opts["extractor_args"] = {"youtube": {"player_client": ["default", "web_embedded"]}}


def find_ffmpeg() -> str | None:
    """Locate ffmpeg even when it's missing from this process's PATH.

    A freshly-installed ffmpeg (e.g. via winget) only reaches PATH once you
    open a new terminal - common enough on Windows that it's worth checking
    the standard per-user package-manager install spots directly instead of
    surfacing a dead end.
    """
    found = shutil.which("ffmpeg")
    if found:
        return os.path.dirname(found)
    local = os.environ.get("LOCALAPPDATA", "")
    candidates = glob.glob(
        os.path.join(local, "Microsoft", "WinGet", "Packages", "Gyan.FFmpeg*", "ffmpeg-*", "bin", "ffmpeg.exe")
    ) + glob.glob(os.path.join("C:\\ffmpeg", "bin", "ffmpeg.exe"))
    return os.path.dirname(candidates[0]) if candidates else None


FFMPEG_LOCATION = find_ffmpeg()

with open(BROKEN_SITES_JSON, encoding="utf-8") as f:
    BROKEN_EXTRACTORS = set(json.load(f))

# Extractors that actually have a URL pattern to match against (skip the
# generic fallback extractor, which is "suitable" for literally everything).
_URL_EXTRACTORS = [ie for ie in gen_extractor_classes() if ie.IE_NAME != "generic"]


def match_extractor(url: str) -> str | None:
    """Find which yt-dlp extractor would handle this URL, without any network call."""
    for ie in _URL_EXTRACTORS:
        try:
            if ie.suitable(url):
                return ie.IE_NAME
        except Exception:
            continue
    return None


def clean_error(exc: Exception) -> str:
    msg = re.sub(r"^ERROR:\s*", "", str(exc))
    return msg.splitlines()[0][:200] if msg else "Unknown error"


def broken_site_response(extractor_name: str) -> dict:
    return {
        "ok": False,
        "broken": True,
        "site": extractor_name,
        "error": (
            f"“{extractor_name}” support is currently broken upstream in yt-dlp "
            "(the site changed something yt-dlp hasn't caught up with yet). "
            "This is a known issue being tracked by yt-dlp's maintainers, not a VideoSavior bug "
            "— it should start working again once yt-dlp ships a fix."
        ),
    }


def probe(url: str, browser: str | None = None) -> dict:
    opts = {
        "quiet": True, "no_warnings": True, "skip_download": True, "noplaylist": True,
        "js_runtimes": {"node": {}},  # solves YouTube's "n" challenge - see EJS wiki
    }
    apply_cookie_opts(opts, browser)
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    if info.get("entries"):
        info = info["entries"][0]

    heights = sorted(
        {f.get("height") for f in info.get("formats", []) if f.get("height") in QUALITY_HEIGHTS},
        reverse=True,
    )
    qualities = [{"label": "Best available", "value": "best"}]
    qualities += [{"label": f"{h}p", "value": str(h)} for h in heights[:6]]

    return {
        "ok": True,
        "title": info.get("title") or url,
        "thumbnail": info.get("thumbnail"),
        "duration": info.get("duration"),
        "uploader": info.get("uploader") or info.get("channel"),
        "extractor": info.get("extractor_key") or info.get("extractor") or "generic",
        "qualities": qualities,
    }


def build_ydl_opts(outtmpl: str, mode: str, quality: str, browser: str | None = None) -> dict:
    opts = {
        "outtmpl": outtmpl,
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "restrictfilenames": True,
        "js_runtimes": {"node": {}},  # solves YouTube's "n" challenge - see EJS wiki
    }
    if FFMPEG_LOCATION:
        opts["ffmpeg_location"] = FFMPEG_LOCATION
    apply_cookie_opts(opts, browser)
    if mode == "mp3":
        bitrate = quality if quality in MP3_BITRATES else "192"
        opts["format"] = "bestaudio/best"
        opts["postprocessors"] = [
            {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": bitrate}
        ]
    else:
        height = quality if quality.isdigit() else None
        if height:
            opts["format"] = (
                f"bestvideo[height<={height}][ext=mp4]+bestaudio[ext=m4a]/"
                f"bestvideo[height<={height}]+bestaudio/best[height<={height}]/best"
            )
        else:
            opts["format"] = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best"
        opts["merge_output_format"] = "mp4"
        # merge_output_format only applies when yt-dlp actually merges two
        # streams. A fallback can still land on an already-muxed non-mp4
        # source (seen with archive.org's original AVI masters), so remux
        # unconditionally to guarantee "Video (MP4)" always yields an mp4.
        opts["postprocessors"] = [{"key": "FFmpegVideoRemuxer", "preferedformat": "mp4"}]
    return opts


def download_one(url: str, mode: str, quality: str, dest_dir: str, browser: str | None = None) -> Path:
    outtmpl = os.path.join(dest_dir, "%(title).100s.%(ext)s")
    with yt_dlp.YoutubeDL(build_ydl_opts(outtmpl, mode, quality, browser)) as ydl:
        ydl.download([url])
    # yt-dlp normalizes the requested title into the final filename, so
    # re-derive it from disk rather than guessing the exact extension.
    files = [p for p in Path(dest_dir).iterdir() if p.is_file()]
    if not files:
        raise RuntimeError("Download produced no file")
    return max(files, key=lambda p: p.stat().st_mtime)


@app.get("/api/diag")
def diag():
    """No secrets here - just enough to tell if cookies/node made it into this
    deployment, since there's no shell access to check a Render container directly."""
    node = shutil.which("node")
    return jsonify({
        "cookies_file_configured": os.environ.get("YTDLP_COOKIES_FILE") or "cookies.txt (default)",
        "cookies_file_found": bool(COOKIES_FILE),
        "cookies_file_size_bytes": os.path.getsize(COOKIES_FILE) if COOKIES_FILE else None,
        "node_found": bool(node),
        "node_path": node,
        "ffmpeg_found": bool(FFMPEG_LOCATION),
        "yt_dlp_version": yt_dlp.version.__version__,
    })


@app.get("/")
def index():
    return render_template("index.html")


@app.post("/api/info")
def api_info():
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    browser = data.get("browser") or None
    if not url:
        return jsonify(ok=False, error="No URL provided"), 400

    extractor_name = match_extractor(url)
    if extractor_name in BROKEN_EXTRACTORS:
        return jsonify(broken_site_response(extractor_name)), 503

    try:
        return jsonify(probe(url, browser))
    except Exception as exc:
        return jsonify(ok=False, error=clean_error(exc)), 422


@app.post("/api/download")
def api_download():
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    mode = data.get("mode", "mp4")
    quality = str(data.get("quality", "best"))
    browser = data.get("browser") or None
    if not url:
        return jsonify(ok=False, error="No URL provided"), 400

    extractor_name = match_extractor(url)
    if extractor_name in BROKEN_EXTRACTORS:
        return jsonify(broken_site_response(extractor_name)), 503

    tmpdir = tempfile.mkdtemp(prefix="videosavior_")
    try:
        filepath = download_one(url, mode, quality, tmpdir, browser)
    except Exception as exc:
        shutil.rmtree(tmpdir, ignore_errors=True)
        return jsonify(ok=False, error=clean_error(exc)), 422

    @after_this_request
    def cleanup(response):
        shutil.rmtree(tmpdir, ignore_errors=True)
        return response

    return send_file(filepath, as_attachment=True, download_name=filepath.name)


@app.post("/api/download/bulk")
def api_download_bulk():
    data = request.get_json(silent=True) or {}
    urls = list(dict.fromkeys(u.strip() for u in data.get("urls", []) if u.strip()))
    mode = data.get("mode", "mp4")
    quality = str(data.get("quality", "best"))
    browser = data.get("browser") or None
    if not urls:
        return jsonify(ok=False, error="No URLs provided"), 400
    if len(urls) > MAX_BULK_ITEMS:
        return jsonify(ok=False, error=f"Bulk zip is capped at {MAX_BULK_ITEMS} items at once — split into smaller batches."), 400

    tmpdir = tempfile.mkdtemp(prefix="videosavior_bulk_")
    files, errors = [], []
    for url in urls:
        extractor_name = match_extractor(url)
        if extractor_name in BROKEN_EXTRACTORS:
            errors.append(f"{url} -> {broken_site_response(extractor_name)['error']}")
            continue
        try:
            files.append(download_one(url, mode, quality, tmpdir, browser))
        except Exception as exc:
            errors.append(f"{url} -> {clean_error(exc)}")

    if not files:
        shutil.rmtree(tmpdir, ignore_errors=True)
        return jsonify(ok=False, error="All downloads failed", details=errors), 422

    zip_path = os.path.join(tempfile.gettempdir(), f"videosavior-{uuid.uuid4().hex[:8]}.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            zf.write(f, arcname=f.name)
        if errors:
            zf.writestr("failed_urls.txt", "\n".join(errors))
    shutil.rmtree(tmpdir, ignore_errors=True)

    @after_this_request
    def cleanup(response):
        try:
            os.remove(zip_path)
        except OSError:
            pass
        return response

    return send_file(zip_path, as_attachment=True, download_name="videosavior-clips.zip")


if __name__ == "__main__":
    # use_reloader=False: the reloader restarts the whole process on any watched
    # file change, which aborts in-flight downloads. Downloads can run for minutes,
    # so this app can't tolerate that mid-request.
    # threaded=True: downloads can run for minutes, so a second request (e.g. a
    # health check or another download) must not block behind one in flight.
    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 5050)),
        debug=os.environ.get("FLASK_DEBUG") == "1",
        use_reloader=False,
        threaded=True,
    )
