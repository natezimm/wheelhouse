import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import uuid

source = Path(__file__).with_name('upgrade-postgres.py')
spec = importlib.util.spec_from_file_location('upgrade', source)
u = importlib.util.module_from_spec(spec)
spec.loader.exec_module(u)
os.umask(0o077)
for fail_cutover in (False, True):
    name = 'workspace-pg18-rehearsal-' + uuid.uuid4().hex[:8]
    with tempfile.TemporaryDirectory(prefix=name) as temp:
        root = Path(temp)
        compose_path = root / 'compose.yaml'
        config = {'name': name, 'services': {
            'db': {'image': 'postgres:17.11-bookworm', 'environment': {
                'POSTGRES_USER': 'migration', 'POSTGRES_DB': 'migration', 'POSTGRES_PASSWORD': 'test-only'},
                'volumes': ['db-data:/var/lib/postgresql/data']},
            'writer': {'image': 'postgres:17.11-bookworm', 'entrypoint': ['sleep', '3600']}
        }, 'volumes': {'db-data': {'name': '${' + u.VOLUME_VARIABLE + ':-' + name + '_db-data}'}}}
        compose_path.write_text(json.dumps(config))
        compose = ['docker', 'compose', '--project-directory', str(root), '-f', str(compose_path)]
        original_run = u.run
        volumes = [name + '_db-data', name + '_db-data-pg18']
        try:
            original_run(*compose, 'up', '-d')
            cid = original_run(*compose, 'ps', '-q', 'db').decode().strip()
            u.wait(cid, 'migration', 'migration')
            statement = '''CREATE TABLE parent(id serial PRIMARY KEY, label text NOT NULL, details jsonb);
            CREATE TABLE child(id serial PRIMARY KEY, parent_id int REFERENCES parent(id));
            INSERT INTO parent(label,details) VALUES ('Unicode résumé', '{"kept":true}'), ('second', '{}');
            INSERT INTO child(parent_id) VALUES(1);
            CREATE VIEW labels AS SELECT label FROM parent;'''
            original_run('docker', 'exec', cid, 'psql', '-U', 'migration', '-d', 'migration', '-v', 'ON_ERROR_STOP=1', '-c', statement)
            config['services']['db']['image'] = u.TARGET_IMAGE
            config['services']['db']['volumes'] = ['db-data:/var/lib/postgresql']
            compose_path.write_text(json.dumps(config))
            args = type('Args', (), {'directory': root, 'compose_file': 'compose.yaml', 'project_name': None,
                'target_volume': None, 'check': False, 'require_current': False})()
            if fail_cutover:
                def injected(*args, **kwargs):
                    if args[:2] == ('docker', 'compose') and 'up' in args and not any('rollback-compose.json' in str(a) for a in args):
                        raise RuntimeError('simulated cutover failure')
                    return original_run(*args, **kwargs)
                u.run = injected
            try:
                u.migrate(args)
                assert not fail_cutover
            except RuntimeError as error:
                if not fail_cutover or 'simulated' not in str(error):
                    raise
            finally:
                u.run = original_run
            current = original_run(*compose, 'ps', '-q', 'db').decode().strip()
            version = original_run('docker', 'exec', current, 'psql', '-U', 'migration', '-d', 'migration', '-Atc', 'SHOW server_version').decode().strip()
            assert version.startswith('17.' if fail_cutover else '18.'), version
            value = original_run('docker', 'exec', current, 'psql', '-U', 'migration', '-d', 'migration', '-Atc', "SELECT label FROM labels ORDER BY label").decode()
            assert 'Unicode résumé' in value and 'second' in value
            assert not fail_cutover or not (root / '.env').exists()
            original_run('docker', 'volume', 'inspect', volumes[0])
            writer = original_run(*compose, 'ps', '-q', 'writer').decode().strip()
            assert writer
            print('PASS:', 'automatic rollback with writer restart' if fail_cutover else 'PostgreSQL 17 -> 18 with data, JSON, keys, view and writer restart', flush=True)
        finally:
            u.run = original_run
            subprocess.run(compose + ['down', '--remove-orphans'], capture_output=True)
            subprocess.run(['docker', 'volume', 'rm', *volumes], capture_output=True)
