import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const root = resolve('dist/web/browser');
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.ico': 'image/x-icon',
};
createServer(async (request, response) => {
  const path = resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
  if (!path.startsWith(root + sep) && path !== root) {
    response.writeHead(403).end();
    return;
  }
  try {
    let body;
    let type = types[extname(path)];
    try {
      body = await readFile(path);
    } catch {
      body = await readFile(resolve(root, 'index.html'));
      type = 'text/html';
    }
    response.writeHead(200, { 'Content-Type': type ?? 'application/octet-stream' }).end(body);
  } catch {
    response.writeHead(500).end();
  }
}).listen(8123, '127.0.0.1');
