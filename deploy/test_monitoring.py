"""Run monitoring.sh against a gcloud double that keeps what it creates in a JSON file."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parent / 'monitoring.sh'
GCLOUD = r'''#!/usr/bin/env python3
import json, os, re, sys
state_path = os.environ['GCLOUD_STATE']
state = json.load(open(state_path)) if os.path.exists(state_path) else {'channels': [], 'checks': [], 'policies': []}
a = sys.argv[1:]
def flag(name):
    for i, x in enumerate(a):
        if x.startswith(name + '='): return x.split('=', 1)[1]
        if x == name: return a[i + 1]
def listed(items, key):
    wanted = re.search(r'"([^"]+)"$', flag('--filter')).group(1)
    for item in items:
        if item[key] == wanted: print(item['name'])
if a[:2] == ['config', 'get-value']: print('test-project')
elif a[:2] == ['services', 'enable']: pass
elif a[:4] == ['beta', 'monitoring', 'channels', 'list']: listed(state['channels'], 'email')
elif a[:4] == ['beta', 'monitoring', 'channels', 'create']:
    email = flag('--channel-labels').split('=', 1)[1]
    state['channels'].append({'name': f'projects/test-project/notificationChannels/{len(state["channels"])}', 'email': email})
    print(state['channels'][-1]['name'])
elif a[:3] == ['monitoring', 'uptime', 'list-configs']: listed(state['checks'], 'displayName')
elif a[:3] == ['monitoring', 'uptime', 'create']:
    check = {'name': f'projects/test-project/uptimeCheckConfigs/check-{len(state["checks"])}', 'displayName': a[3], 'args': a[4:]}
    state['checks'].append(check)
    print(check['name'])
elif a[:3] == ['monitoring', 'policies', 'list']: listed(state['policies'], 'displayName')
elif a[:3] == ['monitoring', 'policies', 'create']:
    policy = json.load(open(flag('--policy-from-file')))
    policy['name'] = f'projects/test-project/alertPolicies/{len(state["policies"])}'
    state['policies'].append(policy)
else: sys.exit('unexpected gcloud ' + ' '.join(a))
json.dump(state, open(state_path, 'w'))
'''


class MonitoringTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        root = Path(self.dir.name)
        (root / 'bin').mkdir()
        gcloud = root / 'bin' / 'gcloud'
        gcloud.write_text(GCLOUD)
        gcloud.chmod(0o755)
        self.state = root / 'state.json'
        self.env = {**os.environ, 'PATH': f'{root / "bin"}:{os.environ["PATH"]}', 'GCLOUD_STATE': str(self.state)}

    def tearDown(self):
        self.dir.cleanup()

    def run_script(self, *args):
        return subprocess.run(['bash', str(SCRIPT), *args], env=self.env, capture_output=True, text=True)

    def test_each_domain_gets_checks_and_alerts_once(self):
        first = self.run_script('owner@example.com', 'demo.example.com', 'home.example.com')
        self.assertEqual(first.returncode, 0, first.stderr)
        state = json.loads(self.state.read_text())
        self.assertEqual(len(state['channels']), 1)
        self.assertEqual(
            [c['displayName'] for c in state['checks']],
            ['Wheelhouse demo.example.com up', 'Wheelhouse demo.example.com calendar',
             'Wheelhouse home.example.com up', 'Wheelhouse home.example.com calendar'])
        calendar = state['checks'][3]['args']
        self.assertIn('--matcher-content="calendar":"Healthy"', calendar)
        self.assertIn('--resource-labels=host=home.example.com,project_id=test-project', calendar)
        self.assertEqual(len(state['policies']), 6)
        down = state['policies'][3]
        self.assertEqual(down['displayName'], 'Wheelhouse home.example.com is down')
        self.assertIn('check_id="check-2"', down['conditions'][0]['conditionThreshold']['filter'])
        self.assertEqual(down['notificationChannels'], ['projects/test-project/notificationChannels/0'])
        behind = state['policies'][4]['conditions'][0]['conditionThreshold']
        self.assertIn('check_id="check-3"', behind['filter'])
        self.assertEqual(behind['duration'], '900s')

        again = self.run_script('owner@example.com', 'demo.example.com', 'home.example.com')
        self.assertEqual(again.returncode, 0, again.stderr)
        self.assertEqual(json.loads(self.state.read_text()), state)

    def test_it_refuses_something_that_is_not_a_domain(self):
        result = self.run_script('owner@example.com', 'home.example.com/x')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.state.exists())


if __name__ == '__main__':
    unittest.main()
