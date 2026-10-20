#!/usr/bin/env python3
"""Bound local release storage; never prune volumes or unrelated application images."""
import argparse
from datetime import datetime, timedelta, timezone
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

VERSION = re.compile(r'^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.]+)?$')
RUN = re.compile(r'^(\d{8}T\d{6}Z)-v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.]+)?-\d+$')
REPOS = {'ghcr.io/natezimm/wheelhouse-api', 'ghcr.io/natezimm/wheelhouse-web'}
GIB = 1024 ** 3

def policy(root):
    settings = {'retention_days': 14, 'minimum_free_gib': 2}
    path = root / 'storage-policy.json'
    if path.exists():
        supplied = json.loads(path.read_text())
        if not isinstance(supplied, dict) or supplied.keys() - settings.keys():
            raise ValueError('Unknown storage policy setting')
        settings.update(supplied)
    for name, maximum in [('retention_days', 3650), ('minimum_free_gib', 10000)]:
        value = settings[name]
        if type(value) is not int or not 1 <= value <= maximum:
            raise ValueError(f'{name} must be an integer from 1 to {maximum}')
    return settings

def check_space(root, backup_bytes):
    if backup_bytes < 0:
        raise ValueError('Backup size cannot be negative')
    required = policy(root)['minimum_free_gib'] * GIB + backup_bytes
    free = shutil.disk_usage(root).free
    if free < required:
        raise RuntimeError(f'Insufficient disk space: {free / GIB:.2f} GiB free, {required / GIB:.2f} GiB required. Expire backups or expand the disk before retrying.')
    print(f'Storage preflight: {free / GIB:.2f} GiB free; {required / GIB:.2f} GiB required')

def expire_backups(root, days, now=None):
    backups = root / 'backups'
    if backups.is_symlink():
        raise ValueError('Refusing a symlinked backups directory')
    if not backups.exists():
        return 0
    cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=days)
    removed = 0
    for directory in backups.iterdir():
        match = RUN.fullmatch(directory.name)
        if directory.is_symlink() or not directory.is_dir() or not match:
            continue
        created = datetime.strptime(match[1], '%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc)
        if created < cutoff:
            shutil.rmtree(directory)
            removed += 1
    print(f'Expired {removed} release backup(s) older than {days} days')
    return removed

def command(*args):
    return subprocess.run(args, check=True, text=True, capture_output=True).stdout

def prune_images(root):
    versions = set()
    # All retained backup environments protect the images needed for recovery.
    files = list(root.glob('*/.env')) + list((root / 'backups').rglob('instance.env'))
    for path in files:
        for line in path.read_text().splitlines():
            if line.startswith('WHEELHOUSE_VERSION='):
                value = line.split('=', 1)[1]
                if VERSION.fullmatch(value):
                    versions.add(value)
                elif value:
                    raise ValueError('Cannot safely identify a protected image version')
    containers = command('docker', 'ps', '-aq').split()
    protected_ids = set(command('docker', 'inspect', '--format', '{{.Image}}', *containers).split()) if containers else set()
    images = [json.loads(line) for line in command('docker', 'image', 'ls', '--no-trunc', '--format', '{{json .}}').splitlines() if line]
    removed = 0
    for image in images:
        repo, tag, image_id = image['Repository'], image['Tag'], image['ID']
        if repo in REPOS and VERSION.fullmatch(tag) and tag not in versions and image_id not in protected_ids:
            # No --force: Docker also refuses an image still needed by a container.
            command('docker', 'image', 'rm', f'{repo}:{tag}')
            removed += 1
    print(f'Removed {removed} unused Wheelhouse image tag(s)')
    return removed

def cleanup(root):
    settings = policy(root)
    with (root / 'operations.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('Deployment or recovery active; cleanup deferred')
            return
        expire_backups(root, settings['retention_days'])
        prune_images(root)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['check', 'cleanup'])
    parser.add_argument('--backup-bytes', type=int, default=0)
    args = parser.parse_args()
    root = Path(os.environ.get('WHEELHOUSE_ROOT', str(Path.home() / 'wheelhouse'))).resolve()
    if args.action == 'check':
        check_space(root, args.backup_bytes)
    else:
        cleanup(root)

if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        # Never print subprocess output: Docker/configuration may contain secrets.
        print(str(error) if not isinstance(error, subprocess.CalledProcessError) else 'Storage maintenance command failed; inspect the VM before retrying', file=__import__('sys').stderr)
        raise SystemExit(1)
