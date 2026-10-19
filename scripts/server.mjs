import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
http.createServer(async (req, res) => {
  try {
    const url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const testRoutes={'/__test/':'tests/browser.html','/__test/browser.mjs':'tests/browser.mjs','/__test/plan.xlsx':'.local/plan.xlsx'};
    const relative = process.argv.includes('--test') && testRoutes[url] ? testRoutes[url] : url === '/' ? 'public/index.html' : url.startsWith('/src/') ? url.slice(1) : 'public' + url;
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep) || relative.includes('..')) throw Error('Invalid path');
    const body = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(4173, '127.0.0.1', () => console.log('Local: http://127.0.0.1:4173'));
