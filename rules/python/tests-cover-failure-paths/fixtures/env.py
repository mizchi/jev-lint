from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Config:
    port: int
    debug: bool
    dsn: str


def _parse_bool(raw: str) -> bool:
    return raw.strip().lower() in ("1", "true", "yes", "on")


def read_port(env: dict[str, str]) -> int:
    raw = env.get("PORT", "8080")
    if not raw.isdigit():
        raise ValueError(f"PORT must be an integer, got {raw!r}")
    return int(raw)


def read_flag(env: dict[str, str], name: str) -> bool:
    raw = env.get(name)
    if raw is None:
        return False
    return _parse_bool(raw)


def require(env: dict[str, str], name: str) -> str:
    value = env.get(name)
    if not value:
        raise KeyError(f"{name} is required")
    return value


def read_config(env: dict[str, str]) -> Config:
    return Config(port=read_port(env), debug=read_flag(env, "DEBUG"), dsn=require(env, "DSN"))
