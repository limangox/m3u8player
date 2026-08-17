(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const video = $("video");
  const input = $("stream-url");
  const status = $("status");
  const statusDot = $("status-dot");
  const modeLabel = $("mode-label");
  const quality = $("quality");
  const goLive = $("go-live");
  const errorBox = $("error");
  const demo = $("demo");
  let hls = null;
  let activeUrl = "";
  let mode = "idle";
  const demoUrl = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";

  function formatRate(bits) {
    if (!bits || !Number.isFinite(bits)) return "—";
    return bits >= 1000000 ? `${(bits / 1000000).toFixed(1)} Mbps` : `${Math.round(bits / 1000)} Kbps`;
  }
  function setMode(next, text) {
    mode = next;
    status.textContent = text;
    statusDot.className = `status-dot ${next}`;
    modeLabel.textContent = next === "live" ? "LIVE" : next === "vod" ? "VOD" : next === "loading" ? "LOADING" : next === "error" ? "ERROR" : "READY";
    $("pulse").className = `pulse ${next === "live" ? "on" : ""}`;
    goLive.hidden = next !== "live";
    $("type").textContent = next === "live" ? "直播" : next === "vod" ? "点播" : "—";
    errorBox.hidden = next !== "error";
    if (next === "error") errorBox.textContent = text;
  }
  function destroy() {
    if (hls) hls.destroy();
    hls = null;
  }
  function tryPlay(autoplay) {
    if (autoplay) video.play().catch(() => setMode(mode === "live" ? "live" : "vod", "资源已就绪，点击播放即可开始"));
  }
  function fillQualities(levels) {
    quality.innerHTML = '<option value="-1">自动</option>';
    levels.forEach((level, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      const resolution = level.height ? `${level.height}p` : `线路 ${index + 1}`;
      const fps = level.frameRate > 30 ? ` ${Math.round(level.frameRate)}fps` : "";
      const rate = level.bitrate ? ` · ${formatRate(level.bitrate)}` : "";
      option.textContent = `${resolution}${fps}${rate}`;
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
    demo.hidden = true;
    $("share").disabled = false;
    errorBox.hidden = true;
    fillQualities([]);
    localStorage.setItem("m3u8-player:last-url", clean);
    setMode("loading", "正在读取播放列表…");
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = clean;
      video.addEventListener("loadedmetadata", () => {
        setMode(Number.isFinite(video.duration) ? "vod" : "live", Number.isFinite(video.duration) ? "点播资源已就绪" : "直播连接正常");
        tryPlay(autoplay);
      }, { once: true });
      video.addEventListener("error", () => setMode("error", "无法播放：请检查地址、格式和视频源的 CORS 设置"), { once: true });
      return;
    }
    if (!window.Hls || !Hls.isSupported()) return setMode("error", "当前浏览器不支持 HLS / MediaSource，请更换新版浏览器");
    hls = new Hls({ enableWorker:true, lowLatencyMode:true, backBufferLength:60, maxBufferLength:30, liveSyncDurationCount:3, liveMaxLatencyDurationCount:8, manifestLoadingMaxRetry:4, fragLoadingMaxRetry:5 });
    hls.attachMedia(video);
    hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(clean));
    hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => { fillQualities(hls.levels); status.textContent = `${data.levels.length || 1} 条可用线路 · 自动清晰度`; tryPlay(autoplay); });
    hls.on(Hls.Events.LEVEL_LOADED, (_, data) => setMode(data.details.live ? "live" : "vod", data.details.live ? "直播连接正常" : "点播资源已就绪"));
    hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => { quality.value = hls.autoLevelEnabled ? "-1" : String(data.level); });
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) { status.textContent = "网络读取失败，正在尝试重新连接…"; hls.startLoad(); }
      else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) { status.textContent = "媒体解码异常，正在自动恢复…"; hls.recoverMediaError(); }
      else { setMode("error", `播放失败：${data.details}`); hls.destroy(); }
    });
  }

  $("source-form").addEventListener("submit", (event) => { event.preventDefault(); load(input.value, true); });
  demo.addEventListener("click", () => load(demoUrl, true));
  quality.addEventListener("change", () => { if (hls) hls.currentLevel = Number(quality.value); });
  $("speed").addEventListener("change", (event) => { video.playbackRate = Number(event.target.value); });
  goLive.addEventListener("click", () => { if (hls && hls.liveSyncPosition != null) video.currentTime = hls.liveSyncPosition; else if (video.seekable.length) video.currentTime = video.seekable.end(video.seekable.length - 1); video.play(); });
  $("theater").addEventListener("click", (event) => { $("page").classList.toggle("theater"); event.target.textContent = $("page").classList.contains("theater") ? "退出影院" : "影院模式"; });
  $("share").addEventListener("click", async () => { const link = new URL(location.href); link.search = ""; link.searchParams.set("url", activeUrl); link.searchParams.set("title", $("page-title").textContent); try { await navigator.clipboard.writeText(link); status.textContent = "带播放地址的分享链接已复制"; } catch { status.textContent = "复制失败，请手动复制浏览器地址"; } });
  video.addEventListener("dblclick", () => video.requestFullscreen && video.requestFullscreen());
  window.addEventListener("keydown", (event) => { if (["INPUT","SELECT"].includes(event.target.tagName)) return; if (event.code === "Space") { event.preventDefault(); video.paused ? video.play() : video.pause(); } else if (event.key.toLowerCase() === "m") video.muted = !video.muted; else if (event.key === "ArrowLeft") video.currentTime = Math.max(0, video.currentTime - 5); else if (event.key === "ArrowRight") video.currentTime += 5; else if (event.key.toLowerCase() === "f" && video.requestFullscreen) video.requestFullscreen(); });
  setInterval(() => { const ranges = video.buffered; $("buffer").textContent = ranges.length ? `${Math.max(0, ranges.end(ranges.length - 1) - video.currentTime).toFixed(1)} s` : "—"; $("bandwidth").textContent = formatRate(hls ? hls.bandwidthEstimate : 0); $("latency").textContent = hls && Number.isFinite(hls.latency) ? `${hls.latency.toFixed(1)} s` : "—"; }, 1000);
  window.addEventListener("beforeunload", destroy);
  const params = new URLSearchParams(location.search);
  const customTitle = params.get("title");
  if (customTitle) { $("page-title").textContent = customTitle.slice(0, 80); document.title = `${customTitle} · M3U8 播放器`; }
  video.muted = params.get("muted") === "1";
  const initialUrl = params.get("url") || localStorage.getItem("m3u8-player:last-url");
  if (initialUrl) load(initialUrl, params.get("autoplay") === "1");
})();
