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
- 直播页、今日页和本月页都支持选择最近 7 天内的抓取快照，用于回看某个时间点的排行。
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
YTB_RANKING_LIVE_POST_MAX_RUNTIME_MS=420000
YTB_RANKING_DURATION_INCLUDE_LIVE=0
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

生成当前三组排行快照：

```bash
npm run snapshot
npm run validate:snapshots
node scripts/write-ranking-groups.js
```

## 文件清单

- `scripts/update-youtube-ranking.js`：Playwright 抓取脚本，生成 `data/youtube-ranking.json`。
- `scripts/write-ranking-groups.js`：从主排行数据生成 `data/youtube-ranking-live.json`、`data/youtube-ranking-today.json`、`data/youtube-ranking-month.json`，并裁掉前端可即时重建的冗余字段，减少各页面刷新时下载的数据量。
- `scripts/archive-live-snapshot.js`：把当前 `groups.live / groups.today / groups.month` 分别写入 `data/<group>-snapshots/`，并清理 7 天以前的快照。
- `scripts/validate-live-snapshots.js`：校验三组快照索引、文件存在性和保留期。
- `data/youtube-ranking.json`：前端读取的数据文件，由脚本或 GitHub Actions 更新。
- `data/youtube-ranking-live.json`, `data/youtube-ranking-today.json`, `data/youtube-ranking-month.json`：三组当前页分组数据，保留主数据 envelope 但只包含对应 `groups.<group>`；前端版会省略 `searchableText`，搜索改用标题、频道、视频 ID 和 URL 即时拼接。
- `data/live-snapshots/index.json`, `data/today-snapshots/index.json`, `data/month-snapshots/index.json`：三组快照索引，给前端快照下拉框读取。
- `data/live-snapshots/*.json`, `data/today-snapshots/*.json`, `data/month-snapshots/*.json`：三组历史快照，只保存对应 `groups.<group>`，默认保留 7 天。
- `index.html`：站点入口，默认展示直播 / 预约排行。
- `live.html`：直播 / 预约排行页面。
- `today.html`：今日热度排行页面。
- `month.html`：本月热度排行页面。
- `assets/youtube-ranking.js`：前端脚本 loader。
- `assets/youtube-ranking.chunk*.js`：前端搜索、筛选、排序、状态持久化、分批卡片渲染和导出逻辑的拆分脚本块。
- `assets/ranking-controls.js`：分页、外置搜索框、横向滚动工具条、顶部栏折叠、最低播放量筛选、返回顶部、时间筛选、三组快照选择、排行 JSON 单页共享缓存和自动布局锁定的前端控制层。
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
三组前端分组 JSON 会省略 `searchableText` 以减小体积；主数据和快照仍可保留该字段。

## GitHub Actions

更新链路以 scheduler 空闲检查为主，chain workflow 作为 GitHub schedule 漏触发时的兜底，避免线上 JSON 长时间停在旧数据。

`.github/workflows/youtube-ranking-scheduler.yml` 支持：

- `schedule`：每 10 分钟检查主更新 workflow 是否空闲，空闲时派发抓取。
- `repository_dispatch`：接收 `youtube-ranking-tick` 外部事件后执行同样的空闲检查。
- `workflow_dispatch`：手动触发调度器。

`.github/workflows/youtube-ranking.yml` 支持：

- `push`：推送到 `main` 且改动抓取脚本、分组生成脚本、校验脚本或主 workflow 时触发一次抓取。
- `workflow_dispatch`：手动触发。
- `concurrency`：同一分支串行执行，不取消正在运行的抓取任务。
- `permissions: contents: write`：使用 GitHub Actions 自带 `GITHUB_TOKEN` 提交更新后的 `data/youtube-ranking.json` 和 `data/youtube-ranking-<group>.json`。
- 成功校验后会运行 `scripts/archive-live-snapshot.js`、`scripts/validate-live-snapshots.js` 和 `scripts/write-ranking-groups.js --check`，同一 commit 写入最新主数据、三组分组数据和 `data/live-snapshots/`、`data/today-snapshots/`、`data/month-snapshots/`。

`.github/workflows/youtube-ranking-chain.yml` 支持：

- `schedule`：以 `6,16,26,36,46,56` 分错峰执行同一套空闲检查，作为 scheduler 漏触发时的第二心跳。
- `workflow_dispatch`：主更新 workflow 完成状态写入后会主动派发该入口，等待约 9 分钟后检查主 workflow 是否空闲、是否仍在失败冷却期；手动触发且未传 `trigger_run_id` 时不受失败冷却限制。

如需更稳定的直播量化指标，在仓库 Settings -> Secrets and variables -> Actions 中新增 `YOUTUBE_API_KEY`。该值只在 GitHub Actions 运行时注入，不要写入仓库文件。

## 2026-06-20 静态页稳定性与筛选增强

### 功能说明

本次修复解决前端稳定性、筛选交互和更新链路问题：

- 今日页播放量角标只使用当前 `videoId` 对应的数据，不再从旧 DOM 指标回填，避免第一名显示成错误的 `94万播放`。
- 直播页不再显示 `几天前`、`11天前` 这类时间跨度；直播/预约条目没有“已过去多久”的展示语义。
- 缩略图候选全部失败时隐藏整张视频卡片，并从分页和统计中剔除，避免无封面直播/视频以占位卡形式闪烁。
- 排行增加分页：自动布局每页 99 个；实际两列布局每页 98 个。
- Web 端锁定自动布局，不再展示 `自动 / 2列 / 3列` 布局切换按钮。
- 搜索框移到筛选面板外，搜索词不再保存；黑名单仍会保存；工具条只显示输入框和选择框，不额外显示“搜索 / 快照”文字标签。
- 工具条第一行只保留搜索框，第二行展示筛选按钮、来源统计和更新 chip；来源统计合并为 `歌枠 / 弾き語り = N / N`，有过滤时显示 `歌枠 / 弾き語り / 过滤 = N / N / N`。
- 第二行工具条改为单行横向滚动，不再因为来源统计、更新时间或快照下拉过长而挤出第四行/第五行。
- 顶部工具栏增加主动收起按钮，H5 和 Web 都可手动折叠；折叠状态不缓存，刷新后默认展开。
- 默认标题规则和韩文排除规则作为底层过滤逻辑运行，不再在工具条显示 `标题: ...` 或 `排除韩文` chip；标题规则要求标题包含 `歌枠` 或 `弾き語`，不影响搜索框输入。
- 今日页和本月页增加发布时间筛选，优先使用 `publishedTimestamp`，只在字段缺失时解析 `publishedText`。
- 今日页和本月页增加最低播放量筛选，使用数据里的 `viewCount` 字段，不在直播页展示。
- 今日页和本月页的时间筛选不再常驻工具条，点击更新时间 chip 后直接弹出时间范围按钮，不再嵌套下拉选择。
- 直播页、今日页和本月页都支持最近 7 天快照选择，快照由 GitHub Actions 成功抓取后自动保存。
- 直播页默认屏蔽机器人频道 `そびたんねる / Piero Soubi`，并屏蔽频道名 `きよき一瓢`，包含历史快照视图。
- 卡片正文区域统一拉伸，短标题卡和长标题卡在同一行内保持一致高度。
- 今日页和本月页的发布时间 meta 使用自然高度，不再撑高整张卡片。
- 分页控件同时出现在列表顶部和底部；长列表滚动后右下角显示小型返回顶部按钮。
- PNG 导出会主动按视频 ID 拉取前 100 张封面候选，减少未滚动加载导致的 `No thumbnail`。
- 抓取脚本会清理 `undefined` / `null` / 非公开图片域的 `thumbnailUrl`，并回退到 YouTube 默认缩略图候选；数据校验会把这类无效封面按缺失封面处理。
- 更新入口以 scheduler 空闲检查后派发主 workflow 为主，并由 chain workflow 在主任务完成后延迟补派，避免 GitHub schedule 漏触发造成长时间不更新。
- 主 workflow 在排行质量校验失败时会自动用更保守的滚动、超时和并发参数重试一次，降低 YouTube 短时加载不足导致的失败率。
- scheduler 会读取 `data/youtube-ranking-status.json`，最近一次失败仍在 30 分钟冷却期内时跳过自动派发，避免每 10 分钟重复刷失败状态；手动触发不受冷却限制。
- 最近 24 小时内的抓取失败集中在 `Validate ranking data`，不是 runner、安装、Node、Playwright 或推送崩溃。最近一次失败样例为 `today` 非直播 190/240、`month` 非直播 246/300、`today` 有播放量 170/240；因此改为同一 run 内保守重试，并对失败自动派发做冷却。
- 非直播视频时长仍会补全并校验；直播页不展示时长，`scripts/fill-duration-details.js` 默认跳过直播条目，避免随后被 `clear-live-duration-fields.js` 清掉的无效 fetch / Playwright 工作拖慢更新。
- 直播频道详情后处理增加脚本级运行预算和 workflow 硬超时；该补充步骤超时后继续进入后续校验，避免单个 YouTube 页面请求把整条更新链路卡到 job 超时。

### 使用方法

本地预览：

```bash
python3 -m http.server 8080
```

打开：

- `http://localhost:8080/today.html`：检查今日播放量角标、分页、外置搜索框、搜索刷新重置、最低播放量筛选、顶部栏收起、PNG 导出封面、时间筛选和快照选择。
- `http://localhost:8080/month.html`：检查本月时间筛选、最低播放量筛选、顶部栏收起和快照选择。
- `http://localhost:8080/live.html`：检查直播页不显示时间跨度，坏缩略图卡片会隐藏，并可选择直播快照。
- `http://localhost:8080/today.html` 与 `http://localhost:8080/month.html`：检查快照下拉可读取对应页面的 7 天快照。

语法和数据校验：

```bash
npm run check
node scripts/validate-youtube-ranking.js
node scripts/validate-duration-quality.js
node scripts/archive-live-snapshot.js
node scripts/validate-live-snapshots.js
node scripts/write-ranking-groups.js --check
```

### 本次文件清单

| 文件路径 | 文件用途 | 主要函数或模块职责 | 与其他文件的关系 |
| --- | --- | --- | --- |
| `scripts/enrich-video-metrics.js` | 抓取后补充视频播放量、点赞和频道链接 | `mergeMetric()` 只在缺失播放量或 YouTube Data API 返回时覆盖 `viewCount` | 在 `.github/workflows/youtube-ranking.yml` 中运行，产出给前端读取的 `data/youtube-ranking.json` |
| `scripts/update-youtube-ranking.js` | Playwright 抓取脚本 | `usableThumbnailUrl()` 清理无效缩略图 URL，避免 `undefined` 写入主数据 | 主 workflow 首步生成 `data/youtube-ranking.json` |
| `assets/sort-hotfix.js` | 前端排序、主指标和缩略图兜底修正 | `getPrimaryMetric()` 去掉 DOM 播放量 fallback；`markThumbnailMissing()` 在候选全部失败后隐藏整卡 | 先于主 chunk 加载，影响后续卡片角标和排序展示 |
| `assets/sort-hotfix.css` | 排序和缩略图状态样式 | `.video-card.is-thumbnail-missing` 直接隐藏 | 配合各缩略图 fallback 脚本剔除无封面卡 |
| `assets/heartbeat-hotfix-v2.js` | 早期卡片压缩、指标和元信息补丁 | `upsertMeta()` 在 live 页移除时间跨度，`restoreDuplicateCard()` 只恢复本脚本标记的重复卡 | 与 `heartbeat-corner-layout.js`、`final-ui-polish.js` 共同处理卡片外观 |
| `assets/heartbeat-corner-layout.js` | 缩略图角标和卡片元信息布局 | `observeCardChanges()` 监听主应用延迟渲染、分页和筛选变化；`writeBodyMeta()` live 页不渲染时间；`metricLabel()` 不再继承 DOM 旧指标；`durationLabel()` live 页不回填时长 | 最终写入缩略图上的 rank、metric、keyword、time 角标 |
| `assets/heartbeat-chip-compact.js` | 紧凑布局和 meta 文本整理 | `normalizeMetaRows()` live 页删除 `.hb-meta` | 防止后置整理脚本重新显示直播时间 |
| `assets/final-ui-polish.js` | 最终 UI 清理和频道链接补齐 | `scrubBodyDuplicates()` 和 `ensureCornerTime()` live 页删除时间相关节点 | 页面末尾加载，兜底覆盖早期热补丁残留 |
| `assets/heartbeat-thumb-fallback.js` | 缩略图加载失败后的候选切换 | `markThumbnailUnavailable()` 隐藏无可用封面的 `.video-card` | 解决坏缩略图占位卡反复闪烁的问题 |
| `assets/thumbnail-hotfix.js` | 缩略图质量检查和重复卡处理 | `markThumbnailMissing()` 隐藏无可用封面的卡片；`restoreDuplicateCard()` 只恢复 `.is-duplicate-video` | 避免覆盖坏封面、直播清理等其它隐藏状态 |
| `assets/ux-hotfix.js` | 早期 UI 密度和导出补丁 | `restoreDuplicateCard()` 只恢复本脚本标记的重复卡 | 避免与缩略图 fallback 争抢 `card.hidden` |
| `assets/ranking-controls.js` | 分页、搜索、横向滚动工具条、顶部栏折叠、最低播放量筛选、返回顶部、时间筛选、三组快照、默认屏蔽和排行 JSON 单页共享缓存控制层 | `patchRankingFetch()` 按当前页面组读取 `data/youtube-ranking-<group>.json`，选择快照时读取 `data/<group>-snapshots/<id>.json`，失败再回退 `data/youtube-ranking.json`；`fetchSharedRankingResponse()` 合并同页重复请求；`filterDefaultBlockedItems()` 过滤默认屏蔽频道和无效缩略图 URL；`applyTimeFilterAndPagination()` 按时间、播放量、缩略图状态和分页隐藏卡片；`.video-card` 使用 `content-visibility: auto` 降低离屏卡片首次渲染成本 | 在四个 HTML 中先于主应用加载，避免侵入重打主 chunk |
| `assets/ui-overrides.js` | 默认标题过滤、黑白名单 chip、直播指标展示和头像兜底逻辑 | `filterRankingDataByTitle()` 使用内部 `歌枠 / 弾き語` 标题规则并排除韩文；`markThumbnailMissing()` 隐藏无可用封面的卡片；`prepareChannelRows()` 补头像和频道行 | 后置增强卡片 DOM，默认过滤逻辑与 `assets/sort-hotfix.js` 保持一致 |
| `assets/final-ui-polish.js`, `assets/corner-readability-hotfix.js`, `assets/heartbeat-corner-transparent.js`, `assets/png-export-hotfix.js` | 最终 UI 清理、角标可读性和 PNG 导出兜底 | `png-export-hotfix.js` 在导出前等待数据索引，并按 `videoId` 主动尝试 `hq720 / maxres / sd / hq / mq / default` 封面候选；其它脚本同步识别新旧默认标题过滤文案，避免内部过滤条件在页面或导出标题中露出 | 页面末尾加载或导出时兜底清理工具条状态 |
| `scripts/archive-live-snapshot.js` | 三组快照生成脚本 | `archiveGroupSnapshot()` 保存当前 `groups.live / groups.today / groups.month`；`pruneSnapshotFiles()` 清理 7 天外快照；`summarizeGroup()` 生成索引摘要 | 主 workflow 成功校验后运行，产出给 `assets/ranking-controls.js` 读取的快照文件 |
| `scripts/write-ranking-groups.js` | 当前排行分组文件生成脚本 | `groupPayload()` 保留主数据顶层 metadata，只写入对应 `groups.live / groups.today / groups.month`；`--check` 验证分组文件是否与主数据同步；分组文件使用紧凑 JSON 降低下载后解析体积 | 主 workflow 归档快照后运行，产出给普通页面默认读取的轻量分组 JSON |
| `scripts/validate-live-snapshots.js` | 三组快照校验脚本 | 校验索引 schema、快照文件、`groups.<group>.items` 和 7 天保留期 | 本地 `npm run validate:snapshots` 与 GitHub Actions 调用 |
| `scripts/validate-youtube-ranking.js` | 排行数据质量校验脚本 | 校验三组条目、有效缩略图和播放量覆盖；直播订阅数覆盖不足只记 warning，避免公开订阅数短时不可采时阻断发布；对已到页底或达到 limit 的自然低数量结果降为 warning，未完成抓取仍保持 failure | 主 workflow 的初次校验和保守重试后终检都会调用 |
| `scripts/fill-duration-details.js` | 非直播视频时长补全脚本 | `targetVideoItems()` 收集今日/本月缺失时长的视频；`YTB_RANKING_DURATION_INCLUDE_LIVE=0` 时跳过直播条目；`enrichWithFetch()` / `enrichWithPlaywright()` 只在仍有缺失时补充 | 主 workflow 在播放量补齐后运行，补出的 `durationText` / `durationSeconds` 供前端和 `validate-duration-quality.js` 使用 |
| `data/live-snapshots/`, `data/today-snapshots/`, `data/month-snapshots/` | 三组快照数据 | 各自保存某次抓取的单个 `groups.<group>` 和索引 | 选择 `?snapshot=<id>` 时由前端按当前页面组替换主数据请求 |
| `index.html`, `live.html`, `today.html`, `month.html` | GitHub Pages 页面入口 | 更新修复脚本的 cache-busting query | 保证线上页面加载 `20260622-channel1` 版本控制层脚本和 `20260622-split4` 版本主排行脚本 |
| `.github/workflows/youtube-ranking.yml` | 主抓取、补指标、校验、快照和提交数据 workflow | 串行不取消运行中任务；直播频道详情后处理有硬超时并允许继续校验；初次质量校验失败后用保守滚动/并发/超时参数重跑一次；成功后写入三组快照；状态写入后主动派发下一次 chain tick | 由 scheduler、chain fallback 或手动触发 |
| `.github/workflows/youtube-ranking-scheduler.yml` | GitHub Actions 调度入口 | 每 10 分钟检查空闲后派发主 workflow；若最近失败仍在 30 分钟冷却期内则跳过自动派发，保留 repository_dispatch | 学习 culua_web_h5 的 dispatch 控制方式，减少重复触发和失败噪音 |
| `.github/workflows/youtube-ranking-chain.yml` | 更新兜底派发器 | 被主 workflow 显式派发或由错峰 schedule 触发后，等待约 9 分钟再检查空闲和失败冷却；手动触发可绕过失败冷却 | 在 GitHub schedule 漏触发时补派下一轮主 workflow |
| `scripts/check-js-syntax.js` | 跨平台 JS 语法检查 | 遍历 `scripts/` 和 `assets/`，逐个执行 `node --check` | 替换 `package.json` 中 Bash 专用的 `for` 语法 |
| `package.json` | npm 命令入口 | `npm run check` 调用跨平台检查脚本并执行 `scripts/write-ranking-groups.js --check`；`npm run snapshot` / `npm run validate:snapshots` 维护三组快照 | Windows PowerShell 与 Linux runner 都可直接运行 |
| `README.md` | 项目说明文档 | 记录本次功能、使用、文件清单、注意事项和测试说明 | 给后续维护者提供交接入口 |

### 注意事项

- 播放量修正依赖 `videoId`，后续新增补丁不要从 `.hb-metric`、`.rank-metric` 等 DOM 文本反推播放量。
- 直播页默认不展示发布时间跨度；如需展示直播状态，应使用 `statusType` 或固定文案，而不是解析 `publishedText`。
- 缩略图候选全部失败时隐藏整张 `.video-card`，避免无封面数据持续占位或闪烁。
- 时间筛选优先使用 `publishedTimestamp`，以数据生成时间为基准，不按浏览器停留时间漂移。
- 最低播放量筛选依赖 `viewCount`，直播页没有稳定播放量字段，因此不展示该控件。
- 顶部栏折叠状态只保存在运行时内存中，不写入 localStorage；刷新后应恢复展开。
- PNG 导出会主动拉取封面候选，仍需遵守浏览器 canvas CORS 限制；公开 YouTube 缩略图正常应可导出。
- 页面不会展示无可用封面的卡片；如果所有 YouTube 缩略图候选都 404 或被判定为占位图，卡片会被隐藏并重新分页。
- 快照会分别保留直播、今日和本月三组页面数据；7 天保留指当前 main 分支静态文件保留，Git 历史不会自动瘦身。
- 快照下拉的展示标签默认使用 `Asia/Taipei` 时间，可通过 `YTB_RANKING_SNAPSHOT_TIME_ZONE` 覆盖。
- 搜索词是临时状态，刷新会重置；黑名单仍通过 `ytb-ranking-blacklist-v1` 保存。
- 默认机器人屏蔽在前端数据请求层完成，当前主数据和历史快照展示都会生效。
- 自动调度失败冷却影响 scheduler 和 chain fallback；需要立即补跑时可手动执行 `Update YouTube ranking` workflow。
- 直播订阅数只作为排序/展示参考指标；覆盖率不足会在校验日志中告警，但不会阻止新排行发布。播放量覆盖、条目数和缩略图有效性仍会阻止明显坏数据上线。
- 质量校验仍会阻止明显不完整的数据覆盖线上排行；保守重试只是在同一次 workflow 内再抓一次，不会提交未通过终检的候选数据。
- `YTB_RANKING_DURATION_INCLUDE_LIVE` 默认为 `0`；只有确实需要在数据层保留直播时长时才应改成 `1`，否则会增加大量 watch 页和 Playwright 请求且最终不在直播页展示。
- 调度器通过 `GITHUB_TOKEN` 派发主 workflow，不需要提交 GitHub PAT、cookie 或 `.env`。
- 主 workflow 通过 `GITHUB_TOKEN` 显式派发 chain workflow，避免只依赖 GitHub `schedule` 或 `workflow_run` 接力；chain 带 `trigger_run_id` 时仍会遵守失败冷却。
- `data/youtube-ranking.json` 体积会随排行字段增长；普通页面默认读取 `data/youtube-ranking-<group>.json`，并依赖 `assets/ranking-controls.js` 的同页共享缓存避免刷新时被多个 hotfix 脚本重复下载和重复解析。完整主数据仍保留为兜底和维护入口，提交前应跑 `node scripts/write-ranking-groups.js --check` 防止分组文件过期。

### 测试说明

需要重点验证：

- `today.html` 中 `0VI6KOfpL_k` 不再显示错误的 `94万播放`。
- `live.html` 中 `c9HgRwNQF9E` 等直播/预约卡不显示 `11天前`。
- `live.html` 中 `wF8xrElQoCo` 或 `Vgv88Jtde40` 这类缩略图候选全部失败时隐藏整张卡片，并重新分页。
- `today.html` 和 `month.html` 中没有 `.layout-toggle`，`document.body.dataset.layoutMode === "auto"`。
- `today.html` 默认最多展示 99 张卡片，点击下一页后展示下一批结果。
- 搜索框在筛选面板外；输入搜索词后刷新页面，搜索框恢复为空。
- 工具条不显示“搜索”和“快照”两个文字标签，只保留搜索输入框和快照选择框。
- 第一行只显示搜索框，更新时间、来源统计和过滤统计在第二行。
- 第二行工具条保持单行横向滚动，不应出现第四行或第五行。
- 点击顶部栏收起按钮后只保留展开入口；刷新后默认恢复展开，且 localStorage 不出现折叠状态。
- 工具条不显示默认过滤逻辑，例如 `排除韩文`、`标题: 歌枠 / 弾き語り`、`标题: 歌 / 弾き語り` 或 `标题: 歌枠 / 弾き語`。
- 点击更新时间 chip 能直接弹出时间按钮，选择后分页回到第一页。
- 今日页和本月页输入最低播放量后，低于阈值的卡片隐藏，来源统计和分页总数同步变化。
- PNG 导出前 100 条时应主动拉取封面，非真实坏图不应显示 `No thumbnail`。
- `live.html` 中 `Vgv88Jtde40` 这类所有 `hq720 / maxres / sd / hq / mq / default` 候选均 404 的视频不应显示占位卡。
- 顶部和底部都显示分页控件，点击任意一处只翻一页。
- 长页面向下滚动后出现小型 `↑` 返回顶部按钮，点击后回到页面顶部。
- `live.html` 中 `そびたんねる` / `Piero Soubi` / `Unmanned Japanese` / `きよき一瓢` 不再出现。
- 同一行卡片高度保持一致，短标题卡不会比相邻卡明显更矮。
- 今日页和本月页卡片中的 `15小时前` 等发布时间文本保持紧凑，不应撑出大块空白。
- 黑名单刷新后仍保留。
- `live.html` / `today.html` / `month.html` 的快照下拉可分别选择 `data/live-snapshots/index.json`、`data/today-snapshots/index.json`、`data/month-snapshots/index.json` 中的快照。
- `npm run check`、`node scripts/validate-youtube-ranking.js`、`node scripts/validate-duration-quality.js` 均通过，其中 `npm run check` 会同时校验三份 `data/youtube-ranking-<group>.json` 是否与主数据同步。
- `node scripts/validate-youtube-ranking.js` 会把 `undefined` / `null` / 非公开图片域的 `thumbnailUrl` 计为缺失封面。
- `node scripts/fill-duration-details.js` 在直播时长默认关闭时应输出 `includeLiveDurations: false`，且 `fetch.checked` / `playwright.checked` 不再随直播缺失数量增长。
- GitHub Actions 中 `Update YouTube ranking` 若初次 `Validate ranking data` 失败，会出现 `Retry ranking data with conservative settings` step；终检通过才提交数据。
- GitHub Actions 中 `Dispatch YouTube ranking update` 若处于失败冷却期，应输出 `Skip dispatch: previous failure is cooling down...`。

## 注意事项

- 不要提交 cookie、token、`.env`、SSH 私钥或 LocalSend 缓存。
- 抓取脚本不依赖 YouTube 登录态，不读取本地浏览器 cookie。
- YouTube 页面结构可能变化；如果数据字段大量为空，优先检查 `scripts/update-youtube-ranking.js` 中的 DOM 选择器。
- `publishedText` 是 YouTube 页面展示文本，`publishedTimestamp` 是脚本按相对时间粗略估算的排序值。
- PNG 导出由浏览器端 canvas 绘制当前视图，包含页面标题、更新时间、筛选条件和结果卡片；导出前会主动拉取封面候选，避免依赖手动滚动。
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
