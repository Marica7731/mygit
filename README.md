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
- 前端支持搜索、黑名单筛选、最小时长筛选、今日/本月时间筛选和多种排序。
- 排行卡片按页展示：自动布局每页 99 个；实际两列布局每页 98 个。
- 黑名单、排序方式和筛选条件会保存到 `localStorage`，刷新后自动恢复；搜索框只作用于当前页面，刷新后会重置。
- 直播页支持选择最近 7 天内的抓取快照，用于回看某个时间点的直播排行。
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
YTB_RANKING_ENRICH_LIVE_DETAILS=1
YTB_RANKING_LIVE_DETAIL_LIMIT=120
YOUTUBE_API_KEY=
YTB_RANKING_CHROME_EXECUTABLE=
```

直播量化字段有两条来源：

- 如果 GitHub Secrets 配置了 `YOUTUBE_API_KEY`，脚本会通过 YouTube Data API 批量补充直播观看人数、点赞数和频道订阅数。
- 如果没有配置 API key，GitHub Actions 会尽力打开正在直播的视频页补采公开展示的观看人数、订阅数和点赞数；该方式依赖 YouTube 页面结构，稳定性不如 API。
- 为了配合 10 分钟定时任务，workflow 中页面 fallback 的实际上限设置为 5 条，并把详情页等待时间缩短到 500ms；脚本默认值仍可通过环境变量覆盖。

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

生成当前直播快照：

```bash
npm run snapshot
npm run validate:snapshots
```

## 文件清单

- `scripts/update-youtube-ranking.js`：Playwright 抓取脚本，生成 `data/youtube-ranking.json`。
- `scripts/archive-live-snapshot.js`：把当前 `groups.live` 写入 `data/live-snapshots/`，并清理 7 天以前的快照。
- `scripts/validate-live-snapshots.js`：校验直播快照索引、文件存在性和保留期。
- `data/youtube-ranking.json`：前端读取的数据文件，由脚本或 GitHub Actions 更新。
- `data/live-snapshots/index.json`：直播快照索引，给前端快照下拉框读取。
- `data/live-snapshots/*.json`：直播历史快照，只保存 `groups.live`，默认保留 7 天。
- `index.html`：站点入口，默认展示直播 / 预约排行。
- `live.html`：直播 / 预约排行页面。
- `today.html`：今日热度排行页面。
- `month.html`：本月热度排行页面。
- `assets/youtube-ranking.js`：前端脚本 loader。
- `assets/youtube-ranking.chunk*.js`：前端搜索、筛选、排序、状态持久化和导出逻辑的拆分脚本块。
- `assets/ranking-controls.js`：分页、外置搜索框、时间筛选、直播快照选择和自动布局锁定的前端控制层。
- `assets/styles.css`：页面布局和移动端样式。
- `assets/ui-overrides.css`：移动端紧凑布局、卡片信息密度和覆盖层样式。
- `assets/ui-overrides.js`：默认标题过滤、黑白名单 chip、直播指标展示和头像兜底逻辑。
- `package.json`：Node.js 依赖和本地检查、抓取、预览命令。
- `.github/workflows/youtube-ranking.yml`：定时抓取并提交数据的 GitHub Actions workflow。
- `CNAME`：GitHub Pages 自定义域名，内容为 `ytb.culua.com`。
- `docs/`：交接说明和 GitHub connector 操作记录。
- `.gitignore`：排除依赖、缓存、cookie、token、私钥和 LocalSend 缓存。
- `.nojekyll`：让 GitHub Pages 直接按静态文件发布。

## 数据字段

每条视频至少包含：

```text
rank, originalRank, visibleRank, title, channelName, channelAvatarUrl, channelId,
videoId, watchUrl, thumbnailUrl, viewText, viewCount, liveViewerText,
liveViewerCount, liveViewerSource, subscriberText, subscriberCount,
subscriberSource, likeText, likeCount, likeSource, publishedText,
durationText, durationSeconds,
statusText, statusType, group, keyword, sourceGroup, sourceUrl,
reachedBottom, truncatedByLimit, searchableText, collectedAt
```

`rank` 和 `originalRank` 表示 YouTube 搜索结果原始顺序；前端筛选或排序后只更新视图中的 `visibleRank`。

## GitHub Actions

更新链路已收敛为 scheduler 统一派发主抓取流程，避免主 workflow、scheduler 和 chain workflow 同时抢占更新窗口。

`.github/workflows/youtube-ranking-scheduler.yml` 支持：

- `schedule`：每 10 分钟检查主更新 workflow 是否空闲，空闲时派发抓取。
- `repository_dispatch`：接收 `youtube-ranking-tick` 外部事件后执行同样的空闲检查。
- `workflow_dispatch`：手动触发调度器。

`.github/workflows/youtube-ranking.yml` 支持：

- `push`：推送到 `main` 且改动抓取脚本、校验脚本或主 workflow 时触发一次抓取。
- `workflow_dispatch`：手动触发。
- `concurrency`：同一分支串行执行，不取消正在运行的抓取任务。
- `permissions: contents: write`：使用 GitHub Actions 自带 `GITHUB_TOKEN` 提交更新后的 `data/youtube-ranking.json`。
- 成功校验后会运行 `scripts/archive-live-snapshot.js` 和 `scripts/validate-live-snapshots.js`，同一 commit 写入最新主数据和 `data/live-snapshots/`。

`.github/workflows/youtube-ranking-chain.yml` 保留为手动 fallback，不再按 `workflow_run` 或 cron 自动持续派发，避免重复更新和相互取消。

如需更稳定的直播量化指标，在仓库 Settings -> Secrets and variables -> Actions 中新增 `YOUTUBE_API_KEY`。该值只在 GitHub Actions 运行时注入，不要写入仓库文件。

## 2026-06-20 静态页稳定性与筛选增强

### 功能说明

本次修复解决前端稳定性、筛选交互和更新链路问题：

- 今日页播放量角标只使用当前 `videoId` 对应的数据，不再从旧 DOM 指标回填，避免第一名显示成错误的 `94万播放`。
- 直播页不再显示 `几天前`、`11天前` 这类时间跨度；直播/预约条目没有“已过去多久”的展示语义。
- 缩略图候选全部失败时保留视频卡片并显示占位，不再隐藏整卡，避免 `wF8xrElQoCo` 这类卡片时有时无。
- 排行增加分页：自动布局每页 99 个；实际两列布局每页 98 个。
- Web 端锁定自动布局，不再展示 `自动 / 2列 / 3列` 布局切换按钮。
- 搜索框移到筛选面板外，搜索词不再保存；黑名单仍会保存；工具条只显示输入框和选择框，不额外显示“搜索 / 快照”文字标签。
- 今日页和本月页增加发布时间筛选，优先使用 `publishedTimestamp`，只在字段缺失时解析 `publishedText`。
- 直播页增加最近 7 天快照选择，快照由 GitHub Actions 成功抓取后自动保存。
- 直播页默认屏蔽机器人频道 `そびたんねる / Piero Soubi`，包含历史快照视图。
- 卡片正文区域统一拉伸，短标题卡和长标题卡在同一行内保持一致高度。
- 更新入口从多路自动触发收敛到 scheduler 空闲检查后派发主 workflow。
- 最近一次“8 分钟前抓取失败”的原因不是抓取脚本崩溃，而是 `Validate ranking data` 阶段未达数据量阈值：`today` 只有 40 条非直播视频，低于 240；`month` 只有 100 条非直播视频，低于 300；后续 run 已重新成功。

### 使用方法

本地预览：

```bash
python3 -m http.server 8080
```

打开：

- `http://localhost:8080/today.html`：检查今日播放量角标、分页、外置搜索框、搜索刷新重置和时间筛选。
- `http://localhost:8080/month.html`：检查本月时间筛选。
- `http://localhost:8080/live.html`：检查直播页不显示时间跨度，坏缩略图卡片不消失，并可选择直播快照。

语法和数据校验：

```bash
npm run check
node scripts/validate-youtube-ranking.js
node scripts/validate-duration-quality.js
node scripts/archive-live-snapshot.js
node scripts/validate-live-snapshots.js
```

### 本次文件清单

| 文件路径 | 文件用途 | 主要函数或模块职责 | 与其他文件的关系 |
| --- | --- | --- | --- |
| `scripts/enrich-video-metrics.js` | 抓取后补充视频播放量、点赞和频道链接 | `mergeMetric()` 只在缺失播放量或 YouTube Data API 返回时覆盖 `viewCount` | 在 `.github/workflows/youtube-ranking.yml` 中运行，产出给前端读取的 `data/youtube-ranking.json` |
| `assets/sort-hotfix.js` | 前端排序和主指标修正 | `getPrimaryMetric()` 去掉 DOM 播放量 fallback，只信任当前 item 数据 | 先于主 chunk 加载，影响后续卡片角标展示 |
| `assets/sort-hotfix.css` | 排序和缩略图状态样式 | `.is-thumbnail-missing` 不再隐藏整张卡 | 配合 `assets/heartbeat-thumb-fallback.js` 显示坏封面占位 |
| `assets/heartbeat-hotfix-v2.js` | 早期卡片压缩、指标和元信息补丁 | `upsertMeta()` 在 live 页移除时间跨度，`restoreDuplicateCard()` 只恢复本脚本标记的重复卡 | 与 `heartbeat-corner-layout.js`、`final-ui-polish.js` 共同处理卡片外观 |
| `assets/heartbeat-corner-layout.js` | 缩略图角标和卡片元信息布局 | `writeBodyMeta()` live 页不渲染时间；`metricLabel()` 不再继承 DOM 旧指标；`durationLabel()` live 页不回填时长 | 最终写入缩略图上的 rank、metric、keyword、time 角标 |
| `assets/heartbeat-chip-compact.js` | 紧凑布局和 meta 文本整理 | `normalizeMetaRows()` live 页删除 `.hb-meta` | 防止后置整理脚本重新显示直播时间 |
| `assets/final-ui-polish.js` | 最终 UI 清理和频道链接补齐 | `scrubBodyDuplicates()` 和 `ensureCornerTime()` live 页删除时间相关节点 | 页面末尾加载，兜底覆盖早期热补丁残留 |
| `assets/heartbeat-thumb-fallback.js` | 缩略图加载失败后的候选切换 | `markThumbnailUnavailable()` 显示占位，不再隐藏 `.video-card` | 解决坏缩略图和去重脚本互相隐藏/恢复造成的闪动 |
| `assets/thumbnail-hotfix.js` | 缩略图质量检查和重复卡处理 | `restoreDuplicateCard()` 只恢复 `.is-duplicate-video` | 避免覆盖坏封面、直播清理等其它隐藏状态 |
| `assets/ux-hotfix.js` | 早期 UI 密度和导出补丁 | `restoreDuplicateCard()` 只恢复本脚本标记的重复卡 | 避免与缩略图 fallback 争抢 `card.hidden` |
| `assets/ranking-controls.js` | 分页、搜索、时间筛选、快照和默认屏蔽控制层 | `patchStatePersistence()` 删除持久化搜索词并锁定 auto；`filterRankingResponse()` 过滤默认屏蔽频道；`applyTimeFilterAndPagination()` 按时间筛选和分页隐藏卡片；`patchRankingFetch()` 加载选中直播快照 | 在四个 HTML 中先于主应用加载，避免侵入重打主 chunk |
| `scripts/archive-live-snapshot.js` | 直播快照生成脚本 | `buildSnapshot()` 保存当前 `groups.live`；`pruneSnapshotFiles()` 清理 7 天外快照；`summarizeLiveGroup()` 生成索引摘要 | 主 workflow 成功校验后运行，产出给 `assets/ranking-controls.js` 读取的快照文件 |
| `scripts/validate-live-snapshots.js` | 直播快照校验脚本 | 校验索引 schema、快照文件、`groups.live.items` 和 7 天保留期 | 本地 `npm run validate:snapshots` 与 GitHub Actions 调用 |
| `data/live-snapshots/index.json` | 直播快照索引 | 记录快照 id、文件名、展示标签、条目数量和过期时间 | 前端快照下拉框读取 |
| `data/live-snapshots/*.json` | 直播快照数据 | 保存某次抓取的 `groups.live` | 选择 `?snapshot=<id>` 时由前端替换主数据请求 |
| `index.html`, `live.html`, `today.html`, `month.html` | GitHub Pages 页面入口 | 更新修复脚本的 cache-busting query | 保证线上页面加载 `20260620-stable1` 和 `20260620-controls1` 版本脚本 |
| `.github/workflows/youtube-ranking.yml` | 主抓取、补指标、校验、快照和提交数据 workflow | 移除自动 schedule 与 chain 派发，串行不取消运行中任务；成功后写入直播快照 | 由 scheduler 或手动触发 |
| `.github/workflows/youtube-ranking-scheduler.yml` | GitHub Actions 调度入口 | 每 10 分钟检查空闲后派发主 workflow，保留 repository_dispatch | 学习 culua_web_h5 的 dispatch 控制方式，减少重复触发 |
| `.github/workflows/youtube-ranking-chain.yml` | 手动 fallback 派发器 | 只保留 `workflow_dispatch` | 不再自动链式触发主 workflow |
| `scripts/check-js-syntax.js` | 跨平台 JS 语法检查 | 遍历 `scripts/` 和 `assets/`，逐个执行 `node --check` | 替换 `package.json` 中 Bash 专用的 `for` 语法 |
| `package.json` | npm 命令入口 | `npm run check` 调用跨平台检查脚本；`npm run snapshot` / `npm run validate:snapshots` 维护直播快照 | Windows PowerShell 与 Linux runner 都可直接运行 |
| `README.md` | 项目说明文档 | 记录本次功能、使用、文件清单、注意事项和测试说明 | 给后续维护者提供交接入口 |

### 注意事项

- 播放量修正依赖 `videoId`，后续新增补丁不要从 `.hb-metric`、`.rank-metric` 等 DOM 文本反推播放量。
- 直播页默认不展示发布时间跨度；如需展示直播状态，应使用 `statusType` 或固定文案，而不是解析 `publishedText`。
- 缩略图失败只能影响图片区域，不应隐藏整张 `.video-card`。
- 时间筛选优先使用 `publishedTimestamp`，以数据生成时间为基准，不按浏览器停留时间漂移。
- 快照只保留直播页数据，不保存今日和本月历史；7 天保留指当前 main 分支静态文件保留，Git 历史不会自动瘦身。
- 搜索词是临时状态，刷新会重置；黑名单仍通过 `ytb-ranking-blacklist-v1` 保存。
- 默认机器人屏蔽在前端数据请求层完成，当前主数据和历史快照展示都会生效。
- 调度器通过 `GITHUB_TOKEN` 派发主 workflow，不需要提交 GitHub PAT、cookie 或 `.env`。

### 测试说明

需要重点验证：

- `today.html` 中 `0VI6KOfpL_k` 不再显示错误的 `94万播放`。
- `live.html` 中 `c9HgRwNQF9E` 等直播/预约卡不显示 `11天前`。
- `live.html` 中 `wF8xrElQoCo` 缩略图失败时仍保留卡片，并显示占位，不再让后续卡片左右跳动。
- `today.html` 和 `month.html` 中没有 `.layout-toggle`，`document.body.dataset.layoutMode === "auto"`。
- `today.html` 默认最多展示 99 张卡片，点击下一页后展示下一批结果。
- 搜索框在筛选面板外；输入搜索词后刷新页面，搜索框恢复为空。
- 工具条不显示“搜索”和“快照”两个文字标签，只保留搜索输入框和快照选择框。
- `live.html` 中 `そびたんねる` / `Piero Soubi` / `Unmanned Japanese` 不再出现。
- 同一行卡片高度保持一致，短标题卡不会比相邻卡明显更矮。
- 黑名单刷新后仍保留。
- `live.html` 的快照下拉可选择 `data/live-snapshots/index.json` 中的快照。
- `npm run check`、`node scripts/validate-youtube-ranking.js`、`node scripts/validate-duration-quality.js` 均通过。

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
