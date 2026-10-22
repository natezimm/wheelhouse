import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const scenario of ['demo', 'family', 'old-ui', 'missing-wall-event', 'runtime-error', 'api-error']) {
  test(`Smoke contract: ${scenario}`, async () => {
    const family = scenario === 'family';
    const server = createServer((req, res) => {
      const path = new URL(req.url, 'http://localhost').pathname;
      res.setHeader('Content-Type', path.startsWith('/api') || path === '/health' ? 'application/json' : 'text/html');
      if (path === '/health') return res.end('{}');
      if (path === '/api/session') return res.end(JSON.stringify({mode: family ? 'Family' : 'Demo'}));
      if (path === '/api/family') { res.statusCode = family ? 401 : 200; return res.end('{}'); }
      if (path === '/api/calendar') {
        res.statusCode = scenario === 'api-error' ? 500 : 200;
        return res.end(JSON.stringify({events:[{title:'Fictional calendar event'}]}));
      }
      if (path === '/calendar' && scenario !== 'old-ui') { res.writeHead(302, { Location: '/' }); return res.end(); }
      const nav = '<nav aria-label="Sections">' + [['Calendar','/'],['Settings','/settings']].map(([name,href]) => `<a href="${href}">${name}</a>`).join('') + '</nav>';
      let content = '<h1>Calendar</h1>';
      if (family) content = '<a href="/api/auth/google">Sign in with Google</a>';
      else if (scenario === 'old-ui') content = '<h1>Today</h1><app-today-events>Today content</app-today-events>';
      else if (path === '/') {
        content = '<h1>Today</h1>' + nav + '<app-agenda-list>Agenda</app-agenda-list>'
          + '<div role="group" aria-label="View"><button aria-pressed="false">Day</button><button id="week">Week</button><button onclick="document.getElementById(\'m\').hidden=false">Month</button></div>'
          + '<app-phone-month id="m" hidden><div class="month">October</div></app-phone-month>'
          + '<script>document.getElementById("week").setAttribute("aria-pressed", String(innerWidth >= 768))</script>';
      }
      else if (path === '/wall') content += '<div id="events"></div><script>fetch("/api/calendar").then(r=>r.json()).then(s=>{'+ (scenario === 'missing-wall-event' ? '' : 'document.getElementById("events").textContent=s.events[0].title;')+'});</script>';
      if (scenario === 'runtime-error') content += '<script>throw new Error("fixture runtime failure")</script>';
      res.end('<!doctype html><html><body>' + content + '</body></html>');
    });
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    const cwd = await mkdtemp(join(tmpdir(),'wheelhouse-smoke-'));
    try {
      const result = await new Promise((resolve,reject) => {
        const child = spawn(process.execPath,[fileURLToPath(new URL('./smoke.mjs',import.meta.url))],{
          cwd, env:{...process.env,SMOKE_URL:`http://127.0.0.1:${server.address().port}`,SMOKE_MODE:family?'Family':'Demo',SMOKE_TIMEOUT_MS:'1500'}
        });
        let output='';
        child.stdout.on('data',d=>output+=d);
        child.stderr.on('data',d=>output+=d);
        child.on('error',reject);
        child.on('close',code=>resolve({code,output}));
      });
      if (['demo','family'].includes(scenario)) assert.equal(result.code,0,result.output);
      else assert.notEqual(result.code,0,result.output);
      assert(!result.output.includes('Fictional calendar event'),'Do not log API/browser content');
    } finally {
      await new Promise(resolve=>server.close(resolve));
      await rm(cwd,{recursive:true,force:true});
    }
  });
}
