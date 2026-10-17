"""Browser test entry point. Production continues to use backend.app.main:app."""
import os

from backend.app.main import create_app
from backend.tests.fake_tutor import FakeTutor

os.environ["TUTOR_MODE"] = "openai"
app = create_app(tutor_engine=FakeTutor())
