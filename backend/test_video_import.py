import unittest
from video_import import validate_source_url
class UrlValidationTests(unittest.TestCase):
 def test_accepts_tbs_article(self): self.assertEqual(validate_source_url('https://newsdig.tbs.co.jp/articles/-/2944302?display=1&mwplay=1'),'https://newsdig.tbs.co.jp/articles/-/2944302?display=1&mwplay=1')
 def test_accepts_youtube_video_links(self):
  for url in ['https://www.youtube.com/watch?v=dQw4w9WgXcQ','https://youtu.be/dQw4w9WgXcQ','https://youtube.com/shorts/dQw4w9WgXcQ','https://www.youtube.com/live/dQw4w9WgXcQ']:
   self.assertEqual(validate_source_url(url),url)
 def test_rejects_other_hosts_and_credentials(self):
  for url in ['http://newsdig.tbs.co.jp/articles/-/2944302','https://example.com/articles/-/2944302','https://newsdig.tbs.co.jp.evil.test/articles/-/2944302','https://user@newsdig.tbs.co.jp/articles/-/2944302']:
   with self.assertRaises(ValueError): validate_source_url(url)
 def test_rejects_non_article_path(self):
  with self.assertRaises(ValueError): validate_source_url('https://newsdig.tbs.co.jp/')
 def test_rejects_youtube_home_playlist_and_fake_host(self):
  for url in ['https://youtube.com/','https://youtube.com/playlist?list=abc','https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ']:
   with self.assertRaises(ValueError): validate_source_url(url)
if __name__=='__main__': unittest.main()
