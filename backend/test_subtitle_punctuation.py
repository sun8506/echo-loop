import unittest

from main import _subtitle_text


class SubtitlePunctuationTests(unittest.TestCase):
    def test_adds_japanese_full_stop(self):
        self.assertEqual(_subtitle_text("今日はいい天気です", "ja"), "今日はいい天気です。")

    def test_adds_chinese_full_stop(self):
        self.assertEqual(_subtitle_text("今天适合出门", "zh-CN"), "今天适合出门。")

    def test_adds_english_period(self):
        self.assertEqual(_subtitle_text("This is a test", "en"), "This is a test.")

    def test_preserves_existing_punctuation_and_closing_quote(self):
        self.assertEqual(_subtitle_text("彼は「行きます。」", "ja"), "彼は「行きます。」")

    def test_normalizes_whitespace(self):
        self.assertEqual(_subtitle_text("  hello   world  ", "en"), "hello world.")


if __name__ == "__main__":
    unittest.main()
