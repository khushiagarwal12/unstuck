from fastapi.testclient import TestClient

from app.auth import User, current_user
from app.config import Settings, get_settings
from app.deps import get_llm, get_store
from app.main import create_app


def make_client(*, settings=None, llm=None, store=None, signed_in=True, uid="student42") -> TestClient:
    """Real app, with only its external dependencies replaced (sign-in, model, database)."""
    app = create_app()
    settings = settings or Settings()
    app.dependency_overrides[get_settings] = lambda: settings
    if llm is not None:
        app.dependency_overrides[get_llm] = lambda: llm
    if store is not None:
        app.dependency_overrides[get_store] = lambda: store
    if signed_in:
        app.dependency_overrides[current_user] = lambda: User(uid=uid)
    return TestClient(app, raise_server_exceptions=False)
