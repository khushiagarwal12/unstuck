import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import create_app


@pytest.fixture
def client():
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(auth_mode="dev", llm_backend="fake")
    return TestClient(app, raise_server_exceptions=False)
