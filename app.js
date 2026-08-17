(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const page = $("page");
  const player = $("player-shell");
  const video = $("video");
  const input = $("stream-url");
  const statusDot = $("status-dot");
  const modeLabel = $("mode-label");
  const quality = $("quality");
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

  function fillQualities(levels) {
    quality.innerHTML = '<option value="-1">自动</option>';
    levels.forEach((level, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      const resolution = level.height ? `${level.height}p` : `线路 ${index + 1}`;
      const fps = level.frameRate > 30 ? ` ${Math.round(level.frameRate)}fps` : "";
      option.textContent = `${resolution}${fps}`;
      quality.append(option);
    });
    quality.disabled = levels.length < 2;
  }

  function load(source, autoplay = true) {
    const clean = source.trim();
    if (!clean) return;

    destroy();
    video.pause();
    video.removeAttribute("src");
    video.load();
    activeUrl = clean;
    input.value = clean;
    $("share").disabled = false;
    customControls.hidden = false;
    centerPlay.hidden = true;
    errorBox.hidden = true;
    fillQualities([]);
    localStorage.setItem("m3u8-player:last-url", clean);
    setMode("loading", "正在读取播放列表…");
    revealControls();

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
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
      fillQualities(hls.levels);
      tryPlay(autoplay);
    });
    hls.on(Hls.Events.LEVEL_LOADED, (_, data) => {
      setMode(data.details.live ? "live" : "vod");
    });
    hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
      quality.value = hls.autoLevelEnabled ? "-1" : String(data.level);
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
    video.paused ? video.play() : video.pause();
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
  quality.addEventListener("change", () => {
    if (hls) hls.currentLevel = Number(quality.value);
  });
  $("speed").addEventListener("change", (event) => {
    video.playbackRate = Number(event.target.value);
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
  const params = new URLSearchParams(location.search);
  const customTitle = params.get("title");
  if (customTitle) document.title = `${customTitle.slice(0,80)} · STREAMBOX`;
  video.muted = params.get("muted") === "1";
  const initialUrl = params.get("url") || localStorage.getItem("m3u8-player:last-url");
  if (initialUrl) load(initialUrl, params.get("autoplay") === "1");
})();
