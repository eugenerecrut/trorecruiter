import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import scanner_agent


class FilePathForIdTests(unittest.TestCase):
    def test_accepts_generated_scan_id_inside_inbox(self):
        with tempfile.TemporaryDirectory() as directory:
            inbox = Path(directory) / "inbox"
            inbox.mkdir()
            scan_id = "a" * 32
            with patch.object(scanner_agent, "INBOX", inbox):
                self.assertEqual(
                    scanner_agent._file_path_for_id(scan_id),
                    inbox / f"{scan_id}.pdf",
                )

    def test_rejects_non_uuid_ids(self):
        for scan_id in ("../" + "a" * 29, "A" * 32, "a" * 31 + "\r"):
            with self.subTest(scan_id=scan_id):
                self.assertIsNone(scanner_agent._file_path_for_id(scan_id))

    def test_rejects_symlink_outside_inbox(self):
        with tempfile.TemporaryDirectory() as directory:
            inbox = Path(directory) / "inbox"
            inbox.mkdir()
            outside = Path(directory) / "outside.pdf"
            outside.write_bytes(b"not an inbox document")
            scan_id = "a" * 32
            (inbox / f"{scan_id}.pdf").symlink_to(outside)

            with patch.object(scanner_agent, "INBOX", inbox):
                self.assertIsNone(scanner_agent._file_path_for_id(scan_id))


if __name__ == "__main__":
    unittest.main()
