import unittest
from urllib.parse import quote, unquote

class ImportFilenameTests(unittest.TestCase):
    def test_unicode_filename_header_is_ascii_and_round_trips(self):
        name = '住宅ローン_Nスタ解説.mp4'
        encoded = quote(name, safe='')
        encoded.encode('latin-1')
        self.assertEqual(unquote(encoded), name)

if __name__ == '__main__':
    unittest.main()
