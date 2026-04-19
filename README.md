# MarinaNote

MarinaNote — 轻量、优雅的节点展示与备注管理面板（GPL-3.0）。

**重要**：镜像内**不包含**任何敏感配置或上传内容。所有敏感配置（管理员用户名/密码、管理路径、备注路径、session secret、端口等）**必须在容器启动时通过环境变量注入**。镜像中仅包含登录页、管理页、备注页与静态资源；用户上传的 HTML 存放在宿主卷 `public/uploads`。

## 必要环境变量（运行时必须提供）
- `ADMIN_USER` — 管理员用户名（必须）
- `ADMIN_PASS` — 管理员密码（必须）
- `ADMIN_PATH` — 管理面板路径（例如 `/manage`，必须）
- `NOTES_PATH` — 备注页面路径（例如 `/notes`，必须）
- `SESSION_SECRET` — express-session secret（必须）
- `PORT` — 容器监听端口（必须）

可选：
- `SITE_NAME` — 站点名称（默认 `MarinaNote`）
- `AUTH_MODE` — 验证模式：`hcaptcha` | `cf` | `f2a` | `none`（默认 `none`）
- `HCAPTCHA_SITEKEY` / `HCAPTCHA_SECRET` — hCaptcha sitekey 与 secret（若启用）
- `CF_TURNSTILE_SITEKEY` / `CF_TURNSTILE_SECRET` — Cloudflare Turnstile sitekey 与 secret（若启用）
- `F2A_SECRET` — F2A (TOTP) secret（base32，若启用）
- `MAX_UPLOAD_MB` — 上传大小限制（默认 2）

## 快速运行（示例）
1. 在宿主机设置环境变量（示例，生产请用更安全方式）：
```bash
export ADMIN_USER=admin
export ADMIN_PASS=yourpassword
export ADMIN_PATH=/manage
export NOTES_PATH=/notes
export SESSION_SECRET=some_long_secret
export PORT=3000
export SITE_NAME=MarinaNote
export AUTH_MODE=none
```
```
marinanote/
├─ .github/
│  └─ workflows/
│     └─ build-and-push.yml
├─ Dockerfile
├─ docker-compose.yml
├─ LICENSE
├─ README.md
├─ server/
│  ├─ package.json
│  └─ index.js
└─ public/
   ├─ login.html
   ├─ admin.html
   ├─ notes.html
   ├─ assets/
   │  ├─ style.css
   │  └─ app.js
   └─ uploads/   # 宿主卷挂载点（运行时创建）
```
