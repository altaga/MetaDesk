"""Vault routes: list names, store a value, forget a value."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth.models import User
from ..auth.service import get_current_user
from . import service
from .schemas import DeleteResult, PutSecretRequest, SecretName

router = APIRouter(prefix="/v1/vault", tags=["vault"])


@router.get("", response_model=list[SecretName])
def list_secrets(user: User = Depends(get_current_user)) -> list[SecretName]:
    """List stored secret names. Values are never returned."""

    return [SecretName(name=name) for name in service.list_names(user.id)]


@router.put("", response_model=SecretName)
def put_secret(payload: PutSecretRequest, user: User = Depends(get_current_user)) -> SecretName:
    """Store a secret, or rotate it when the name is already taken."""

    return SecretName(name=service.put_secret(user.id, payload.name, payload.value))


@router.delete("/{name}", response_model=DeleteResult)
def delete_secret(name: str, user: User = Depends(get_current_user)) -> DeleteResult:
    """Forget a stored secret."""

    service.delete_secret(user.id, name)
    return DeleteResult()
