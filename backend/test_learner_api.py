import os
import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException

from learner_api import (
    FeedbackRequest,
    LoginRequest,
    ProgressRequest,
    RegisterRequest,
    create_feedback,
    learning_stats,
    login,
    register,
    save_progress,
)


class LearnerApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        os.environ["ECHOLOOP_DB_PATH"] = str(Path(self.temp.name) / "test.db")

    def tearDown(self):
        os.environ.pop("ECHOLOOP_DB_PATH", None)
        self.temp.cleanup()

    def test_account_progress_stats_and_feedback(self):
        registered = register(RegisterRequest(
            email="learner@example.com", displayName="Learner", password="password123",
        ))
        user = registered["user"]

        payload = {
            "position": 12.5, "speed": 0.75, "completedCueIds": [1, 2],
            "bookmarkedCueIds": [2], "learnedSeconds": 15, "eventId": "event-one",
        }
        first = save_progress(ProgressRequest(**payload), "course-1", user)
        second = save_progress(ProgressRequest(**payload), "course-1", user)
        self.assertEqual(first["totalSeconds"], 15)
        self.assertEqual(second["totalSeconds"], 15)
        self.assertEqual(second["completedCueIds"], [1, 2])

        stats = learning_stats(user)
        self.assertEqual(stats, {"totalSeconds": 15, "courseCount": 1, "completedCueCount": 2})

        feedback = create_feedback(FeedbackRequest(
            courseId="course-1", category="subtitle", message="第二句字幕需要检查。", position=12.5,
        ), user)
        self.assertEqual(feedback["status"], "received")

    def test_rejects_duplicate_email_and_bad_password(self):
        payload = RegisterRequest(email="same@example.com", displayName="User One", password="password123")
        register(payload)
        with self.assertRaises(HTTPException) as duplicate:
            register(payload)
        self.assertEqual(duplicate.exception.status_code, 409)
        with self.assertRaises(HTTPException) as wrong_password:
            login(LoginRequest(email=payload.email, password="wrong-pass"))
        self.assertEqual(wrong_password.exception.status_code, 401)


if __name__ == "__main__":
    unittest.main()
