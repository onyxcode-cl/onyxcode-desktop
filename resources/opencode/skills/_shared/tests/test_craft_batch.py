import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import craft_batch


class CraftBatchTest(unittest.TestCase):
    def test_large_content_only_on_stdin(self):
        text = 'á' * 60000 + '\n--cmd file.open=$(false)'
        commands = ['text.insert=' + json.dumps({'text': text})]

        def fake(args, **kwargs):
            self.assertEqual(args, ['motor.exe' if os.name == 'nt' else '/motor', 'mcp'])
            self.assertNotIn(text, json.dumps(kwargs['env']))
            rows = json.loads(kwargs['input'].splitlines()[-1])['params']['arguments']['commands']
            self.assertEqual(rows[0]['params']['text'], text)
            return subprocess.CompletedProcess(args, 0, json.dumps({'id': 2, 'result': {'content': [
                {'type': 'text', 'text': json.dumps([{'ok': True} for _ in rows])}]}}), '')

        with patch.object(subprocess, 'run', side_effect=fake):
            self.assertEqual(craft_batch.run('motor.exe' if os.name == 'nt' else '/motor', commands, '/salida.docx', {}, 60).returncode, 0)

    def test_command_error_even_with_zero_exit_code(self):
        response = {'id': 2, 'result': {'content': [{'type': 'text', 'text': '[{"ok":false}]'}]}}
        with patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, json.dumps(response), '')):
            self.assertEqual(craft_batch.run('/motor', ['text.newParagraph'], '/salida.docx', {}, 60).returncode, 1)

    def test_missing_or_truncated_reply_is_failure(self):
        for stdout in ['', '{}', '{broken']:
            with patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, stdout, '')):
                self.assertEqual(craft_batch.run('/motor', ['text.newParagraph'], '/salida.docx', {}, 60).returncode, 1)


if __name__ == '__main__':
    unittest.main()
