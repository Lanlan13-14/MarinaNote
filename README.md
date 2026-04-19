# MarinaNote
Simple and lightweight notes
Project Structure
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
