#!/usr/bin/env node
'use strict';

/**
 * taufran-draw-web —— 本地同源代理 + 静态站点
 *
 * 为什么需要它：ai.taufran.com 的 /api/draw/* 不返回 Access-Control-Allow-Origin，
 * 浏览器从 file:// 或 localhost 直接 fetch 会被 CORS 拦掉。这里把请求原样转发，
 * 前端始终与本站同源，图片和 JSON 都能正常读取。
 *
 * 用法：
 *   node server.js                 # http://127.0.0.1:5178
 *   PORT=8080 node server.js
 *   TAUFRAN_DIR=/path/to/taufran-draw node server.js
 */

const http = require('http');
const https = require('https');
const tls = require('tls');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 5178);
// 默认监听所有网卡，便于容器/反向代理部署；本地开发可用 HOST=127.0.0.1 收紧。
const HOST = process.env.HOST || '0.0.0.0';
// 优先用环境变量指定的 taufran-draw 目录，其次用随仓库携带的 config/，
// 这样在没有本地 skill 目录的服务器上也能直接跑起来。
const LOCAL_CONFIG_DIR = path.join(__dirname, 'config');
const TAUFRAN_DIR = pickTaufranDir(
  process.env.TAUFRAN_DIR,
  'D:\\taufran-draw\\taufran-draw',
  LOCAL_CONFIG_DIR
);
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_BASE = 'https://ai.taufran.com';
const MAX_BODY = 64 * 1024 * 1024;
const READ_TIMEOUT = 60 * 1000;
const WRITE_TIMEOUT = 180 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

/* ------------------------------------------------------------------ *
 * 线路与本地配置（直接复用 taufran-draw 包里的文件，保持与服务端同步）
 * ------------------------------------------------------------------ */

function readJsonFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// 依次挑选第一个含有 routes.json 的目录作为配置来源。
function pickTaufranDir(...candidates) {
  for (const dir of candidates) {
    if (!dir) continue;
    if (fs.existsSync(path.join(dir, 'routes.json'))) return dir;
  }
  return candidates[candidates.length - 1];
}

function loadSites() {
  const routes = readJsonFile(path.join(TAUFRAN_DIR, 'routes.json'), null);
  const sites = Array.isArray(routes && routes.sites) ? routes.sites : [];
  const list = sites
    .filter((s) => s && typeof s.baseUrl === 'string' && /^https:\/\//.test(s.baseUrl))
    .map((s) => ({ name: s.name || s.baseUrl, baseUrl: s.baseUrl.replace(/\/+$/, '') }));
  if (!list.length) list.push({ name: '国际线路', baseUrl: DEFAULT_BASE });
  return list;
}

function loadPresets() {
  return readJsonFile(path.join(TAUFRAN_DIR, 'output-presets.json'), null);
}

function loadVersion() {
  return readJsonFile(path.join(TAUFRAN_DIR, 'version.json'), null);
}

/* ------------------------------------------------------------------ *
 * 上游请求（自动识别系统代理 HTTPS_PROXY / HTTP_PROXY）
 * ------------------------------------------------------------------ */

const PROXY_URL =
  process.env.TAUFRAN_PROXY ||
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy ||
  '';

const NO_PROXY = String(process.env.NO_PROXY || process.env.no_proxy || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function shouldUseProxy(hostname) {
  if (!PROXY_URL) return false;
  const host = hostname.toLowerCase();
  return !NO_PROXY.some((p) => host === p || host.endsWith(p.startsWith('.') ? p : '.' + p) || host.endsWith('.' + p));
}

function connectViaProxy(hostname, port) {
  return new Promise((resolve, reject) => {
    let pu;
    try {
      pu = new URL(PROXY_URL);
    } catch (e) {
      reject(new Error('代理地址无效：' + PROXY_URL));
      return;
    }
    const rq = http.request({
      host: pu.hostname,
      port: Number(pu.port || 80),
      method: 'CONNECT',
      path: `${hostname}:${port}`,
      headers: { Host: `${hostname}:${port}` },
      timeout: 15000,
    });
    rq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`代理 CONNECT 失败（HTTP ${res.statusCode}）`));
        return;
      }
      resolve(socket);
    });
    rq.on('timeout', () => rq.destroy(new Error('代理连接超时')));
    rq.on('error', reject);
    rq.end();
  });
}

async function sendUpstream(req, base, targetPath, body) {
  let url;
  try {
    url = new URL(base + targetPath);
  } catch (e) {
    throw e;
  }

  const headers = { 'accept-encoding': 'identity', 'user-agent': 'taufran-draw-web/1.0' };
  for (const k of ['authorization', 'content-type', 'accept']) {
    if (req.headers[k]) headers[k] = req.headers[k];
  }
  if (body) headers['content-length'] = String(body.length);

  const isWrite = !(req.method === 'GET' || req.method === 'HEAD');
  const options = {
    hostname: url.hostname,
    port: url.port || 443,
    path: url.pathname + url.search,
    method: req.method,
    headers,
    timeout: isWrite ? WRITE_TIMEOUT : READ_TIMEOUT,
  };

  // 直连失败时自动回退走系统代理；默认优先跟随系统代理（与 curl 行为一致）
  const viaProxy = shouldUseProxy(url.hostname);
  const attempts = viaProxy ? ['proxy', 'direct'] : ['direct', 'proxy'].filter((m) => m === 'direct' || PROXY_URL);

  let lastError = null;
  for (const mode of attempts) {
    const result = await new Promise((resolve) => {
      let opts = options;
      let cleanup = () => {};
      try {
        if (mode === 'proxy') {
          connectViaProxy(url.hostname, url.port || 443)
            .then((raw) => {
              const tlsSocket = tls.connect({ socket: raw, servername: url.hostname });
              tlsSocket.on('error', () => raw.destroy());
              opts = Object.assign({}, options, {
                agent: false,
                createConnection: () => tlsSocket,
              });
              start(opts);
            })
            .catch((e) => resolve({ err: e }));
        } else {
          start(opts);
        }
      } catch (e) {
        resolve({ err: e });
      }

      function start(o) {
        let settled = false;
        const upstream = https.request(o, (res) => {
          if (!settled) {
            settled = true;
            res.setTimeout(0);
            resolve({ res });
          }
        });
        cleanup = () => {
          try {
            upstream.destroy();
          } catch {}
        };
        upstream.on('timeout', () => upstream.destroy(new Error('上游响应超时')));
        upstream.on('error', (e) => {
          if (!settled) {
            settled = true;
            resolve({ err: e });
          }
        });
        if (body) upstream.end(body);
        else upstream.end();
      }
    });

    if (result.res) return result.res;
    lastError = result.err;
  }

  throw lastError || new Error('上游连接失败');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function relayHeaders(upstreamHeaders) {
  const out = {};
  for (const [k, v] of Object.entries(upstreamHeaders)) {
    const key = k.toLowerCase();
    if (key === 'transfer-encoding' || key === 'connection' || key === 'keep-alive') continue;
    out[k] = v;
  }
  out['Cache-Control'] = 'no-store';
  return out;
}

async function handleProxy(req, res, urlObj) {
  const targetPath = urlObj.pathname + urlObj.search;
  const sites = loadSites();
  const allowed = sites.map((s) => s.baseUrl);

  const requested = String(req.headers['x-taufran-base'] || '').replace(/\/+$/, '');
  const envBase = String(process.env.TAUFRAN_BASE_URL || '').replace(/\/+$/, '');
  const primary = allowed.includes(requested)
    ? requested
    : allowed.includes(envBase)
      ? envBase
      : allowed[0];

  const isRead = req.method === 'GET' || req.method === 'HEAD';
  const candidates = isRead ? [primary, ...allowed.filter((b) => b !== primary)] : [primary];

  let body = null;
  if (!isRead) {
    try {
      body = await readBody(req);
    } catch (e) {
      res.writeHead(413, { 'Content-Type': MIME['.json'] });
      res.end(JSON.stringify({ ok: false, error: '请求体过大（上限 64MB）' }));
      return;
    }
  }

  let lastError = null;

  for (let i = 0; i < candidates.length; i += 1) {
    const base = candidates[i];
    const isLast = i === candidates.length - 1;
    try {
      const upstream = await sendUpstream(req, base, targetPath, body);
      const status = Number(upstream.statusCode) || 502;

      // 只读请求遇到 5xx 时换线再试；写入请求绝不重发，避免重复计费。
      if (isRead && status >= 500 && !isLast) {
        upstream.resume();
        lastError = new Error(`线路 ${base} 返回 HTTP ${status}`);
        continue;
      }

      res.writeHead(status, relayHeaders(upstream.headers));
      upstream.pipe(res);
      upstream.on('error', () => res.end());
      return;
    } catch (e) {
      lastError = e;
      if (!isRead) break; // 生成提交只尝试一次
    }
  }

  res.writeHead(502, { 'Content-Type': MIME['.json'] });
  res.end(
    JSON.stringify({
      ok: false,
      networkError: true,
      error: '无法连接 Taufran 服务，已尝试全部线路',
      detail: String((lastError && lastError.message) || lastError || ''),
    })
  );
}

/* ------------------------------------------------------------------ *
 * 本地接口
 * ------------------------------------------------------------------ */

function sendJson(res, status, data) {
  const buf = Buffer.from(JSON.stringify(data), 'utf8');
  res.writeHead(status, {
    'Content-Type': MIME['.json'],
    'Content-Length': String(buf.length),
    'Cache-Control': 'no-store',
  });
  res.end(buf);
}

function handleLocal(req, res, urlObj) {
  const route = urlObj.pathname;

  if (route === '/local/health') return sendJson(res, 200, { ok: true, port: PORT });

  if (route === '/local/config') {
    return sendJson(res, 200, {
      ok: true,
      sites: loadSites(),
      presets: loadPresets(),
      version: loadVersion(),
      dir: TAUFRAN_DIR,
      maxReferenceBytes: 1024 * 1024,
      maxReferenceEdge: 1536,
    });
  }

  res.writeHead(404, { 'Content-Type': MIME['.json'] });
  res.end(JSON.stringify({ ok: false, error: '未知的本地接口' }));
}

/* ------------------------------------------------------------------ *
 * 静态文件
 * ------------------------------------------------------------------ */

function serveStatic(req, res, urlObj) {
  let pathname = decodeURIComponent(urlObj.pathname);
  if (pathname === '/' || pathname === '') pathname = '/index.html';

  const filePath = path.join(PUBLIC_DIR, pathname);
  const normalized = path.normalize(filePath);
  if (!normalized.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': MIME['.txt'] });
    res.end('403');
    return;
  }

  fs.stat(normalized, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': MIME['.html'] });
      res.end('<h1>404</h1><p>文件不存在：' + pathname + '</p>');
      return;
    }
    const ext = path.extname(normalized).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': String(stat.size),
      'Cache-Control': ext === '.html' ? 'no-store' : 'max-age=60',
    });
    fs.createReadStream(normalized).pipe(res);
  });
}

/* ------------------------------------------------------------------ *
 * 启动
 * ------------------------------------------------------------------ */

const server = http.createServer((req, res) => {
  const started = Date.now();
  let urlObj;
  try {
    urlObj = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  } catch {
    res.writeHead(400);
    res.end('bad request');
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' });
    res.end();
    return;
  }

  const done = () => {
    const tag = urlObj.pathname.startsWith('/api/') ? 'proxy' : 'local';
    console.log(`[${tag}] ${req.method} ${urlObj.pathname} -> ${res.statusCode} ${Date.now() - started}ms`);
  };
  res.on('finish', done);

  if (urlObj.pathname.startsWith('/api/')) {
    handleProxy(req, res, urlObj).catch((e) => {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': MIME['.json'] });
      res.end(JSON.stringify({ ok: false, error: '代理异常', detail: String(e && e.message) }));
    });
    return;
  }

  if (urlObj.pathname.startsWith('/local/')) {
    handleLocal(req, res, urlObj);
    return;
  }

  serveStatic(req, res, urlObj);
});

server.listen(PORT, HOST, () => {
  const sites = loadSites();
  console.log('');
  console.log('  Taufran 绘图工作台');
  console.log(`  界面地址   http://${HOST}:${PORT}`);
  console.log(`  Skill 目录 ${TAUFRAN_DIR}`);
  console.log(`  可用线路   ${sites.map((s) => s.name).join(' / ')}`);
  console.log('');
});
