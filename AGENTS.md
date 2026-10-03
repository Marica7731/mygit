# AGENTS.md

本文件是 `Marica7731/mygit`（线上站点 <https://ytb.culua.com/>）的协作约束。修改代码前先读完。

## 项目入口

- 默认分支：`main`，直接推送即部署到 GitHub Pages。
- 事实源：`main` 的最新代码、`data/youtube-ranking-status.json`、GitHub Actions 实际运行结果。
- `docs/youtube-ranking-handoff.md` 是早期历史文档，**部分状态已过期**，不要当作当前事实。

## 命令与超时

1. 每条命令都要设置合理 bounded timeout：普通检查约 10–30 秒，测试通常约 60 秒，远程探针约 30 秒。
2. 不执行无界等待；轮询必须有明确的 deadline，到点后基于已取得的证据继续或报告。

## 不可破坏的不变量

1. **历史快照永不删除。**
   - `scripts/archive-live-snapshot.js` 默认 `retentionPolicy=keep-all`。
   - 只有显式把 `YTB_RANKING_SNAPSHOT_DAYS` 设成正整数才允许按天清理。
   - 不要用 `rm`、`git rm` 或批量重写去清理 `data/*-snapshots/`。
   - `scripts/verify-snapshot-retention.js` 会在每次 `npm run check` 中回归这一点。
2. **`month` 必须是自然月**（当月 1 日 00:00 `Asia/Taipei` 至今），不是滚动 30 天。
3. **`week` 必须是滚动 168 小时**，并在导航里存在 `7天` tab。
4. **发布时间筛选不持久化。** 不要恢复 `ytb-ranking-time-filter-v1:*` 的 localStorage 行为；残留会让月榜缩成 7 天并产生虚假“过滤”计数。
5. **“过滤”汇总必须从数据集计算**，不能遍历分批渲染中的 DOM 卡片。不变量：`歌枠 + 弾き語り + 过滤 === __YTB_RANKING_TOTAL_ITEM_COUNT__`。

## 前端开发

- `assets/youtube-ranking.source.js` 是前端核心应用的唯一可编辑源文件。
- `assets/youtube-ranking.chunk*.js` 和 `assets/youtube-ranking.js` 都是生成物，**不要手改**。
- 改完源文件必须执行 `npm run build:frontend`，否则 `npm run check` 会失败。
- `ranking-controls.js` 是独立的控制层，可以单独编辑；改动后需同步刷新各 HTML 里的 `?v=` 版本号。
- 新增页面组时要同时改：`assets/youtube-ranking.source.js`（`PAGE_CONFIG` + 导航）、`<group>.html`、`scripts/write-ranking-groups.js`、快照脚本的 group 白名单、workflow 的 `git add` 清单，以及 `scripts/verify-pages.js` 的页面表。

## 数据管线顺序

抓取 workflow 中的顺序不能随意调换：

1. `scripts/update-youtube-ranking.js` — 产出原始抓取池。
2. 指标 / 时长 / 规范化脚本。
3. `scripts/validate-youtube-ranking.js` — **针对原始池**校验抓取量。
4. `scripts/apply-ranking-windows.js` — 派生 `week`、把 `month` 收窄成自然月。
5. `scripts/validate-ranking-windows.js` — 窗口门禁。
6. `scripts/archive-live-snapshot.js` → `validate-live-snapshots.js` → `write-ranking-groups.js`。
7. `npm run verify` — 发布门禁，通过后才提交。

`apply-ranking-windows.js` 是幂等的：检测到 `rankingWindows.applied === true` 会直接跳过；新抓取覆盖数据后会重新应用。

## 发布门禁

提交前必须跑通：

```bash
npm run check
npm run verify:pages
# 或等价于
npm run verify
```

`npm run check` 覆盖：JS 语法、生成物与源文件同步、blocklist、页面/资源接线、时间窗口、分组 JSON 一致性、快照不被删除。
`npm run verify:pages` 用 Playwright 验证：旧 localStorage 时间筛选被清除、汇总数字稳定且自洽、7 天 tab 与自然月窗口在真实页面上生效。

`.github/workflows/release-gate.yml` 是代码变更的门禁；`.github/workflows/youtube-ranking.yml` 提交数据前会再跑一次；`.github/workflows/youtube-ranking-live-verify.yml` 负责部署后线上验收。

## 提交范围

- 不要顺手重构无关文件。
- 不要修改与本次目标无关的历史数据或快照。
- 用户已有改动不能回退。
