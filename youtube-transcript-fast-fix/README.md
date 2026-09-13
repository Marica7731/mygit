# YouTube 转写文稿时间文本提取器（get_panel 修正版）

这是针对当前 YouTube 转写接口变化重做的 Tampermonkey / Violentmonkey 用户脚本。

## 2.1.0 行为

- 非视频页完全不显示控件。
- 视频页默认不弹字幕面板，只显示右下角两个小按钮：
  - `复制给 GPT`
  - `字幕`
- `复制给 GPT` 会按需抓取字幕，并一次性复制：
  - 视频标题
  - 频道名
  - 频道链接
  - 视频 ID
  - 标准 watch 链接
  - 日期（能取得时）
  - 时长（能取得时）
  - 播放量（能取得时）
  - 完整带时间戳字幕
  - 用于让 GPT 总结视频的提示词
- `字幕` 只有主动点击时才展开查看面板。
- 离开 `/watch`、`/live`、`/shorts` 视频页后，控件和面板会直接销毁。
- 字幕按视频 ID 缓存，重复复制无需反复请求。
- 支持 YouTube SPA 站内切换视频。

## 字幕接口

旧脚本依赖：

`/api/timedtext?...&fmt=json3`

在部分当前 YouTube 页面中会出现 HTTP 200 但响应体为空的情况。

本版改用 YouTube 自己“显示文字记录”正在使用的：

`POST /youtubei/v1/get_panel?prettyPrint=false`

其中：

- `panelId: PAmodern_transcript_view`
- `params` 根据当前 11 字节 videoId 构造
- 使用页面当前 `INNERTUBE_CONTEXT`

解析新格式 `transcriptSegmentViewModel`，同时兼容旧格式 `transcriptSegmentRenderer`。

## 安装

1. 安装 Tampermonkey 或 Violentmonkey。
2. 打开 `youtube-transcript-fast.user.js`。
3. 将完整脚本安装/覆盖旧版。
4. 打开 YouTube 视频页。

## HAR 验证

测试视频 `q_r1MNPAnKg` 中：

- `timedtext` 连续返回 HTTP 200 + 0 字节响应体；
- YouTube 自己随后请求 `youtubei/v1/get_panel`；
- 该响应包含完整 transcript 数据；
- 可解析出与页面“显示文字记录”一致的时间戳字幕。

因此修复核心是切换字幕数据源，而不是仅给空 `timedtext` 增加 JSON 容错。

## 安全

原始 HAR 可能包含 Authorization、Cookie 和其他登录态信息，不应提交到公开仓库。
