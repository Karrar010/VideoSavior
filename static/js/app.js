(() => {
  "use strict";

  const urlInput = document.getElementById("url-input");
  const addBtn = document.getElementById("add-btn");
  const qualitySelect = document.getElementById("quality-select");
  const browserSelect = document.getElementById("browser-select");
  const queueList = document.getElementById("queue-list");
  const emptyState = document.getElementById("empty-state");
  const downloadAllBtn = document.getElementById("download-all-btn");
  const clearQueueBtn = document.getElementById("clear-queue-btn");
  const itemTemplate = document.getElementById("queue-item-template");
  const themeToggle = document.getElementById("theme-toggle");
  const siteSearch = document.getElementById("site-search");
  const siteResults = document.getElementById("site-results");
  const siteSearchCount = document.getElementById("site-search-count");
  const segmentedOptions = document.querySelectorAll(".segmented-option");

  /** @type {Map<string, {url: string, mode: string, quality: string, el: HTMLLIElement, info: object|null}>} */
  const queue = new Map();
  let mode = "mp4";
  const MAX_BULK_ITEMS = 15; // keep in sync with app.py's MAX_BULK_ITEMS

  // ---------- Theme ----------
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
    themeToggle.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
  }

  (function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem("videosavior-theme"); } catch { /* private mode */ }
    const preferred = saved || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    applyTheme(preferred);
  })();

  themeToggle.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
    try { localStorage.setItem("videosavior-theme", next); } catch { /* ignore */ }
  });

  // ---------- Guided help: hover/focus a control to see a callout with a curved connector ----------
  const GUIDE_TEXT = {
    "url-input": "Paste one link, or several — one per line. Duplicates are removed automatically.",
    "format-toggle": "MP4 pulls video. MP3 extracts audio only from the same link.",
    "quality-select": "Resolution or bitrate. Options fill in once a link resolves below.",
    "browser-select": "Only needed if a site blocks anonymous downloads (usually YouTube's bot-check). Reads cookies from a browser already logged in on this machine — nothing leaves it.",
    "add-btn": "Fetches a title and thumbnail preview first, before anything actually downloads.",
    "download-all-btn": "Bundles every ready item into one zip. On mobile, a large batch can be memory-heavy — downloading big items one at a time is more reliable there.",
    "site-search": "Search all 1,379 supported sites — flags ones with a known upstream issue before you try them.",
  };

  const guideToggle = document.getElementById("guide-toggle");
  const guideTargets = document.querySelectorAll("[data-guide]");
  let guideMode = false;
  let calloutEl = null;
  let connectorSvg = null;

  function setGuideMode(on) {
    guideMode = on;
    document.body.classList.toggle("guide-mode", on);
    guideToggle.setAttribute("aria-pressed", String(on));
    try { localStorage.setItem("videosavior-guide", on ? "1" : "0"); } catch { /* ignore */ }
    hideCallout(); // always clear any callout left open from before the toggle
  }

  guideToggle.addEventListener("click", () => setGuideMode(!guideMode));
  // Belt-and-suspenders: any click elsewhere should never leave a callout stuck onscreen.
  document.addEventListener("click", (e) => {
    if (e.target !== guideToggle && !guideToggle.contains(e.target)) hideCallout();
  });

  (function initGuide() {
    let saved = null;
    try { saved = localStorage.getItem("videosavior-guide"); } catch { /* private mode */ }
    setGuideMode(saved === null ? true : saved === "1");
  })();

  function ensureGuideOverlay() {
    if (calloutEl) return;
    calloutEl = document.createElement("div");
    calloutEl.className = "guide-callout";
    calloutEl.hidden = true;
    document.body.appendChild(calloutEl);

    connectorSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    connectorSvg.setAttribute("class", "guide-connector");
    connectorSvg.hidden = true;
    connectorSvg.innerHTML =
      '<defs><marker id="guide-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
      '<path d="M0,0 L10,5 L0,10 Z"></path></marker></defs>' +
      '<path class="guide-line" marker-end="url(#guide-arrow)"></path>';
    document.body.appendChild(connectorSvg);
  }

  function showCalloutFor(target) {
    const text = GUIDE_TEXT[target.dataset.guide];
    if (!text) return;
    ensureGuideOverlay();
    calloutEl.textContent = text;
    calloutEl.hidden = false;
    connectorSvg.hidden = false;

    const targetRect = target.getBoundingClientRect();
    const margin = 14;

    // Measure natural size off-screen before placing it for real.
    calloutEl.style.left = "-9999px";
    calloutEl.style.top = "0px";
    const calloutRect = calloutEl.getBoundingClientRect();

    const placeAbove = targetRect.top > calloutRect.height + margin + 10;
    let calloutX = targetRect.left + targetRect.width / 2 - calloutRect.width / 2;
    calloutX = Math.max(12, Math.min(calloutX, window.innerWidth - calloutRect.width - 12));
    const calloutY = placeAbove
      ? targetRect.top - calloutRect.height - margin
      : targetRect.bottom + margin;

    calloutEl.style.left = `${calloutX}px`;
    calloutEl.style.top = `${calloutY}px`;

    const startX = calloutX + calloutRect.width / 2;
    const startY = placeAbove ? calloutY + calloutRect.height : calloutY;
    const endX = targetRect.left + targetRect.width / 2;
    const endY = placeAbove ? targetRect.top - 6 : targetRect.bottom + 6;
    const midY = (startY + endY) / 2;
    const wiggle = 18 * (startX <= endX ? 1 : -1);

    connectorSvg.querySelector(".guide-line").setAttribute(
      "d",
      `M ${startX},${startY} C ${startX + wiggle},${midY} ${endX - wiggle},${midY} ${endX},${endY}`
    );
  }

  function hideCallout() {
    if (calloutEl) calloutEl.hidden = true;
    if (connectorSvg) connectorSvg.hidden = true;
  }

  guideTargets.forEach((el) => {
    const show = () => { if (guideMode) showCalloutFor(el); };
    el.addEventListener("mouseenter", show);
    el.addEventListener("focus", show, true);
    el.addEventListener("mouseleave", hideCallout);
    el.addEventListener("blur", hideCallout, true);
  });

  window.addEventListener("resize", hideCallout);
  window.addEventListener("scroll", hideCallout, true);

  // ---------- Format toggle ----------
  segmentedOptions.forEach((btn) => {
    btn.addEventListener("click", () => {
      segmentedOptions.forEach((b) => {
        b.classList.remove("is-active");
        b.setAttribute("aria-checked", "false");
      });
      btn.classList.add("is-active");
      btn.setAttribute("aria-checked", "true");
      mode = btn.dataset.mode;
      qualitySelect.innerHTML =
        mode === "mp3"
          ? '<option value="192">192 kbps</option><option value="320">320 kbps</option><option value="128">128 kbps</option>'
          : '<option value="best">Best available</option>';
    });
  });

  // ---------- Queue helpers ----------
  function updateEmptyState() {
    emptyState.hidden = queue.size > 0;
    downloadAllBtn.hidden = queue.size === 0;
    clearQueueBtn.hidden = queue.size === 0;
  }

  clearQueueBtn.addEventListener("click", () => {
    queue.clear();
    queueList.innerHTML = "";
    updateEmptyState();
  });

  function formatDuration(seconds) {
    if (!seconds) return "";
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function setStatus(entry, state, label) {
    const statusEl = entry.el.querySelector(".queue-status");
    statusEl.dataset.state = state;
    statusEl.textContent = label;
  }

  async function addUrl(rawUrl) {
    const url = rawUrl.trim();
    if (!url || queue.has(url)) return;

    const node = itemTemplate.content.firstElementChild.cloneNode(true);
    queueList.appendChild(node);
    const entry = { url, mode, quality: qualitySelect.value, browser: browserSelect.value, el: node, info: null };
    queue.set(url, entry);
    updateEmptyState();

    node.querySelector(".queue-title").textContent = url;
    node.querySelector(".queue-meta").textContent = "Fetching details…";
    setStatus(entry, "loading", "Loading");

    node.querySelector(".remove-btn").addEventListener("click", () => {
      queue.delete(url);
      node.remove();
      updateEmptyState();
    });

    node.querySelector(".download-btn").addEventListener("click", () => downloadSingle(entry));

    try {
      const res = await fetch("/api/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, browser: entry.browser }),
      });
      const data = await res.json();
      if (data.broken) {
        node.querySelector(".queue-meta").textContent = data.error;
        node.querySelector(".download-btn").disabled = true;
        setStatus(entry, "broken", "Known issue");
        return;
      }
      if (!data.ok) throw new Error(data.error || "Could not read that link");

      entry.info = data;
      node.querySelector(".queue-title").textContent = data.title;
      node.querySelector(".queue-meta").textContent = [data.uploader, formatDuration(data.duration), data.extractor]
        .filter(Boolean)
        .join(" · ");
      if (data.thumbnail) node.querySelector(".queue-thumb").src = data.thumbnail;
      setStatus(entry, "ready", "Ready");
    } catch (err) {
      node.querySelector(".queue-meta").textContent = err.message;
      setStatus(entry, "error", "Failed");
    }
  }

  function setButtonLoading(btn, loading, loadingText) {
    btn.disabled = loading;
    btn.querySelector(".spinner").hidden = !loading;
    const label = btn.querySelector(".btn-text");
    if (loading) {
      label.dataset.restoreText = label.dataset.restoreText || label.textContent;
      label.textContent = loadingText;
    } else if (label.dataset.restoreText) {
      label.textContent = label.dataset.restoreText;
    }
  }

  // Confirms success directly on the button (not just the separate status
  // column, which is easy to miss) before it reverts to a normal, clickable
  // "Download" a couple seconds later.
  function flashButtonSuccess(btn, text) {
    const label = btn.querySelector(".btn-text");
    const original = label.dataset.restoreText || label.textContent;
    label.textContent = text;
    btn.classList.add("btn-success-flash");
    setTimeout(() => {
      label.textContent = original;
      btn.classList.remove("btn-success-flash");
    }, 1800);
  }

  async function downloadSingle(entry) {
    const btn = entry.el.querySelector(".download-btn");
    setStatus(entry, "loading", "Downloading");
    setButtonLoading(btn, true, "Downloading…");
    try {
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: entry.url, mode: entry.mode, quality: entry.quality, browser: entry.browser }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setButtonLoading(btn, false);
        if (data.broken) {
          setStatus(entry, "broken", "Known issue");
          return;
        }
        throw new Error(data.error || "Download failed");
      }
      const blob = await res.blob();
      triggerBlobDownload(blob, filenameFromResponse(res) || "clip");
      setStatus(entry, "done", "Saved");
      setButtonLoading(btn, false);
      flashButtonSuccess(btn, "Saved ✓");
    } catch (err) {
      setStatus(entry, "error", err.message);
      setButtonLoading(btn, false);
    }
  }

  function filenameFromResponse(res) {
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^"]+)"?/);
    return match ? match[1] : null;
  }

  function triggerBlobDownload(blob, filename) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  }

  addBtn.addEventListener("click", () => {
    const lines = [...new Set(urlInput.value.split("\n").map((l) => l.trim()).filter(Boolean))];
    lines.forEach(addUrl);
    urlInput.value = "";
    urlInput.focus();
  });

  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addBtn.click();
  });

  downloadAllBtn.addEventListener("click", async () => {
    // The zip endpoint applies one mode/quality to the whole batch, so only
    // bundle items that were queued under the format currently selected.
    const readyEntries = [...queue.values()].filter((e) => e.info && e.mode === mode);
    if (!readyEntries.length) return;
    if (readyEntries.length > MAX_BULK_ITEMS) {
      readyEntries.forEach((e) => setStatus(e, "error", `Zip is capped at ${MAX_BULK_ITEMS} items — split into smaller batches`));
      return;
    }
    setButtonLoading(downloadAllBtn, true, "Zipping…");
    readyEntries.forEach((e) => setStatus(e, "loading", "Zipping"));
    try {
      const res = await fetch("/api/download/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urls: readyEntries.map((e) => e.url),
          mode,
          quality: qualitySelect.value,
          browser: browserSelect.value,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Bulk download failed");
      }
      const blob = await res.blob();
      triggerBlobDownload(blob, "videosavior-clips.zip");
      readyEntries.forEach((e) => setStatus(e, "done", "Saved"));
      setButtonLoading(downloadAllBtn, false);
      flashButtonSuccess(downloadAllBtn, "Saved ✓");
    } catch (err) {
      readyEntries.forEach((e) => setStatus(e, "error", err.message));
      setButtonLoading(downloadAllBtn, false);
    }
  });

  // ---------- Supported-sites search ----------
  let sitesIndex = [];
  fetch("/static/sites.json")
    .then((r) => r.json())
    .then((data) => {
      sitesIndex = data;
      siteSearchCount.textContent = `${data.length.toLocaleString()} sites indexed.`;
    })
    .catch(() => {
      siteSearchCount.textContent = "Site index unavailable.";
    });

  siteSearch.addEventListener("input", () => {
    const q = siteSearch.value.trim().toLowerCase();
    siteResults.innerHTML = "";
    if (!q) return;
    const matches = sitesIndex.filter((s) => s.name.toLowerCase().includes(q) || (s.desc || "").toLowerCase().includes(q)).slice(0, 30);
    siteSearchCount.textContent = `${matches.length} match${matches.length === 1 ? "" : "es"} of ${sitesIndex.length.toLocaleString()}.`;
    matches.forEach((s) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = s.desc ? `${s.name} — ${s.desc}` : s.name;
      const type = document.createElement("span");
      type.className = s.broken ? "site-type site-broken" : "site-type";
      type.textContent = s.broken ? "⚠ known issue" : s.type;
      li.append(name, type);
      siteResults.appendChild(li);
    });
  });

  siteSearch.addEventListener("blur", () => {
    if (!siteSearch.value.trim()) siteSearchCount.textContent = `${sitesIndex.length.toLocaleString()} sites indexed.`;
  });
})();
