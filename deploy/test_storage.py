from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import fcntl
import storage

class StorageTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        (self.root/'backups').mkdir()

    def snapshot(self, stamp, version='v0.1.1'):
        run = self.root/'backups'/f'{stamp}-v0.2.0-123'
        instance = run/'demo'
        instance.mkdir(parents=True)
        (instance/'instance.env').write_text(f'WHEELHOUSE_VERSION={version}\n')
        return run

    def test_age_is_utc_creation_time_not_modified_time(self):
        old = self.snapshot('20261001T000000Z')
        boundary = self.snapshot('20261006T000000Z')
        recent = self.snapshot('20261019T000000Z')
        now = datetime(2026,10,20,tzinfo=timezone.utc)
        self.assertEqual(storage.expire_backups(self.root,14,now),1)
        self.assertFalse(old.exists())
        self.assertTrue(boundary.exists())
        self.assertTrue(recent.exists())

    def test_last_and_failed_backups_also_expire_after_retention(self):
        old = self.snapshot('20261001T000000Z')
        self.assertEqual(storage.expire_backups(self.root,14,datetime(2026,10,20,tzinfo=timezone.utc)),1)
        self.assertFalse(old.exists())

    def test_unknown_directories_and_symlink_targets_are_not_deleted(self):
        outside = self.root/'keep'
        outside.mkdir()
        (outside/'data').write_text('keep')
        (self.root/'backups'/'20200101T000000Z-v0.1.0-1').symlink_to(outside,target_is_directory=True)
        unknown = self.root/'backups'/'manual-copy'
        unknown.mkdir()
        storage.expire_backups(self.root,14)
        self.assertTrue((outside/'data').exists())
        self.assertTrue(unknown.exists())

    def test_policy_is_configurable_and_rejects_invalid_values(self):
        policy = self.root/'storage-policy.json'
        policy.write_text('{"retention_days":7,"minimum_free_gib":3}')
        self.assertEqual(storage.policy(self.root)['retention_days'],7)
        for value in [0,-1,True,'14']:
            policy.write_text(json.dumps({'retention_days':value}))
            with self.assertRaises(ValueError):storage.policy(self.root)

    def test_space_guard_reserves_backup_budget_in_addition_to_floor(self):
        with patch.object(storage.shutil,'disk_usage',return_value=SimpleNamespace(free=3*storage.GIB)):
            storage.check_space(self.root,storage.GIB)
            with self.assertRaises(RuntimeError):storage.check_space(self.root,storage.GIB+1)

    def test_busy_deploy_or_restore_prevents_cleanup(self):
        with (self.root/'operations.lock').open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            with patch.object(storage,'expire_backups') as expire, patch.object(storage,'prune_images') as prune:
                storage.cleanup(self.root)
                expire.assert_not_called()
                prune.assert_not_called()

    def test_image_cleanup_protects_all_containers_and_retained_versions(self):
        self.snapshot('20261019T000000Z','v0.1.1')
        instance = self.root/'demo'
        instance.mkdir()
        (instance/'.env').write_text('WHEELHOUSE_VERSION=v0.2.0\n')
        repo = 'ghcr.io/natezimm/wheelhouse-api'
        images = [
            {'Repository':repo,'Tag':'v0.1.1','ID':'backup'},
            {'Repository':repo,'Tag':'v0.2.0','ID':'configured'},
            {'Repository':repo,'Tag':'v0.0.9','ID':'stopped-container'},
            {'Repository':repo,'Tag':'v0.0.8','ID':'unused'},
            {'Repository':'other-app','Tag':'v0.0.8','ID':'other'},
            {'Repository':repo,'Tag':'<none>','ID':'dangling'},
        ]
        calls=[]
        def command(*args):
            calls.append(args)
            if args[1:]==('ps','-aq'):return 'container'
            if args[1]=='inspect':return 'stopped-container'
            if args[1:3]==('image','ls'):return '\n'.join(map(json.dumps,images))
            return ''
        with patch.object(storage,'command',side_effect=command):
            self.assertEqual(storage.prune_images(self.root),1)
        removals=[c for c in calls if c[1:3]==('image','rm')]
        self.assertEqual(removals,[('docker','image','rm',repo+':v0.0.8')])

if __name__=='__main__':unittest.main()
