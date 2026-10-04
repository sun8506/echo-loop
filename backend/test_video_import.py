import unittest
from video_import import _check_duration, max_duration_seconds, validate_source_url
from unittest.mock import patch
class UrlValidationTests(unittest.TestCase):
 def test_accepts_tbs_article(self): self.assertEqual(validate_source_url('https://newsdig.tbs.co.jp/articles/-/2944302?display=1&mwplay=1'),'https://newsdig.tbs.co.jp/articles/-/2944302?display=1&mwplay=1')
 def test_accepts_youtube_video_links(self):
  for url in ['https://www.youtube.com/watch?v=dQw4w9WgXcQ','https://youtu.be/dQw4w9WgXcQ','https://youtube.com/shorts/dQw4w9WgXcQ','https://www.youtube.com/live/dQw4w9WgXcQ']:
   self.assertEqual(validate_source_url(url),url)
 def test_accepts_bilibili_video_links(self):
  for url in ['https://b23.tv/8Jk2cjx','https://www.bilibili.com/video/BV1xx411c7mD','https://m.bilibili.com/video/av170001']:
   self.assertEqual(validate_source_url(url),url)
 def test_rejects_other_hosts_and_credentials(self):
  for url in ['http://newsdig.tbs.co.jp/articles/-/2944302','https://example.com/articles/-/2944302','https://newsdig.tbs.co.jp.evil.test/articles/-/2944302','https://user@newsdig.tbs.co.jp/articles/-/2944302']:
   with self.assertRaises(ValueError): validate_source_url(url)
 def test_rejects_non_article_path(self):
  with self.assertRaises(ValueError): validate_source_url('https://newsdig.tbs.co.jp/')
 def test_rejects_youtube_home_playlist_and_fake_host(self):
  for url in ['https://youtube.com/','https://youtube.com/playlist?list=abc','https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ']:
   with self.assertRaises(ValueError): validate_source_url(url)
 def test_rejects_bilibili_home_space_and_fake_host(self):
  for url in ['https://www.bilibili.com/','https://space.bilibili.com/1','https://bilibili.com.evil.test/video/BV1xx411c7mD','https://b23.tv/']:
   with self.assertRaises(ValueError): validate_source_url(url)
class DurationLimitTests(unittest.TestCase):
 def test_default_allows_more_than_two_hours(self):
  with patch.dict("os.environ", {}, clear=False):
   self.assertEqual(max_duration_seconds(), 12 * 3600)
   _check_duration(3 * 3600)
 def test_configurable_limit(self):
  with patch.dict("os.environ", {"ECHOLOOP_MAX_IMPORT_HOURS": "3"}):
   with self.assertRaisesRegex(RuntimeError, "超过 3 小时"): _check_duration(4 * 3600)
 def test_zero_disables_duration_limit(self):
  with patch.dict("os.environ", {"ECHOLOOP_MAX_IMPORT_HOURS": "0"}): _check_duration(48 * 3600)

if __name__=='__main__': unittest.main()
