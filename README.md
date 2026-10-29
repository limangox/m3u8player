# M3U8 / MPD 自适应播放器

无需服务器和构建工具，可直接部署到 GitHub Pages。支持电脑、平板和手机，兼容直播与点播 HLS、DASH 流，并支持 MPD ClearKey。

## 部署到 GitHub Pages

1. 新建 GitHub 仓库，将本目录内的全部文件上传到仓库根目录。
2. 打开仓库的 **Settings → Pages**。
3. 在 **Build and deployment** 中选择 **Deploy from a branch**。
4. Branch 选择 `main`，目录选择 `/ (root)`，保存后等待部署完成。

## 使用 URL 参数

```text
https://你的用户名.github.io/仓库名/?url=M3U8或MPD地址&title=频道名称&autoplay=1&muted=1
```

- `url`：需要播放的 M3U8 或 MPD 地址。
- `title`：页面显示名称，可省略。
- `autoplay=1`：尝试自动播放；浏览器通常要求同时静音。
- `muted=1`：初始静音。

## 视频源要求

- GitHub Pages 使用 HTTPS，因此 M3U8、MPD、分片、密钥和字幕也必须使用 HTTPS。
- 视频服务器需要正确返回 CORS 响应头，至少允许播放器页面所在域名访问。
- 本播放器不会代理、转存或破解视频，只负责播放浏览器本身有权访问的 HLS / DASH 资源。
- MPD ClearKey 使用 `KID:KEY`（32 位十六进制）格式；多组可用空格、换行、逗号或分号分隔。密钥只保存在当前页面内存中，不写入本地存储或分享链接。
- 标准 `Referer` 是浏览器禁止网页脚本自行修改的请求头。页面会默认显示与媒体地址相同的目标 Referer，但 GitHub Pages 纯静态版无法真正伪造跨站 Referer；强校验来源的媒体仍需自有代理后端。

## 功能

- Safari/iOS/iPadOS 使用系统原生 HLS，其余现代浏览器使用内置 HLS.js；MPD 使用内置 Shaka Player。
- 自动码率与手动清晰度选择；主播放列表会列出全部档位，单路播放列表会显示实际视频分辨率。
- 自动识别直播/点播、直播追帧、磨砂清晰度/倍速菜单、网页全屏和浏览器全屏。
- 网络错误和媒体解码错误自动恢复。
- URL 参数可一次性直达播放、分享链接；播放器不保存地址，刷新页面即重置。
