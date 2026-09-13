# YouTube 转写文稿时间文本提取器（get_panel 修正版）

这是针对 2026 年 YouTube 转写接口变化重做的 Tampermonkey / Violentmonkey 用户脚本。

## 为什么要改

旧版脚本从 `captionTracks[].baseUrl` 直接请求：

`/api/timedtext?...&fmt=json3`

在部分当前 YouTube 页面上会出现：

- 能识别到字幕轨；
- 请求状态是 HTTP 200；
- 但响应体为空；
- 随后 `Response.json()` 报 `Unexpected end of JSON input`。

这不是“视频没有字幕”。

YouTube 自己打开“显示文字记录”时，现在会调用：

`POST /youtubei/v1/get_panel?prettyPrint=false`

并使用：

- `panelId: PAmodern_transcript_view`
- `params`: `AA 09 0F 0A 0B + 11 字节 videoId + 18 02` 的 base64url
- 当前页面的 `INNERTUBE_CONTEXT`

返回数据中包含 `transcriptSegmentViewModel`。

## 本版行为

- 不再依赖 `timedtext`。
- 直接使用 YouTube 当前原生 transcript panel 接口。
- 提取格式：`时间 文本`。
- 支持：
  - `/watch?v=...`
  - `/live/...`
  - `/shorts/...`
  - YouTube SPA 站内切换视频
- 自动提取。
- 支持重新提取、复制、下载 TXT。
- 对新格式 `transcriptSegmentViewModel` 和旧格式 `transcriptSegmentRenderer` 都保留解析。
- 同一时间戳、同一文本的连续重复段会去重。
- `get_panel` 遇到 401 时会尝试双 SAPISID auth 重试。

## 安装

1. 安装 Tampermonkey 或 Violentmonkey。
2. 新建用户脚本。
3. 将 `youtube-transcript-fast.user.js` 全部内容粘贴进去并保存。
4. 打开任意有转写的 YouTube 视频页。

右下角会出现“YouTube 转写提取”面板。

## 本次 HAR 验证

测试视频：

`q_r1MNPAnKg`

HAR 中：

- `timedtext` 请求出现 3 次；
- 三次均为 HTTP 200；
- 三次响应体均为 0 字节；
- YouTube 自己随后请求 `youtubei/v1/get_panel`；
- 该响应约 950 KB；
- 解析得到 828 个 `transcriptSegmentViewModel`；
- 第一批内容为：
  - `0:31 て`
  - `2:40 はい、皆さんこんばんは。`
  - `2:45 ソニーmusicB所属のおこもりのん です。 よろしくお願いします。`

因此这次修复的核心不是给空 `timedtext` 加 JSON 容错，而是把字幕来源切换到当前 YouTube 正在使用的原生 transcript panel。

## 注意

HAR 往往包含登录态请求头、Authorization、Cookie 或其他会话信息。本仓库不会提交原始 HAR。
