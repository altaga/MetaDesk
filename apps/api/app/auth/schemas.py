"""Request and response models for the authentication endpoints."""

from __future__ import annotations

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=512)


class TokenResponse(BaseModel):
    token: str
    expires_in: int


class UserView(BaseModel):
    username: str


class MeResponse(BaseModel):
    ok: bool = True
    user: UserView
