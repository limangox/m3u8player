# M3U8 自适应播放器

无需服务器和构建工具，可直接部署到 GitHub Pages。支持电脑、平板和手机，兼容直播与点播 HLS 流。

## 部署到 GitHub Pages

1. 新建 GitHub 仓库，将本目录内的全部文件上传到仓库根目录。
2. 打开仓库的 **Settings → Pages**。
3. 在 **Build and deployment** 中选择 **Deploy from a branch**。
4. Branch 选择 `main`，目录选择 `/ (root)`，保存后等待部署完成。

## 使用 URL 参数

```text
https://你的用户名.github.io/仓库名/?url=M3U8地址&title=频道名称&autoplay=1&muted=1
```

- `url`：需要播放的 M3U8 地址。
- `title`：页面显示名称，可省略。
- `autoplay=1`：尝试自动播放；浏览器通常要求同时静音。
- `muted=1`：初始静音。

## 视频源要求

- GitHub Pages 使用 HTTPS，因此 M3U8、分片、密钥和字幕也必须使用 HTTPS。
- 视频服务器需要正确返回 CORS 响应头，至少允许播放器页面所在域名访问。
- 本播放器不会代理、转存或破解视频，只负责播放浏览器本身有权访问的 HLS 资源。
- 带鉴权 Cookie、Referer 限制或自定义请求头的源通常不能直接从 GitHub Pages 播放，需要源站调整或你自己的授权后端。

## 功能

- Safari/iOS/iPadOS 使用系统原生 HLS，其余现代浏览器使用内置 HLS.js。
- 自动码率与手动清晰度选择。
- 自动识别直播/点播、直播追帧、倍速、全屏、影院模式。
- 网络错误和媒体解码错误自动恢复。
- URL 参数直达播放、分享链接、上次地址本机记忆。
