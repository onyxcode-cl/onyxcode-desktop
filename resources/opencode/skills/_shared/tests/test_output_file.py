"""Fallos de entrega: mensajes claros y sin limpieza que dependa de borrar."""
from contextlib import ExitStack
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from output_file import write_output


class OutputFileTests(unittest.TestCase):
    def test_one_exclusive_open_and_one_write(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'entrega.pdf'
            with ExitStack() as stack:
                for op in ('rename', 'replace', 'unlink', 'remove'):
                    stack.enter_context(patch.object(os, op, side_effect=PermissionError('denegado')))
                writer = stack.enter_context(patch('builtins.open', wraps=open))
                write_output(path, b'documento terminado')
                writer.assert_called_once_with(path, 'xb')
            self.assertEqual(path.read_bytes(), b'documento terminado')
            self.assertEqual(list(Path(folder).iterdir()), [path])

    def test_permission_error_before_open_creates_nothing(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'entrega.xlsx'
            with patch('builtins.open', side_effect=PermissionError('denegado')):
                with self.assertRaisesRegex(OSError, 'No se creó ningún archivo de salida'):
                    write_output(path, b'libro terminado')
            self.assertEqual(os.listdir(folder), [])

    def test_short_write_or_device_error_is_never_reported_as_success(self):
        for result in (3, OSError('disco lleno')):
            with self.subTest(result=result):
                target = MagicMock()
                if isinstance(result, Exception):
                    target.write.side_effect = result
                else:
                    target.write.return_value = result
                opener = MagicMock()
                opener.__enter__.return_value = target
                with patch('builtins.open', return_value=opener), \
                        patch('os.unlink', side_effect=PermissionError('denegado')) as unlink:
                    with self.assertRaisesRegex(OSError, 'salida puede estar incompleta; no la entregues'):
                        write_output('entrega.xlsx', b'libro terminado')
                    target.write.assert_called_once_with(b'libro terminado')
                    unlink.assert_not_called()


if __name__ == '__main__':
    unittest.main()
