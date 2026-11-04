"""Configuration and shared primitives for the MetaDesk board API.

Every setting can be supplied through an environment variable, either using the
``METADESK_`` prefix or with the plain name. For example ``METADESK_LLM_MODE``
and ``LLM_MODE`` are both accepted, with the prefixed name taking precedence.
"""

from __future__ import annotations

from pathlib import Path
from typing import List

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

APP_NAME = "MetaDesk"
APP_VERSION = "0.1.0"

_VALID_MODES = {"hybrid", "local_only", "cloud_only"}

# Environment files, lowest precedence first. Missing files are skipped, and the
# repo-root secrets file wins over the per-app defaults so real credentials live
# in exactly one git-ignored place instead of being copied into the app folder.
_APP_DIR = Path(__file__).resolve().parent
_API_DIR = _APP_DIR.parent
_REPO_ROOT = _API_DIR.parent.parent

_ENV_FILES = (
    _API_DIR / ".env",
    _API_DIR / "secrets.env",
    _REPO_ROOT / "secrets.env",
)


def _choice(name: str) -> AliasChoices:
    """Return an alias list that accepts the prefixed and plain env names."""

    return AliasChoices(f"METADESK_{name}", name)


class Settings(BaseSettings):
    """Runtime configuration loaded from the environment."""

    model_config = SettingsConfigDict(
        env_prefix="",
        env_file=tuple(str(path) for path in _ENV_FILES),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    llm_mode: str = Field(default="hybrid", validation_alias=_choice("LLM_MODE"))
    jwt_secret: str = Field(default="dev-change-me", validation_alias=_choice("JWT_SECRET"))
    jwt_expire_minutes: int = Field(default=60, validation_alias=_choice("JWT_EXPIRE_MINUTES"))

    bootstrap_username: str = Field(default="admin", validation_alias=_choice("BOOTSTRAP_USERNAME"))
    bootstrap_password: str = Field(default="changeme", validation_alias=_choice("BOOTSTRAP_PASSWORD"))

    meta_api_key: str = Field(default="", validation_alias=_choice("META_API_KEY"))
    meta_base_url: str = Field(default="https://api.meta.ai/v1", validation_alias=_choice("META_BASE_URL"))
    meta_model_fast: str = Field(default="muse-spark-1.3-contributor", validation_alias=_choice("META_MODEL_FAST"))
    meta_model_heavy: str = Field(default="muse-spark-1.3", validation_alias=_choice("META_MODEL_HEAVY"))
    meta_model_ultra: str = Field(default="muse-wonder-1.0", validation_alias=_choice("META_MODEL_ULTRA"))
    #: Muse reasons before it answers, and reasoning shares the output budget.
    #: Empty leaves the model's own default.
    meta_reasoning_effort: str = Field(default="low", validation_alias=_choice("META_REASONING_EFFORT"))
    meta_usd_per_1m_input: float = Field(default=4.00, validation_alias=_choice("META_USD_PER_1M_INPUT"))
    meta_usd_per_1m_output: float = Field(default=20.00, validation_alias=_choice("META_USD_PER_1M_OUTPUT"))
    meta_daily_budget_usd: float = Field(default=2.00, validation_alias=_choice("META_DAILY_BUDGET_USD"))

    #: Missions: one prompt split into independent turns that run side by side.
    mission_concurrency: int = Field(default=4, validation_alias=_choice("MISSION_CONCURRENCY"))
    mission_max_tasks: int = Field(default=5, validation_alias=_choice("MISSION_MAX_TASKS"))

    ollama_base_url: str = Field(default="http://127.0.0.1:11434", validation_alias=_choice("OLLAMA_BASE_URL"))
    ollama_model: str = Field(default="qwen3.5:4b", validation_alias=_choice("OLLAMA_MODEL"))

    database_url: str = Field(default="sqlite:///./data/metadesk.db", validation_alias=_choice("DATABASE_URL"))
    desk_root: str = Field(default="./workspace", validation_alias=_choice("DESK_ROOT"))
    cors_origins: str = Field(
        default="http://localhost:3000,http://127.0.0.1:3000,http://localhost:8081",
        validation_alias=_choice("CORS_ORIGINS"),
    )

    #: Central service. A paired board reaches it with the token written at pairing.
    cloud_url: str = Field(
        # The Worker address is deployment config: set METADESK_CLOUD_URL.
        default="",
        validation_alias=_choice("CLOUD_URL"),
    )
    state_dir: str = Field(default="~/.config/metadesk", validation_alias=_choice("STATE_DIR"))
    desk_device_token: str = Field(default="", validation_alias=_choice("DEVICE_TOKEN"))

    #: Fallbacks used only when the board is not paired to a cloud account.
    tavily_api_key: str = Field(default="", validation_alias=_choice("TAVILY_API_KEY"))
    tavily_credit_cap: int = Field(default=1500, validation_alias=_choice("TAVILY_CREDIT_CAP"))

    @field_validator("llm_mode", mode="before")
    @classmethod
    def _normalize_mode(cls, value: object) -> str:
        if isinstance(value, str) and value.strip().lower() in _VALID_MODES:
            return value.strip().lower()
        return "hybrid"

    @property
    def cors_origin_list(self) -> List[str]:
        """Return the configured CORS origins as a clean list."""

        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def state_path(self) -> Path:
        """Directory holding the paired-device credentials written at pairing."""

        return Path(self.state_dir).expanduser()

    @property
    def compute_tier(self) -> str:
        """Best available compute tier for the current mode."""

        return "cloud" if self.llm_mode == "cloud_only" else "local"


settings = Settings()


class AppError(Exception):
    """Domain error that always maps onto the public error envelope."""

    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = 400,
        field: str | None = None,
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.field = field
        self.retryable = retryable


def desk_root_abs() -> Path:
    """Absolute, resolved sandbox root used by the file and shell tools."""

    return Path(settings.desk_root).expanduser().resolve()


def resolve_under_root(relative: str | None) -> Path:
    """Resolve ``relative`` inside the desk root, rejecting any escape."""

    root = desk_root_abs()
    candidate = (root / (relative or ".")).resolve()
    if candidate != root and root not in candidate.parents:
        raise AppError(
            "path_out_of_root",
            "The requested path escapes the desk root.",
            status_code=403,
            field="path",
        )
    return candidate
