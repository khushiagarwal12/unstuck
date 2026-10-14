"""One error shape for the whole API: {"error": {"code", "message", "retryable"}}."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class AppError(Exception):
    def __init__(self, code: str, message: str, *, status: int = 400, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.retryable = retryable


def _body(code: str, message: str, retryable: bool) -> dict:
    return {"error": {"code": code, "message": message, "retryable": retryable}}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(_body(exc.code, exc.message, exc.retryable), status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        # Do not echo submitted values back: they may contain student text.
        fields = sorted({".".join(str(p) for p in e["loc"][1:]) or "body" for e in exc.errors()})
        return JSONResponse(
            _body("invalid_request", f"Check these fields: {', '.join(fields)}.", False),
            status_code=422,
        )

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, __: Exception) -> JSONResponse:
        return JSONResponse(
            _body("internal_error", "Something went wrong on our side. Try again.", True),
            status_code=500,
        )
