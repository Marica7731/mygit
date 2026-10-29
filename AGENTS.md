# AGENTS.md

这份文件告诉维护者怎样安全地更新 YouTube 排行项目。改代码前先读一遍。

## 项目入口

- 仓库：`Marica7731/mygit`；网站：<https://ytb.culua.com/>。
- `main` 分支会发布到 GitHub Pages。发布前先通过本文件里的检查。
- 当前事实看 `main`、`data/youtube-ranking-status.json` 和 GitHub Actions 结果。
- `docs/youtube-ranking-handoff.md` 是旧交接文档，里面有些内容已经过期。

## 不要破坏这些东西

1. **默认保留全部历史快照。** 不要删除或批量重写 `data/*-snapshots/`。只有任务明确设置正整数 `YTB_RANKING_SNAPSHOT_DAYS` 时，才按天清理。检查脚本会验证这一点。
2. **时间范围要算对。** `month` 是从一个月前的今天（台北时间 00:00）到现在；月末日期要正确夹取。`week` 是最近 168 小时，导航里要有“7天”。
3. **正式周榜和月榜要用历史快照并集。** 用 `groups.month.items` 和已经检查过的 `data/ranking-union-cache.json`。缓存从滚动月的第一天开始，周榜也从这份并集中筛选。
4. **缓存坏了就报错。** 不要悄悄改用当前抓取池；否则旧视频会消失，排行榜看起来却像正常。
5. **不要截短正式榜单。** `rankingWindows.snapshotUnion.outputCap` 必须是 `null`。不要用 `.slice()` 给正式结果设上限。
6. **同一视频只留一条。** 优先按 `videoId` 去重；没有 ID 时才用 URL 或标题、频道、关键词和发布时间组合判断。
7. **筛选结果不能记在浏览器里。** 不要恢复 `ytb-ranking-time-filter-v1:*` 的 localStorage 行为。它会让月榜错误地只剩七天。
8. **汇总数字从完整数据算。** 不要数页面当前显示的卡片。要保持“歌枠 + 弾き語り + 过滤”与 `__YTB_RANKING_TOTAL_ITEM_COUNT__` 相等。

## 改代码时

- `assets/youtube-ranking.source.js` 是前端源文件。
- `assets/youtube-ranking.chunk*.js` 和 `assets/youtube-ranking.js` 是生成文件，不要手改。
- 改前端源文件后运行 `npm run build:frontend`。
- `ranking-controls.js` 可以单独修改；改完要更新各 HTML 中的 `?v=` 版本号。
- 新增榜单页面时，要同时接好：导航和 `PAGE_CONFIG`、HTML 页面、生成脚本、快照白名单、workflow 的提交清单和线上页面检查表。

## 数据更新的固定顺序

不要调换这些步骤：

1. `scripts/update-youtube-ranking.js` 生成原始抓取数据。
2. 更新指标、时长并规范数据格式。
3. `scripts/validate-youtube-ranking.js` 检查原始抓取量。
4. `scripts/apply-ranking-windows.js` 根据原始数据和并集缓存生成周榜、月榜，再更新缓存。
5. `scripts/validate-ranking-windows.js` 检查时间范围、缓存信息、去重和无上限。
6. 保存快照并检查快照，再写出榜单分组。
7. 所有检查通过后才能提交数据。

`apply-ranking-windows.js` 每次都要重新生成正式榜单。不能因为数据里已有 `rankingWindows.applied === true` 就提前结束。

## 检查和发布

代码变更要通过：

```bash
npm run check
npm run verify:pages
# 或运行包含这两项的完整检查
npm run verify
```

- `npm run check` 检查代码、生成文件、榜单数据、快照和各项规则。
- `npm run verify:pages` 检查真实页面里的七天/月榜、旧筛选状态和汇总数字。
- `release-gate.yml` 是代码检查；数据更新 workflow 会再次检查；Pages 发布后还有线上检查。
- 推送 `main` 会发布网站。看完 Actions 和线上页面后，才能说发布成功。
- 使用现有检查就够了。不要加与这次改动无关的新审批步骤，挡住已经通过检查的正常发布。

## 文件和项目保护

- 只改完成任务需要的文件。
- 不要删除或改名 `config/`、workflow、规则文件、历史快照或整个项目。
- 不要重写 Git 历史、强推或删除分支。存储变大时先调查；历史重写必须得到这次任务中用户的明确同意。
- 用户已经做过的改动不能丢。不要顺手整理无关数据或代码。

## 文档怎么写

本文件只写长期有效的规则和入口。不要把一次运行的日志、时间、run id、提交 SHA、计数或临时故障写进来。长期结论写成简单规则；单次结果放在 Actions 或交接记录里。
