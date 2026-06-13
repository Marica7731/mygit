# GitHub 操作方式说明

## 本次使用的 GitHub 操作方式

本次不是使用浏览器 cookie、GitHub cookie 或个人 token 直接操作仓库，而是通过 Codex 内置的 GitHub connector / GitHub App 操作 `Marica7731/mygit`。

已验证的能力：

- 读取仓库元信息。
- 确认仓库权限包含 `admin`、`push`、`pull`。
- 在空仓库中初始化 `main` 分支。
- 创建文件并提交到 `main`。
- 再次读取文件确认写入结果。

## 已写入仓库的文件

| 文件 | 用途 |
| --- | --- |
| `README.md` | 仓库说明和开发边界 |
| `CNAME` | GitHub Pages 自定义域名，内容为 `ytb.culua.com` |
| `index.html` | Pages 占位首页 |
| `docs/youtube-ranking-handoff.md` | YouTube 排行页开发交接文档 |
| `docs/github-connector-notes.md` | 本文件，说明 GitHub 操作方式 |

## 凭据说明

本仓库没有提交以下内容：

- GitHub cookie
- GitHub personal access token
- Cloudflare API token
- YouTube cookie
- `.env` 文件
- SSH 私钥

后续 GitHub Actions 自动提交建议使用 GitHub Actions 自带的 `GITHUB_TOKEN`，不要把实际 token 写入仓库。

## Mac 端开发建议

```bash
git clone https://github.com/Marica7731/mygit.git
cd mygit
git switch -c codex/ytb-ranking-pages origin/main
```

后续正式实现建议在 `codex/ytb-ranking-pages` 分支开发，确认无误后再合并到 `main`。
