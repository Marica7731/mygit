# YouTube 歌枠 / 弾き語り排行静态页

这是部署到 GitHub Pages 的静态站，用 Playwright 定时抓取 YouTube 搜索结果，生成 `data/youtube-ranking.json`，再由前端页面读取 JSON 展示排行。

目标域名：<https://ytb.culua.com/>

## 功能说明

- `live.html`：展示歌枠直播 / 预约、弾き語り直播 / 预约。
- `today.html`：展示今日歌枠热度排行、今日弾き語り热度排行。
- `month.html`：展示本月歌枠热度排行、本月弾き語り热度排行。
- `index.html`：站点入口，默认展示直播 / 预约页。
- 默认保留 YouTube 页面原始顺序，筛选和排序只影响前端视图，不修改 JSON 原始顺序。
- 页面默认把 `歌枠` 和 `弾き語り` 混合成一个排行流，卡片标出关键词；需要拆看时可以直接搜索 `歌枠` 或 `弾き語り`。
- 移动端默认收起筛选面板，首屏直接呈现筛选工具条和排行主体。
- 关闭筛选面板后，顶部会用不同颜色的 chip 展示当前白名单搜索词和黑名单词。
- 每条视频保留 `originalRank`，当前视图中另行计算 `visibleRank`。
- 前端支持搜索、黑名单筛选、最小时长筛选和多种排序。
- 黑名单、搜索词、排序方式和筛选条件会保存到 `localStorage`，刷新后自动恢复。
- 支持复制当前视图 TSV、下载当前视图 JSON、导出当前视图 PNG 截图。

## 抓取规则

- live：每个来源直接滚到页面底部，最多保存 500 条。
- today：每个来源直接滚到页面底部，最多保存 500 条。
- month：每个来源最多获取 500 条，达到 500 条即可停止。
- 如果页面到底时不足 500 条，按实际数量保存。
- 直播页不额外过滤 upcoming / 即将开始 / 预约内容。

默认环境变量：

```bash
YTB_RANKING_TARGET=300
YTB_RANKING_LIMIT=1000
YTB_RANKING_LIVE_LIMIT=500
YTB_RANKING_TODAY_LIMIT=500
YTB_RANKING_MONTH_LIMIT=500
YTB_RANKING_SCROLL_TO_BOTTOM_GROUPS=live,today
YTB_RANKING_CHROME_EXECUTABLE=
```

## 使用方法

安装依赖：

```bash
npm install
```

本地抓取：

```bash
node scripts/update-youtube-ranking.js
```

本地静态预览：

```bash
python3 -m http.server 8080
```

然后打开 <http://localhost:8080/>。

## 文件清单

- `scripts/update-youtube-ranking.js`：Playwright 抓取脚本，生成 `data/youtube-ranking.json`。
- `data/youtube-ranking.json`：前端读取的数据文件，由脚本或 GitHub Actions 更新。
- `index.html`：站点入口，默认展示直播 / 预约排行。
- `live.html`：直播 / 预约排行页面。
- `today.html`：今日热度排行页面。
- `month.html`：本月热度排行页面。
- `assets/youtube-ranking.js`：前端脚本 loader。
- `assets/youtube-ranking.chunk*.js`：前端搜索、筛选、排序、状态持久化和导出逻辑的拆分脚本块。
- `assets/styles.css`：页面布局和移动端样式。
- `package.json`：Node.js 依赖和本地检查、抓取、预览命令。
- `.github/workflows/youtube-ranking.yml`：定时抓取并提交数据的 GitHub Actions workflow。
- `CNAME`：GitHub Pages 自定义域名，内容为 `ytb.culua.com`。
- `docs/`：交接说明和 GitHub connector 操作记录。
- `.gitignore`：排除依赖、缓存、cookie、token、私钥和 LocalSend 缓存。
- `.nojekyll`：让 GitHub Pages 直接按静态文件发布。

## 数据字段

每条视频至少包含：

```text
rank, originalRank, visibleRank, title, channelName, videoId,
watchUrl, thumbnailUrl, viewText, viewCount, liveViewerText,
liveViewerCount, publishedText, durationText, durationSeconds,
statusText, statusType, group, keyword, sourceGroup, sourceUrl,
reachedBottom, truncatedByLimit, searchableText, collectedAt
```

`rank` 和 `originalRank` 表示 YouTube 搜索结果原始顺序；前端筛选或排序后只更新视图中的 `visibleRank`。

## GitHub Actions

`.github/workflows/youtube-ranking.yml` 支持：

- `schedule`：每 10 分钟自动更新。
- `push`：推送到 `main` 或 `codex/ytb-ranking-pages` 时会触发一次抓取，方便在开发分支直接验证 GitHub runner 抓取结果。
- `workflow_dispatch`：手动触发。
- `concurrency`：同一分支只保留一个运行中的抓取任务，避免 10 分钟定时任务互相堆叠。
- `permissions: contents: write`：使用 GitHub Actions 自带 `GITHUB_TOKEN` 提交更新后的 `data/youtube-ranking.json`。

## 注意事项

- 不要提交 cookie、token、`.env`、SSH 私钥或 LocalSend 缓存。
- 抓取脚本不依赖 YouTube 登录态，不读取本地浏览器 cookie。
- YouTube 页面结构可能变化；如果数据字段大量为空，优先检查 `scripts/update-youtube-ranking.js` 中的 DOM 选择器。
- `publishedText` 是 YouTube 页面展示文本，`publishedTimestamp` 是脚本按相对时间粗略估算的排序值。
- PNG 导出由浏览器端 canvas 绘制当前视图，包含页面标题、更新时间、筛选条件和结果卡片。
- GitHub Actions runner 通常可以访问公开 YouTube 页面；如果 YouTube 临时限流或页面结构变化，workflow 会保留失败日志用于排查。

## 测试说明

语法检查：

```bash
npm run check
```

如果当前环境没有 `npm`，也可以使用 Node.js 22+：

```bash
node --run check
```

运行抓取：

```bash
node scripts/update-youtube-ranking.js
```

验证数据：

```bash
node -e "const d=require('./data/youtube-ranking.json'); console.log(Object.keys(d.groups));"
```

本地页面验证：

```bash
python3 -m http.server 8080
```

需要确认：

- `data/youtube-ranking.json` 存在。
- JSON 包含 `live`、`today`、`month` 三组。
- 每组都包含 `歌枠` 和 `弾き語り` 两个来源。
- live 页没有误删 `upcoming`、`即将开始` 或 `预约` 结果。
- 搜索、筛选、排序、清空筛选、TSV 导出、JSON 导出、PNG 导出可用。
