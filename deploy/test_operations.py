"""Exercise the real release/restore scripts with disposable Docker command doubles."""
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parent
DOCKER = r'''#!/usr/bin/env python3
import json, os, pathlib, sys, tarfile, io
a=sys.argv[1:]
if a[0]=='cp':
 with open(os.environ['COMMAND_LOG'],'a') as f:f.write(json.dumps({'project':'keys','version':'','cmd':a})+'\n')
 if a[-1]=='-':
  with tarfile.open(fileobj=sys.stdout.buffer,mode='w|') as t:
   data=b'key-material';info=tarfile.TarInfo('key.xml');info.size=len(data);info.uid=1654;t.addfile(info,io.BytesIO(data))
 else:sys.stdin.buffer.read()
 sys.exit(0)
project=a[a.index('--project-name')+1]
env=pathlib.Path(a[a.index('--env-file')+1])
version=os.environ.get('WHEELHOUSE_VERSION') or next((x.split('=',1)[1] for x in env.read_text().splitlines() if x.startswith('WHEELHOUSE_VERSION=')), '')
cmd=a[a.index('--file')+2:]
with open(os.environ['COMMAND_LOG'],'a') as f:f.write(json.dumps({'project':project,'version':version,'cmd':cmd})+'\n')
if cmd[0]=='ps':
 if os.environ.get('FRESH')!='1':print('api-container' if cmd[-1]=='api' else 'db-container')
elif cmd[0]=='exec':
 if 'psql' in cmd:print('1048576')
 elif 'pg_dump' in cmd:
  if os.environ.get('FAIL_DUMP')==project:sys.exit(1)
  sys.stdout.write('database-snapshot')
 elif 'pg_restore' in cmd:
  if not sys.stdin.read():sys.exit(2)
  if '--list' in cmd:print('valid archive')
elif cmd[0]=='cp':
 if cmd[-2].startswith('api:'):
  p=pathlib.Path(cmd[-1]);p.mkdir();(p/'key.xml').write_text('encrypted-key-material')
elif cmd[0]=='up' and '--detach' in cmd and os.environ.get('FAIL_START')==project:sys.exit(1)
'''
# Health checks succeed; the metadata server hands out a token; uploads land in UPLOADS.
CURL = r'''#!/usr/bin/env python3
import os, pathlib, sys, urllib.parse
a=sys.argv[1:]
url=a[-1]
with open(os.environ['COMMAND_LOG'],'a') as f:f.write(__import__('json').dumps({'project':'curl','version':'','cmd':a})+'\n')
if 'metadata.google.internal' in url:
 print('{"access_token":"secret-token","expires_in":3599,"token_type":"Bearer"}')
elif url.startswith('https://storage.googleapis.com/upload/'):
 if os.environ.get('FAIL_UPLOAD'):sys.exit(22)
 header=sys.stdin.read()
 assert header=='Authorization: Bearer secret-token\n', header
 query=urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
 assert query['ifGenerationMatch']==['0']
 source=next(x[1:] for x in a if x.startswith('@/'))
 target=pathlib.Path(os.environ['UPLOADS'])/query['name'][0]
 target.parent.mkdir(parents=True,exist_ok=True)
 target.write_bytes(pathlib.Path(source).read_bytes())
'''

class OperationsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        for name, content in [('docker', DOCKER), ('curl', CURL), ('sleep', '#!/bin/sh\nexit 0\n')]:
            p = self.bin / name
            p.write_text(content)
            p.chmod(0o755)
        self.log = self.root / 'commands.jsonl'
        self.uploads = self.root / 'uploads'
        self.env = dict(os.environ, PATH=f'{self.bin}:{os.environ["PATH"]}', WHEELHOUSE_ROOT=str(self.root), COMMAND_LOG=str(self.log), UPLOADS=str(self.uploads))
        (self.root / 'compose.yaml').write_text('old-compose')
        (self.root / 'compose.candidate.yaml').write_text('new-compose')
        self.env['WHEELHOUSE_COMPOSE'] = str(self.root / 'compose.candidate.yaml')
        for index, name in enumerate(['a', 'b']):
            d = self.root / name
            d.mkdir()
            (d / '.env').write_text(f'WHEELHOUSE_VERSION=v0.1.1\nWHEELHOUSE_HTTP_PORT={8100+index}\nWHEELHOUSE_MODE=Demo\nWHEELHOUSE_DB_PASSWORD=never-print-this\n')

    def run_script(self, script, *args, **env):
        return subprocess.run(['bash', str(SCRIPTS / script), *args], env=dict(self.env, **env), text=True, capture_output=True)

    def commands(self):
        return [json.loads(x) for x in self.log.read_text().splitlines()] if self.log.exists() else []

    def docker_commands(self):
        return [c for c in self.commands() if c['project'] != 'curl']

    def backup(self, name='a'):
        return next((self.root / 'backups').glob(f'*/{name}'))

    def test_all_backups_precede_any_migration(self):
        result = self.run_script('deploy.sh', 'v0.2.0')
        self.assertEqual(result.returncode, 0, result.stderr)
        commands = self.docker_commands()
        dumps = [i for i,c in enumerate(commands) if 'pg_dump' in c['cmd']]
        starts = [i for i,c in enumerate(commands) if c['cmd'][0]=='up' and '--detach' in c['cmd']]
        self.assertEqual(len(dumps), 2)
        self.assertLess(max(dumps), min(starts))
        for name in ['a','b']:
            b = self.backup(name)
            self.assertTrue((b/'COMPLETE').exists())
            self.assertIn('v0.1.1', (b/'instance.env').read_text())
            self.assertEqual((b/'compose.yaml').read_text(), 'old-compose')
            self.assertTrue((b/'keys.tar').exists())
            self.assertEqual(b.stat().st_mode & 0o077, 0)
        self.assertEqual((self.root/'compose.yaml').read_text(), 'new-compose')
        self.assertEqual(len((self.root/'release-smoke.tsv').read_text().splitlines()), 2)
        self.assertNotIn('never-print-this', result.stdout+result.stderr)

    def test_demo_goes_first_and_family_keeps_its_version_until_its_turn(self):
        env = self.root/'b/.env'
        env.write_text(env.read_text().replace('WHEELHOUSE_MODE=Demo', 'WHEELHOUSE_MODE=Family'))
        result = self.run_script('deploy.sh', 'v0.2.0', 'Demo')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(any(c['project']=='wheelhouse-b' and c['cmd'][0] in ['pull','stop','up'] for c in self.docker_commands()))
        self.assertIn('WHEELHOUSE_VERSION=v0.1.1', env.read_text())
        self.assertEqual((self.root/'b/recovery-compose.yaml').read_text(), 'old-compose')
        self.assertEqual((self.root/'release-smoke.tsv').read_text().split('\t')[0], 'a')
        self.log.unlink()
        result = self.run_script('deploy.sh', 'v0.2.0', 'Family')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.backup('b')/'compose.yaml').read_text(), 'old-compose')
        self.assertFalse(any(c['project']=='wheelhouse-a' for c in self.docker_commands()))
        self.assertIn('WHEELHOUSE_VERSION=v0.2.0', env.read_text())
        self.assertFalse((self.root/'b/recovery-compose.yaml').exists())
        self.assertEqual(len((self.root/'release-smoke.tsv').read_text().splitlines()), 1)

    def test_a_mode_without_instances_deploys_nothing(self):
        result = self.run_script('deploy.sh', 'v0.2.0', 'Family')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.docker_commands())
        self.assertEqual((self.root/'release-smoke.tsv').read_text(), '')

    def test_failed_backup_resumes_old_instances_without_migration(self):
        result = self.run_script('deploy.sh', 'v0.2.0', FAIL_DUMP='wheelhouse-b')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.root/'compose.yaml').read_text(), 'old-compose')
        self.assertFalse((self.backup('b')/'COMPLETE').exists())
        starts = [c for c in self.docker_commands() if c['cmd'][0]=='up']
        self.assertEqual(len(starts), 2)
        self.assertTrue(all(c['version']=='v0.1.1' for c in starts))

    def test_startup_failure_never_restarts_old_api_on_new_database(self):
        result = self.run_script('deploy.sh', 'v0.2.0', FAIL_START='wheelhouse-a')
        self.assertNotEqual(result.returncode, 0)
        commands = self.docker_commands()
        a = [c for c in commands if c['project']=='wheelhouse-a']
        self.assertEqual(a[-1]['cmd'], ['stop','web','api'])
        self.assertFalse(any(c['cmd'][0]=='up' and c['version']=='v0.1.1' for c in a))
        self.assertTrue(any(c['project']=='wheelhouse-b' and c['cmd'][0]=='up' and c['version']=='v0.1.1' for c in commands))

    def test_first_deploy_is_explicitly_not_restorable(self):
        result = self.run_script('deploy.sh', 'v0.2.0', FRESH='1')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.backup()/'FIRST_DEPLOY').exists())
        self.assertFalse((self.backup()/'COMPLETE').exists())

    def test_restore_requires_review_and_valid_integrity(self):
        self.assertEqual(self.run_script('deploy.sh','v0.2.0').returncode, 0)
        self.log.unlink()
        result = self.run_script('restore.sh','a',str(self.backup()))
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.docker_commands())
        (self.backup()/'database.dump').write_text('corrupted')
        result = self.run_script('restore.sh','a',str(self.backup()),'--confirm-data-loss')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.docker_commands())

    def test_restore_replaces_database_before_starting_old_api(self):
        self.assertEqual(self.run_script('deploy.sh','v0.2.0').returncode, 0)
        self.log.unlink()
        result = self.run_script('restore.sh','a',str(self.backup()),'--confirm-data-loss')
        self.assertEqual(result.returncode, 0, result.stderr)
        commands = [c['cmd'] for c in self.docker_commands()]
        drop = next(i for i,c in enumerate(commands) if 'dropdb' in c)
        restore = next(i for i,c in enumerate(commands) if 'pg_restore' in c)
        api = next(i for i,c in enumerate(commands) if c[0]=='up' and '--detach' in c)
        self.assertLess(commands.index(['stop','web','api']), drop)
        self.assertLess(drop, restore)
        self.assertLess(restore, api)
        self.assertIn('v0.1.1',(self.root/'a/.env').read_text())
        self.assertEqual((self.root/'a/recovery-compose.yaml').read_text(),'old-compose')

    def test_invalid_version_never_calls_docker(self):
        self.assertNotEqual(self.run_script('deploy.sh','bad-version').returncode,0)
        self.assertFalse(self.docker_commands())

    def test_low_space_never_pulls_images_or_stops_writers(self):
        (self.root/'storage-policy.json').write_text('{"minimum_free_gib":10000}')
        result = self.run_script('deploy.sh','v0.2.0')
        self.assertNotEqual(result.returncode,0)
        self.assertIn('Insufficient disk space',result.stderr)
        self.assertFalse(any(c['cmd'][0] in ['pull','stop','up'] for c in self.docker_commands()))

    def configure_backups(self):
        (self.root/'backup.env').write_text('WHEELHOUSE_BACKUP_BUCKET=example-wheelhouse-backups\n')

    def test_nightly_backup_uploads_a_restorable_snapshot_without_stopping_writers(self):
        self.configure_backups()
        result = self.run_script('nightly-backup.sh')
        self.assertEqual(result.returncode, 0, result.stderr)
        archives = sorted(p.relative_to(self.uploads).as_posix() for p in self.uploads.rglob('*.tar'))
        self.assertEqual([a.split('/')[0] for a in archives], ['a', 'b'])
        self.assertFalse(any(c['cmd'][0] in ['stop', 'up'] for c in self.docker_commands()))
        extracted = self.root/'restore'
        extracted.mkdir()
        with tarfile.open(self.uploads/archives[0]) as archive:
            archive.extractall(extracted, filter='data')
        snapshot = extracted/'a'
        self.assertTrue((snapshot/'COMPLETE').exists())
        self.assertEqual((snapshot/'compose.yaml').read_text(), 'old-compose')
        self.assertEqual(subprocess.run(['sha256sum', '--check', '--quiet', 'SHA256SUMS'], cwd=snapshot).returncode, 0)
        self.assertTrue((self.root/'offsite-backup.last').exists())
        self.assertFalse(list(self.root.glob('.nightly-*')))
        self.assertNotIn('secret-token', result.stdout+result.stderr+self.log.read_text())
        self.assertNotIn('never-print-this', result.stdout+result.stderr)
        # The downloaded snapshot restores through the same script as a release snapshot.
        self.log.unlink()
        restored = self.run_script('restore.sh', 'a', str(snapshot), '--confirm-data-loss')
        self.assertEqual(restored.returncode, 0, restored.stderr)

    def test_nightly_backup_without_a_bucket_does_nothing(self):
        result = self.run_script('nightly-backup.sh')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('not configured', result.stderr)
        self.assertFalse(self.commands())

    def test_one_failed_instance_still_backs_up_the_others(self):
        self.configure_backups()
        result = self.run_script('nightly-backup.sh', FAIL_DUMP='wheelhouse-a')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual([p.parent.name for p in self.uploads.rglob('*.tar')], ['b'])
        self.assertFalse((self.root/'offsite-backup.last').exists())

    def test_failed_upload_fails_the_backup(self):
        self.configure_backups()
        result = self.run_script('nightly-backup.sh', FAIL_UPLOAD='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root/'offsite-backup.last').exists())

    def test_release_warns_without_off_server_backups(self):
        result = self.run_script('deploy.sh', 'v0.2.0')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('off-server backups are not configured', result.stderr)
        self.configure_backups()
        self.assertEqual(self.run_script('nightly-backup.sh').returncode, 0)
        result = self.run_script('deploy.sh', 'v0.2.1')
        self.assertNotIn('off-server', result.stderr)

if __name__ == '__main__':
    unittest.main()
