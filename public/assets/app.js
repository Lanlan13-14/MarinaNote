// Theme management: auto-detect system preference, listen for changes, allow manual override
(function(){
  const root = document.documentElement;
  const STORAGE_KEY = 'marinanote_theme';

  function applyTheme(theme) {
    if (theme === 'light') root.classList.add('light');
    else root.classList.remove('light');
  }

  // Determine initial theme:
  // 1. If user set preference in localStorage -> use it
  // 2. Else follow system preference (prefers-color-scheme)
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') {
    applyTheme(stored);
  } else {
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    applyTheme(prefersLight ? 'light' : 'dark');
  }

  // Listen to system preference changes and update only if user hasn't set explicit preference
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener ? mq.addEventListener('change', e => {
      const storedNow = localStorage.getItem(STORAGE_KEY);
      if (!storedNow) applyTheme(e.matches ? 'light' : 'dark');
    }) : mq.addListener(e => {
      const storedNow = localStorage.getItem(STORAGE_KEY);
      if (!storedNow) applyTheme(e.matches ? 'light' : 'dark');
    });
  }

  // Insert theme toggle button and wire manual override
  document.addEventListener('DOMContentLoaded', ()=>{
    const container = document.querySelector('.container');
    if (!container) return;
    const btn = document.createElement('button');
    btn.className = 'copy';
    btn.style.position = 'fixed';
    btn.style.right = '18px';
    btn.style.top = '18px';
    btn.style.zIndex = 9999;

    function updateBtnText() {
      const isLight = root.classList.contains('light');
      btn.textContent = isLight ? '浅色' : '深色';
    }

    updateBtnText();

    btn.addEventListener('click', ()=>{
      const isLight = root.classList.contains('light');
      if (isLight) {
        applyTheme('dark');
        localStorage.setItem(STORAGE_KEY, 'dark');
      } else {
        applyTheme('light');
        localStorage.setItem(STORAGE_KEY, 'light');
      }
      updateBtnText();
    });

    // Right-click clears user preference to restore system auto behavior
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      localStorage.removeItem(STORAGE_KEY);
      // apply system preference immediately
      const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
      applyTheme(prefersLight ? 'light' : 'dark');
      updateBtnText();
      // brief feedback
      btn.textContent = '已恢复系统';
      setTimeout(updateBtnText, 900);
    });

    document.body.appendChild(btn);
  });
})();

// Load config (site name, auth mode)
async function loadConfig(){
  try{
    const r = await fetch('/api/config');
    const cfg = await r.json();
    document.querySelectorAll('.site-name').forEach(el=>{
      el.textContent = cfg.site_name || 'MarinaNote';
    });
    // Render captcha widgets if on login page
    const authMode = cfg.auth_mode || 'none';
    const loginContainer = document.getElementById('captchaContainer');
    if (loginContainer){
      loginContainer.innerHTML = '';
      if (authMode === 'hcaptcha' && cfg.hcaptcha_sitekey){
        const div = document.createElement('div');
        div.className = 'h-captcha';
        div.setAttribute('data-sitekey', cfg.hcaptcha_sitekey);
        div.id = 'hcaptcha-widget';
        loginContainer.appendChild(div);
        const s = document.createElement('script');
        s.src = 'https://hcaptcha.com/1/api.js';
        s.async = true;
        document.head.appendChild(s);
      } else if (authMode === 'cf' && cfg.cf_sitekey){
        const div = document.createElement('div');
        div.className = 'cf-turnstile';
        div.setAttribute('data-sitekey', cfg.cf_sitekey);
        div.id = 'turnstile-widget';
        loginContainer.appendChild(div);
        const s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
        s.async = true;
        document.head.appendChild(s);
      } else if (authMode === 'f2a'){
        const label = document.createElement('label');
        label.textContent = '2FA Token';
        const input = document.createElement('input');
        input.id = 'f2a';
        input.type = 'text';
        input.placeholder = 'Enter 6-digit code';
        input.style.marginTop = '6px';
        input.style.width = '100%';
        loginContainer.appendChild(label);
        loginContainer.appendChild(input);
      } else {
        const p = document.createElement('div');
        p.className = 'small-muted';
        p.textContent = '验证已关闭';
        loginContainer.appendChild(p);
      }
    }
  }catch(e){
    console.warn('config load failed', e);
  }
}

// Copy helper
function bindCopyButtons(){
  document.querySelectorAll('.copy-btn').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const target = btn.dataset.target;
      const text = document.getElementById(target).textContent;
      try{
        await navigator.clipboard.writeText(text);
        btn.textContent = '已复制';
        setTimeout(()=>btn.textContent='复制',1200);
      }catch(e){
        btn.textContent='复制失败';
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', ()=>{
  loadConfig();
  bindCopyButtons();

  // Login logic (keeps same behavior)
  const loginBtn = document.getElementById('loginBtn');
  if (loginBtn){
    loginBtn.addEventListener('click', async ()=>{
      const user = document.getElementById('user').value;
      const pass = document.getElementById('pass').value;
      if (!user || !pass) return alert('请输入用户名和密码');
      document.getElementById('loader').style.display = 'block';
      loginBtn.disabled = true;

      let token = '';
      let f2a = '';
      try{
        const cfg = await (await fetch('/api/config')).json();
        const mode = cfg.auth_mode || 'none';
        if (mode === 'hcaptcha') {
          if (window.hcaptcha && document.getElementById('hcaptcha-widget')) {
            token = window.hcaptcha.getResponse();
          }
        } else if (mode === 'cf') {
          if (window.turnstile && document.getElementById('turnstile-widget')) {
            token = window.turnstile.getResponse();
          }
        } else if (mode === 'f2a') {
          f2a = document.getElementById('f2a') ? document.getElementById('f2a').value : '';
        }

        const payload = { user, pass };
        if (token) payload.token = token;
        if (f2a) payload.f2a = f2a;

        const r = await fetch('/api/login', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify(payload)
        });
        const j = await r.json();
        if (r.ok && j.redirect){
          setTimeout(()=> location.href = j.redirect, 700);
        } else {
          alert(j.error || '登录失败');
          document.getElementById('loader').style.display = 'none';
          loginBtn.disabled = false;
        }
      }catch(e){
        alert('网络错误');
        document.getElementById('loader').style.display = 'none';
        loginBtn.disabled = false;
      }
    });
  }

  // Admin upload
  const uploadForm = document.getElementById('uploadForm');
  if (uploadForm){
    uploadForm.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const file = document.getElementById('fileInput').files[0];
      if (!file) return alert('请选择 HTML 文件');
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload', { method:'POST', body: fd });
      if (!res.ok) {
        const j = await res.json().catch(()=>({error:'上传失败'}));
        return alert(j.error || '上传失败');
      }
      const j = await res.json();
      if (j.url){
        const iframe = document.getElementById('previewFrame');
        iframe.src = j.url;
        iframe.style.display = 'block';
      }
    });
  }

  // Save site config
  const saveCfgBtn = document.getElementById('saveConfig');
  if (saveCfgBtn){
    saveCfgBtn.addEventListener('click', async ()=>{
      const siteName = document.getElementById('siteName').value;
      const notesPath = document.getElementById('notesPath').value;
      const payload = { site_name: siteName, notes_path: notesPath };
      const res = await fetch('/api/save-config', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });
      if (res.ok) alert('已保存');
      else alert('保存失败');
    });
  }

  // Notes save & load
  const saveNotesBtn = document.getElementById('saveNotes');
  if (saveNotesBtn){
    saveNotesBtn.addEventListener('click', async ()=>{
      const content = document.getElementById('notesEditor').value;
      const res = await fetch('/api/save-notes', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ content })
      });
      if (res.ok) alert('备注已保存');
      else alert('保存失败');
    });
    (async ()=>{
      const r = await fetch('/api/notes-content');
      const j = await r.json();
      document.getElementById('notesEditor').value = j.content || '';
    })();
  }
});