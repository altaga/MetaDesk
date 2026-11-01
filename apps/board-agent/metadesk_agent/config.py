"""Runtime configuration for the MetaDesk board agent.

Every setting can be supplied through an environment variable using the
``METADESK_`` prefix or the plain name, with the prefixed form winning. The
board already keeps its real credentials in the repo-root ``secrets.env``, so
the agent reads that same file instead of duplicating values under its own
folder.
"""

from __future__ import annotations

from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

APP_NAME = "MetaDesk Agent"
APP_VERSION = "0.1.0"

_AGENT_DIR = Path(__file__).resolve().parent.parent
_REPO_ROOT = _AGENT_DIR.parent.parent

# Lowest precedence first; missing files are skipped. The repo-root secrets file
# wins so there is a single git-ignored home for credentials.
_ENV_FILES = (
    _AGENT_DIR / ".env",
    _AGENT_DIR / "secrets.env",
    _REPO_ROOT / "secrets.env",
)


def _choice(name: str) -> AliasChoices:
    """Accept both the ``METADESK_``-prefixed and the plain env name."""

    return AliasChoices(f"METADESK_{name}", name)


class Settings(BaseSettings):
    """Configuration loaded from the environment."""

    model_config = SettingsConfigDict(
        env_prefix="",
        env_file=tuple(str(path) for path in _ENV_FILES),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    cloud_url: str = Field(
        # The Worker address is deployment config: set METADESK_CLOUD_URL.
        default="",
        validation_alias=_choice("CLOUD_URL"),
    )
    board_url: str = Field(default="http://127.0.0.1:8000", validation_alias=_choice("BOARD_URL"))
    board_name: str = Field(default="Jetson", validation_alias=_choice("BOARD_NAME"))
    state_dir: str = Field(default="~/.config/metadesk", validation_alias=_choice("STATE_DIR"))

    jwt_secret: str = Field(default="dev-change-me", validation_alias=_choice("JWT_SECRET"))
    jwt_expire_minutes: int = Field(default=60, validation_alias=_choice("JWT_EXPIRE_MINUTES"))

    terminal_shell: str = Field(default="", validation_alias=_choice("TERMINAL_SHELL"))
    heartbeat_seconds: int = Field(default=25, validation_alias=_choice("HEARTBEAT_SECONDS"))
    reconnect_max_seconds: int = Field(default=30, validation_alias=_choice("RECONNECT_MAX_SECONDS"))
    log_level: str = Field(default="INFO", validation_alias=_choice("LOG_LEVEL"))

    # board-emu reports itself so the cloud keeps chat-only UI affordances.
    board_emu: bool = Field(default=False, validation_alias=_choice("BOARD_EMU"))

    # Unpaired boards answer /setup on the USB gadget link only (comma list).
    setup_hosts: str = Field(default="192.168.55.1", validation_alias=_choice("SETUP_HOSTS"))
    setup_port: int = Field(default=8800, validation_alias=_choice("SETUP_PORT"))
    # Desk origins allowed to drive /setup from the browser (the /pair wizard).
    setup_origins: str = Field(
        default="http://localhost:3000,http://127.0.0.1:3000,https://metadesk-khaki.vercel.app",
        validation_alias=_choice("SETUP_ORIGINS"),
    )

    @property
    def setup_host_list(self) -> list[str]:
        """Where the unpaired setup page listens. Never 0.0.0.0 by default."""

        return [host.strip() for host in self.setup_hosts.split(",") if host.strip()]

    @property
    def setup_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.setup_origins.split(",") if origin.strip()]

    @property
    def ws_url(self) -> str:
        """The relay endpoint the agent dials out to."""

        base = self.cloud_url.rstrip("/")
        if base.startswith("https://"):
            base = "wss://" + base[len("https://") :]
        elif base.startswith("http://"):
            base = "ws://" + base[len("http://") :]
        return f"{base}/v1/agent/connect"

    @property
    def state_path(self) -> Path:
        """Directory holding the paired credentials, created on demand."""

        path = Path(self.state_dir).expanduser()
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def credentials_path(self) -> Path:
        """Where the device token received during pairing is stored."""

        return self.state_path / "device.json"

    @property
    def login_expire_seconds(self) -> int:
        """Lifetime of the short-lived board token minted per relayed request."""

        return int(self.jwt_expire_minutes) * 60


settings = Settings()
