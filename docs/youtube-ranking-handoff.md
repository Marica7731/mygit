# YouTube 排行页交接文档

## 当前状态

本仓库用于发布 YouTube 歌枠 / 弾き語り排行静态页面。

已完成：

- GitHub connector 写入 `Marica7731/mygit` 已验证成功。
- 仓库已初始化 `main` 分支。
- 已添加 `README.md`。
- 已添加 `CNAME`，目标域名为 `ytb.culua.com`。
- 已添加占位首页 `index.html`。
- 已添加本交接文档。

尚未完成：

- 未实现 YouTube 抓取脚本。
- 未实现排行数据 JSON。
- 未实现直播 / 今日 / 本月三个正式静态页面。
- 未创建定时更新 workflow。
- GitHub Pages 设置和 DNS 生效状态需要在网页端确认。

## 仓库信息

| 项目 | 值 |
| --- | --- |
| GitHub 仓库 | `https://github.com/Marica7731/mygit` |
| owner/repo | `Marica7731/mygit` |
| 默认分支 | `main` |
| 自定义域名 | `ytb.culua.com` |
| CNAME 文件 | `CNAME` |
| Pages 源建议 | `Deploy from a branch`，`main` / root |

## Cloudflare DNS 路径

在 Cloudflare 控制台：

```text
culua.com -> DNS -> DNS 记录 -> 添加记录
```

建议记录：

```text
类型: CNAME
名称: ytb
目标: Marica7731.github.io
代理状态: 已代理 / 橙云
TTL: 自动
```

说明：

- `ytb.culua.com` 是 `ytb` 子域名。
- CNAME 目标不要写 `/mygit`，只写 `Marica7731.github.io`。
- 橙云可以使用；若 GitHub Pages 初次校验失败，可临时切灰云通过校验后再开橙云。
- DNS 生效可能需要几分钟到 24 小时。

## GitHub Pages 设置路径

在 GitHub 网页端：

```text
Marica7731/mygit -> Settings -> Pages
```

设置：

```text
Source: Deploy from a branch
Branch: main
Folder: / (root)
Custom domain: ytb.culua.com
Enforce HTTPS: 等 DNS check 通过后勾选
```

如果页面提示 custom domain 未通过：

1. 先确认 Cloudflare DNS 记录存在。
2. 等待 DNS 生效。
3. 必要时先把 Cloudflare 记录从橙云切到灰云。
4. GitHub Pages 通过后再切回橙云。

## 换设备开发命令

```powershell
git clone https://github.com/Marica7731/mygit.git
cd mygit
git switch -c codex/ytb-ranking-pages origin/main
```

后续建议在 `codex/ytb-ranking-pages` 开发，不直接在 `main` 上写正式实现。

## 参考仓库

YouTube 插件参考仓库：

```text
C:\Users\终焉\Documents\Codex\chrome_ytb_plugin
```

用途：只参考 YouTube 搜索结果页抓取逻辑。

重点文件：

| 文件 | 用途 | 注意点 |
| --- | --- | --- |
| `src/content.js` | 自动滚动和页面加载 | 插件默认自动加载目标是 `100` |
| `src/popup.js` | 插件收集入口 | `MAX_ITEMS = 1000` |
| `src/extractor.js` | DOM 字段抽取 | 收集 limit 最高 cap 到 `1500` |

注意：插件当前会过滤 `即将开始` / upcoming 结果，但直播页需求需要保留直播预约，所以不能直接照搬过滤逻辑。

## 目标页面

计划实现 3 个页面：

| 页面 | 内容 |
| --- | --- |
| 直播页 | 歌枠直播/预约 + 弾き語り直播/预约 |
| 今日热度页 | 今日歌枠热度 + 今日弾き語り热度 |
| 本月热度页 | 本月歌枠热度 + 本月弾き語り热度 |

搜索源：

| 分组 | 关键词 | URL |
| --- | --- | --- |
| live | 歌枠 | `https://www.youtube.com/results?search_query=%E6%AD%8C%E6%9E%A0&sp=CAASAkAB` |
| live | 弾き語り | `https://www.youtube.com/results?search_query=%E5%BC%BE%E3%81%8D%E8%AA%9E%E3%82%8A&sp=CAASAkAB` |
| today | 歌枠 | `https://www.youtube.com/results?search_query=%E6%AD%8C%E6%9E%A0&sp=CAMSBAgCGAI%253D` |
| today | 弾き語り | `https://www.youtube.com/results?search_query=%E5%BC%BE%E3%81%8D%E8%AA%9E%E3%82%8A&sp=CAMSBAgCGAI%253D` |
| month | 歌枠 | `https://www.youtube.com/results?search_query=%E6%AD%8C%E6%9E%A0&sp=CAMSBggEEAEYAg%253D%253D` |
| month | 弾き語り | `https://www.youtube.com/results?search_query=%E5%BC%BE%E3%81%8D%E8%AA%9E%E3%82%8A&sp=CAMSBggEEAEYAg%253D%253D` |

## 建议实现文件清单

| 文件路径 | 文件用途 | 主要职责 | 与其他文件关系 |
| --- | --- | --- | --- |
| `scripts/update-youtube-ranking.js` | 抓取脚本 | Playwright 打开 6 个搜索 URL，滚动加载并抽取字段 | workflow 调用，输出 JSON |
| `data/youtube-ranking.json` | 静态数据 | 保存直播、今日、本月排行和更新时间 | 前端页面读取 |
| `live.html` | 直播页 | 展示直播和预约结果 | 读取 JSON 的 `live` 分组 |
| `today.html` | 今日热度页 | 展示今日排行 | 读取 JSON 的 `today` 分组 |
| `month.html` | 本月热度页 | 展示本月排行 | 读取 JSON 的 `month` 分组 |
| `.github/workflows/youtube-ranking.yml` | 定时更新 | 安装 Node/Playwright，运行抓取脚本，提交数据 | 使用 `GITHUB_TOKEN` |
| `README.md` | 项目说明 | 说明功能、运行、测试和文件清单 | 面向后续维护者 |

## 推荐配置

```text
YTB_RANKING_TARGET=300
YTB_RANKING_LIMIT=1000
YTB_RANKING_LOCALE=ja-JP
YTB_RANKING_REGION=JP
```

## 注意事项

- 不要提交个人 YouTube cookie。
- 如未来必须用登录态，只能放 GitHub Secrets。
- v1 先做无登录公开抓取。
- 排序以 YouTube 搜索页面展示顺序为准，不在前端二次排序。
- 定时更新不要过频，建议先每天 2 到 4 次或手动触发。
