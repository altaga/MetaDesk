"""Authentication routes: login and identity lookup."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..config import AppError
from . import service
from .models import User
from .schemas import LoginRequest, MeResponse, TokenResponse, UserView
from .security import access_token_ttl_seconds, create_access_token

router = APIRouter(prefix="/v1/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest) -> TokenResponse:
    """Exchange operator credentials for a signed access token."""

    user = service.authenticate(payload.username, payload.password)
    if user is None:
        raise AppError(
            "invalid_credentials",
            "The username or password is incorrect.",
            status_code=401,
            field="password",
        )
    return TokenResponse(token=create_access_token(user.username), expires_in=access_token_ttl_seconds())


@router.get("/me", response_model=MeResponse)
def me(user: User = Depends(service.get_current_user)) -> MeResponse:
    """Return the operator behind the presented bearer token."""

    return MeResponse(ok=True, user=UserView(username=user.username))
