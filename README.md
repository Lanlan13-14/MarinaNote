# MarinaNote
Simple and lightweight notes
Project Structure
```
MarinaNote/
├─ Dockerfile
├─ docker-compose.yml
├─ .env
├─ server/
│  ├─ package.json
│  └─ index.js
├─ public/
│  ├─ login.html        # 镜像内：登录页（和截图一致）
│  ├─ notes.html        # 镜像内：备注页（内置，可编辑）
│  ├─ admin.html        # 镜像内：管理界面（登录后使用）
│  ├─ assets/
│  │  ├─ style.css
│  │  └─ app.js
│  └─ uploads/          # 挂载卷：用户上传的首页与节点 HTML 存放处（宿主卷）
```
