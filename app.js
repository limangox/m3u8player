(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const page = $("page");
  const player = $("player-shell");
  const video = $("video");
  const input = $("stream-url");
  const statusDot = $("status-dot");
  const modeLabel = $("mode-label");
  const qualityTrigger = $("quality-trigger");
  const qualityMenu = $("quality-menu");
  const speedTrigger = $("speed-trigger");
  const speedMenu = $("speed-menu");
  const progress = $("progress");
  const progressWrap = $("progress-wrap");
  const timeLabel = $("time-label");
  const goLiveButton = $("go-live");
  const centerPlay = $("center-play");
  const playToggle = $("play-toggle");
  const loading = $("loading");
  const errorBox = $("error");
  const customControls = $("custom-controls");
  const webFullscreenButton = $("web-fullscreen");
  const fullscreenButton = $("fullscreen");

  let hls = null;
  let activeUrl = "";
  let mode = "idle";
  let hideControlsTimer = 0;
  let webFullscreen = false;
  let qualityValue = "-1";
  let masterUrl = "";
  let parsedQualities = [];
  let forcedVariant = false;
  let manifestAbort = null;

  function formatRate(bits) {
    if (!bits || !Number.isFinite(bits)) return "—";
    return bits >= 1000000
      ? `${(bits / 1000000).toFixed(1)} Mbps`
      : `${Math.round(bits / 1000)} Kbps`;
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return hours
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
      : `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function shouldUseNativeHls() {
    if (!video.canPlayType("application/vnd.apple.mpegurl")) return false;
    const userAgent = navigator.userAgent;
    const appleMobile = /iPad|iPhone|iPod/i.test(userAgent)
      || (/Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1);
    const safari = /Safari/i.test(userAgent)
      && !/Chrome|Chromium|CriOS|Edg|EdgiOS|OPR|Firefox|FxiOS/i.test(userAgent);
    const hlsJsSupported = Boolean(window.Hls && Hls.isSupported());
    return appleMobile || safari || !hlsJsSupported;
  }

  function parseAttributes(line) {
    const attributes = {};
    const expression = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
    let match;
    while ((match = expression.exec(line))) {
      attributes[match[1].toUpperCase()] = match[2].replace(/^"|"$/g, "");
    }
    return attributes;
  }

  function parseMasterPlaylist(text, sourceUrl) {
    const lines = text.split(/\r?\n/).map((line) => line.trim());
    const variants = [];
    lines.forEach((line, lineIndex) => {
      if (!line.startsWith("#EXT-X-STREAM-INF:")) return;
      const attributes = parseAttributes(line.slice(line.indexOf(":") + 1));
      const uri = lines.slice(lineIndex + 1).find((entry) => entry && !entry.startsWith("#"));
      if (!uri) return;
      const [width = 0, height = 0] = (attributes.RESOLUTION || "0x0")
        .split("x").map((value) => Number(value) || 0);
      variants.push({
        index: variants.length,
        url: new URL(uri, sourceUrl).href,
        width,
        height,
        bandwidth: Number(attributes.AVERAGE_BANDWIDTH || attributes.BANDWIDTH) || 0,
        frameRate: Number(attributes["FRAME-RATE"]) || 0
      });
    });
    return variants;
  }

  function qualityLabel(level, index) {
    const resolution = level.height ? `${level.height}p` : `线路 ${index + 1}`;
    const fps = level.frameRate > 30 ? ` ${Math.round(level.frameRate)}fps` : "";
    const bits = level.bandwidth || level.bitrate || 0;
    const bitrate = bits >= 1000000
      ? ` · ${(bits / 1000000).toFixed(bits % 1000000 ? 1 : 0)} Mbps`
      : bits ? ` · ${Math.round(bits / 1000)} Kbps` : "";
    return `${resolution}${fps}${bitrate}`;
  }

  function normalizeQualities(levels) {
    return levels.map((level, position) => ({
      ...level,
      index: Number.isInteger(level.index) ? level.index : position,
      label: qualityLabel(level, position)
    })).sort((left, right) =>
      (right.height || 0) - (left.height || 0)
      || (right.bandwidth || right.bitrate || 0) - (left.bandwidth || left.bitrate || 0)
    );
  }

  function setMode(next, text) {
    mode = next;
    statusDot.className = `status-dot ${next}`;
    modeLabel.textContent =
      next === "live" ? "LIVE" :
      next === "vod" ? "VOD" :
      next === "loading" ? "LOADING" :
      next === "error" ? "ERROR" : "READY";
    $("type").textContent = next === "live" ? "直播" : next === "vod" ? "点播" : "—";
    goLiveButton.hidden = next !== "live";
    progressWrap.classList.toggle("is-live", next === "live");
    progress.disabled = next === "live";
    loading.hidden = next !== "loading";
    errorBox.hidden = next !== "error";
    if (next === "error") errorBox.textContent = text;
    syncPlayUi();
  }

  function destroy() {
    if (manifestAbort) manifestAbort.abort();
    manifestAbort = null;
    if (hls) hls.destroy();
    hls = null;
  }

  function revealControls() {
    window.clearTimeout(hideControlsTimer);
    player.classList.remove("controls-hidden");
    player.classList.add("controls-visible");
    if (!video.paused) {
      hideControlsTimer = window.setTimeout(() => {
        player.classList.remove("controls-visible");
        player.classList.add("controls-hidden");
      }, 2600);
    }
  }

  function syncPlayUi() {
    const playing = !video.paused;
    playToggle.textContent = playing ? "❚❚" : "▶";
    playToggle.setAttribute("aria-label", playing ? "暂停" : "播放");
    centerPlay.hidden = !activeUrl || playing || mode === "loading" || mode === "error";
  }

  function tryPlay(autoplay) {
    if (!autoplay) {
      syncPlayUi();
      return;
    }
    video.play().catch(() => {
      syncPlayUi();
      revealControls();
    });
  }

  function closeMenus(except) {
    [[qualityTrigger, qualityMenu], [speedTrigger, speedMenu]].forEach(([trigger, menu]) => {
      if (menu === except) return;
      menu.hidden = true;
      trigger.classList.remove("active");
      trigger.setAttribute("aria-expanded", "false");
    });
  }

  function toggleMenu(trigger, menu) {
    const willOpen = menu.hidden;
    closeMenus(menu);
    menu.hidden = !willOpen;
    trigger.classList.toggle("active", willOpen);
    trigger.setAttribute("aria-expanded", String(willOpen));
  }

  function makeMenuItem(value, label, selected, onSelect) {
    const button = document.createElement("button");
    button.className = selected ? "menu-item selected" : "menu-item";
    button.type = "button";
    button.setAttribute("role", "menuitemradio");
    button.setAttribute("aria-checked", String(selected));
    button.dataset.value = value;
    const text = document.createElement("span");
    text.textContent = label;
    const check = document.createElement("span");
    check.className = "menu-check";
    check.setAttribute("aria-hidden", "true");
    check.textContent = "✓";
    button.append(text, check);
    button.addEventListener("click", () => onSelect(value, label));
    return button;
  }

  function selectQuality(value, label) {
    qualityValue = value;
    qualityTrigger.firstChild.textContent = label;
    qualityMenu.querySelectorAll(".menu-item").forEach((item) => {
      const selected = item.dataset.value === value;
      item.classList.toggle("selected", selected);
      item.setAttribute("aria-checked", String(selected));
    });
    const selectedValue = Number(value);
    const selected = parsedQualities.find((item) => item.index === selectedValue);
    if (hls) {
      if (selectedValue === -1) {
        if (forcedVariant) {
          forcedVariant = false;
          hls.loadSource(masterUrl);
        } else {
          hls.currentLevel = -1;
        }
      } else if (!forcedVariant && selectedValue < hls.levels.length) {
        hls.currentLevel = selectedValue;
      } else if (selected?.url) {
        forcedVariant = true;
        hls.loadSource(selected.url);
      }
    } else {
      const source = selectedValue === -1 ? masterUrl : selected?.url;
      if (source) {
        const wasPlaying = !video.paused;
        const previousTime = video.currentTime;
        const wasLive = mode === "live";
        video.src = source;
        video.addEventListener("loadedmetadata", () => {
          if (!wasLive && Number.isFinite(previousTime)) video.currentTime = previousTime;
          if (wasPlaying) video.play().catch(revealControls);
        }, { once:true });
      }
    }
    closeMenus();
  }

  function fillQualities(levels) {
    const normalized = normalizeQualities(levels);
    const availableValues = normalized.map((item) => String(item.index));
    if (qualityValue !== "-1" && !availableValues.includes(qualityValue)) qualityValue = "-1";
    qualityMenu.replaceChildren();
    qualityMenu.append(makeMenuItem("-1", "自动", qualityValue === "-1", selectQuality));
    normalized.forEach((level) => {
      qualityMenu.append(makeMenuItem(String(level.index), level.label, qualityValue === String(level.index), selectQuality));
    });
    const selected = qualityMenu.querySelector(`[data-value="${qualityValue}"] span`);
    qualityTrigger.firstChild.textContent = selected?.textContent || "自动";
    qualityTrigger.disabled = normalized.length === 0;
  }

  function revealDetectedResolution() {
    if (!video.videoHeight || qualityMenu.querySelectorAll(".menu-item").length > 1) return;
    qualityMenu.append(makeMenuItem("-2", `${video.videoHeight}p（当前源）`, false, selectQuality));
    qualityTrigger.disabled = false;
  }

  function buildSpeedMenu() {
    speedMenu.replaceChildren();
    ["0.5", "0.75", "1", "1.25", "1.5", "2"].forEach((value) => {
      speedMenu.append(makeMenuItem(value, `${value}×`, value === "1", (next, label) => {
        video.playbackRate = Number(next);
        speedTrigger.firstChild.textContent = label;
        speedMenu.querySelectorAll(".menu-item").forEach((item) => {
          const selected = item.dataset.value === next;
          item.classList.toggle("selected", selected);
          item.setAttribute("aria-checked", String(selected));
        });
        closeMenus();
      }));
    });
  }

  function load(source, autoplay = true) {
    const clean = source.trim();
    if (!clean) return;

    destroy();
    video.pause();
    video.removeAttribute("src");
    video.load();
    activeUrl = clean;
    masterUrl = clean;
    parsedQualities = [];
    forcedVariant = false;
    input.value = clean;
    $("share").disabled = false;
    customControls.hidden = false;
    centerPlay.hidden = true;
    errorBox.hidden = true;
    qualityValue = "-1";
    fillQualities([]);
    setMode("loading", "正在读取播放列表…");
    revealControls();

    manifestAbort = new AbortController();
    fetch(clean, { cache:"no-store", signal:manifestAbort.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((manifest) => {
        parsedQualities = normalizeQualities(parseMasterPlaylist(manifest, clean));
        if (parsedQualities.length > Math.max(0, qualityMenu.children.length - 1)) {
          fillQualities(parsedQualities);
        }
      })
      .catch((error) => {
        if (error.name !== "AbortError") parsedQualities = [];
      });

    if (shouldUseNativeHls()) {
      video.src = clean;
      video.addEventListener("loadedmetadata", () => {
        setMode(Number.isFinite(video.duration) ? "vod" : "live");
        tryPlay(autoplay);
      }, { once:true });
      video.addEventListener("error", () => {
        setMode("error", "无法播放：请检查地址、格式和视频源的 CORS 设置");
      }, { once:true });
      return;
    }

    if (!window.Hls || !Hls.isSupported()) {
      setMode("error", "当前浏览器不支持 HLS / MediaSource，请更换新版浏览器");
      return;
    }

    hls = new Hls({
      enableWorker:true,
      lowLatencyMode:true,
      backBufferLength:60,
      maxBufferLength:30,
      liveSyncDurationCount:3,
      liveMaxLatencyDurationCount:8,
      manifestLoadingMaxRetry:4,
      fragLoadingMaxRetry:5
    });

    hls.attachMedia(video);
    hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(clean));
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      fillQualities(parsedQualities.length > hls.levels.length ? parsedQualities : hls.levels);
      tryPlay(autoplay);
    });
    hls.on(Hls.Events.LEVELS_UPDATED, () => {
      if (!forcedVariant) fillQualities(parsedQualities.length > hls.levels.length ? parsedQualities : hls.levels);
    });
    hls.on(Hls.Events.LEVEL_LOADED, (_, data) => {
      setMode(data.details.live ? "live" : "vod");
    });
    hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
      if (hls.autoLevelEnabled) {
        qualityValue = "-1";
        qualityTrigger.firstChild.textContent = "自动";
      } else {
        const item = qualityMenu.querySelector(`[data-value="${data.level}"]`);
        if (item) {
          qualityValue = String(data.level);
          qualityTrigger.firstChild.textContent = item.querySelector("span").textContent;
        }
      }
      qualityMenu.querySelectorAll(".menu-item").forEach((item) => {
        const selected = item.dataset.value === qualityValue;
        item.classList.toggle("selected", selected);
        item.setAttribute("aria-checked", String(selected));
      });
    });
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        hls.startLoad();
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError();
      } else {
        setMode("error", `播放失败：${data.details}`);
        hls.destroy();
      }
    });
  }

  function togglePlay() {
    if (!activeUrl) return;
    if (video.paused) video.play();
    else video.pause();
    revealControls();
  }

  function goLive() {
    if (hls && hls.liveSyncPosition != null) {
      video.currentTime = hls.liveSyncPosition;
    } else if (video.seekable.length) {
      video.currentTime = video.seekable.end(video.seekable.length - 1);
    }
    video.play();
  }

  function toggleWebFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    webFullscreen = !webFullscreen;
    page.classList.toggle("web-fullscreen", webFullscreen);
    document.body.style.overflow = webFullscreen ? "hidden" : "";
    webFullscreenButton.classList.toggle("active", webFullscreen);
    webFullscreenButton.textContent = webFullscreen ? "退出网页全屏" : "网页全屏";
    webFullscreenButton.setAttribute("aria-label", webFullscreen ? "退出网页全屏" : "网页全屏");
    revealControls();
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        if (webFullscreen) toggleWebFullscreen();
        await player.requestFullscreen();
      }
    } catch {
      if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
    }
  }

  $("source-form").addEventListener("submit", (event) => {
    event.preventDefault();
    load(input.value, true);
  });
  playToggle.addEventListener("click", togglePlay);
  centerPlay.addEventListener("click", togglePlay);
  video.addEventListener("click", togglePlay);
  video.addEventListener("dblclick", toggleFullscreen);
  video.addEventListener("play", () => { syncPlayUi(); revealControls(); });
  video.addEventListener("pause", () => { syncPlayUi(); revealControls(); });
  video.addEventListener("loadedmetadata", revealDetectedResolution);
  video.addEventListener("resize", revealDetectedResolution);
  video.addEventListener("timeupdate", () => {
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    progress.max = String(duration || 1);
    progress.value = String(mode === "live" ? 1 : Math.min(video.currentTime, duration || 1));
    progress.style.setProperty("--progress", `${mode === "live" ? 100 : duration ? (video.currentTime / duration) * 100 : 0}%`);
    timeLabel.textContent = mode === "live"
      ? "直播中"
      : `${formatTime(video.currentTime)} / ${formatTime(duration)}`;
  });
  progress.addEventListener("input", () => {
    if (mode !== "live") video.currentTime = Number(progress.value);
  });
  qualityTrigger.addEventListener("click", () => toggleMenu(qualityTrigger, qualityMenu));
  speedTrigger.addEventListener("click", () => toggleMenu(speedTrigger, speedMenu));
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".control-menu")) closeMenus();
  });
  $("mute").addEventListener("click", () => {
    video.muted = !video.muted;
  });
  $("volume").addEventListener("input", (event) => {
    video.volume = Number(event.target.value);
    video.muted = video.volume === 0;
  });
  video.addEventListener("volumechange", () => {
    $("volume").value = video.muted ? "0" : String(video.volume);
    $("mute").textContent = video.muted || video.volume === 0 ? "🔇" : video.volume < .5 ? "🔉" : "🔊";
  });
  goLiveButton.addEventListener("click", goLive);
  $("pip").addEventListener("click", async () => {
    if (!document.pictureInPictureEnabled || video.disablePictureInPicture) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {}
  });
  webFullscreenButton.addEventListener("click", toggleWebFullscreen);
  fullscreenButton.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", () => {
    const active = Boolean(document.fullscreenElement);
    fullscreenButton.classList.toggle("active", active);
    fullscreenButton.textContent = active ? "退出全屏" : "全屏";
    fullscreenButton.setAttribute("aria-label", active ? "退出全屏" : "全屏");
    revealControls();
  });
  player.addEventListener("mousemove", revealControls);
  player.addEventListener("mouseleave", () => {
    if (!video.paused) {
      player.classList.remove("controls-visible");
      player.classList.add("controls-hidden");
    }
  });
  player.addEventListener("touchstart", revealControls, { passive:true });
  customControls.addEventListener("click", (event) => event.stopPropagation());
  $("share").addEventListener("click", async () => {
    const link = new URL(location.href);
    link.search = "";
    link.searchParams.set("url", activeUrl);
    try { await navigator.clipboard.writeText(link); } catch {}
  });

  window.addEventListener("keydown", (event) => {
    if (["INPUT","SELECT"].includes(event.target.tagName) || !activeUrl) return;
    if (event.code === "Space") {
      event.preventDefault();
      togglePlay();
    } else if (event.key.toLowerCase() === "m") {
      video.muted = !video.muted;
    } else if (event.key === "ArrowLeft" && mode !== "live") {
      video.currentTime = Math.max(0, video.currentTime - 5);
    } else if (event.key === "ArrowRight" && mode !== "live") {
      video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 5);
    } else if (event.key === "Escape" && webFullscreen && !document.fullscreenElement) {
      toggleWebFullscreen();
    } else if (event.key.toLowerCase() === "f") {
      toggleFullscreen();
    }
    revealControls();
  });

  window.setInterval(() => {
    const ranges = video.buffered;
    $("buffer").textContent = ranges.length
      ? `${Math.max(0, ranges.end(ranges.length - 1) - video.currentTime).toFixed(1)} s`
      : "—";
    $("bandwidth").textContent = formatRate(hls ? hls.bandwidthEstimate : 0);
    $("latency").textContent = hls && Number.isFinite(hls.latency) ? `${hls.latency.toFixed(1)} s` : "—";
  }, 1000);

  window.addEventListener("beforeunload", destroy);
  buildSpeedMenu();
  localStorage.removeItem("m3u8-player:last-url");
  const params = new URLSearchParams(location.search);
  const customTitle = params.get("title");
  if (customTitle) document.title = `${customTitle.slice(0,80)} · STREAMBOX`;
  video.muted = params.get("muted") === "1";
  const initialUrl = params.get("url");
  const initialAutoplay = params.get("autoplay") === "1";
  if (initialUrl) {
    params.delete("url");
    params.delete("autoplay");
    params.delete("muted");
    const query = params.toString();
    history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
  }
  if (initialUrl) load(initialUrl, initialAutoplay);
})();
