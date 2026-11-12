"""PostgreSQL configuration, pooling, and transaction primitives.

This module deliberately does not contain repositories or application queries.
It opens the configured Neon pool only when a transaction is first requested.
"""

from __future__ import annotations

import os
import re
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator, Mapping, Optional


ALLOWED_SCHEMAS = frozenset({"main", "location_ui"})
DEFAULT_POOL_MIN = 1
DEFAULT_POOL_MAX = 5
DEFAULT_CONNECT_TIMEOUT = 10
_IDENTIFIER_PATTERN = re.compile(r"^[a-z_][a-z0-9_]*$")


class DatabaseError(RuntimeError):
    """Base class for safe, application-facing database errors."""


class DatabaseConfigurationError(DatabaseError):
    """Raised when required PostgreSQL configuration is missing or invalid."""


class DatabaseDependencyError(DatabaseError):
    """Raised when the PostgreSQL runtime dependencies are unavailable."""


class DatabaseConnectionError(DatabaseError):
    """Raised when the PostgreSQL pool cannot be opened or acquired."""


class DatabaseOperationError(DatabaseError):
    """Raised when PostgreSQL rejects a database operation."""


def _positive_integer(name: str, value: str, default: int) -> int:
    raw = value.strip() if value else str(default)
    try:
        parsed = int(raw)
    except ValueError as exc:
        raise DatabaseConfigurationError("%s must be an integer" % name) from exc
    if parsed < 1:
        raise DatabaseConfigurationError("%s must be greater than zero" % name)
    return parsed


def _load_dotenv() -> None:
    """Load project-local dotenv configuration without exposing its values."""

    try:
        from dotenv import load_dotenv
    except ImportError as exc:
        raise DatabaseDependencyError(
            "PostgreSQL support requires python-dotenv"
        ) from exc

    project_dir = Path(__file__).resolve().parent
    env_file = project_dir / ".env"
    if not env_file.exists():
        env_file = project_dir / ".env.txt"
    if env_file.exists():
        load_dotenv(dotenv_path=env_file)
        if "DATABASE_URL" not in os.environ:
            raw_value = env_file.read_text(encoding="utf-8").strip()
            if raw_value.startswith(("postgresql://", "postgres://")):
                os.environ.setdefault("DATABASE_URL", raw_value)
    else:
        load_dotenv()


@dataclass(frozen=True)
class DatabaseConfig:
    """Validated PostgreSQL connection settings loaded from environment data."""

    database_url: str
    main_schema: str = "main"
    location_schema: str = "location_ui"
    pool_min: int = DEFAULT_POOL_MIN
    pool_max: int = DEFAULT_POOL_MAX
    connect_timeout: int = DEFAULT_CONNECT_TIMEOUT

    def __post_init__(self) -> None:
        if not self.database_url.strip():
            raise DatabaseConfigurationError("DATABASE_URL is required")
        for name, schema in (
            ("MAIN_SCHEMA", self.main_schema),
            ("LOCATION_SCHEMA", self.location_schema),
        ):
            if schema not in ALLOWED_SCHEMAS:
                raise DatabaseConfigurationError(
                    "%s must be one of: %s"
                    % (name, ", ".join(sorted(ALLOWED_SCHEMAS)))
                )
        if self.main_schema == self.location_schema:
            raise DatabaseConfigurationError(
                "MAIN_SCHEMA and LOCATION_SCHEMA must be different"
            )
        if self.pool_min < 1:
            raise DatabaseConfigurationError("DB_POOL_MIN must be greater than zero")
        if self.pool_max < self.pool_min:
            raise DatabaseConfigurationError(
                "DB_POOL_MAX must be greater than or equal to DB_POOL_MIN"
            )
        if self.connect_timeout < 1:
            raise DatabaseConfigurationError(
                "DB_CONNECT_TIMEOUT must be greater than zero"
            )

    @classmethod
    def from_env(
        cls, environ: Optional[Mapping[str, str]] = None
    ) -> "DatabaseConfig":
        """Build configuration without opening a connection."""

        if environ is None:
            _load_dotenv()
        values = environ if environ is not None else os.environ
        database_url = values.get("DATABASE_URL", "").strip()
        if not database_url:
            raise DatabaseConfigurationError("DATABASE_URL is required")
        main_schema = values.get("MAIN_SCHEMA", "main").strip()
        location_schema = values.get("LOCATION_SCHEMA", "location_ui").strip()
        pool_min = _positive_integer(
            "DB_POOL_MIN", values.get("DB_POOL_MIN", ""), DEFAULT_POOL_MIN
        )
        pool_max = _positive_integer(
            "DB_POOL_MAX", values.get("DB_POOL_MAX", ""), DEFAULT_POOL_MAX
        )
        connect_timeout = _positive_integer(
            "DB_CONNECT_TIMEOUT",
            values.get("DB_CONNECT_TIMEOUT", ""),
            DEFAULT_CONNECT_TIMEOUT,
        )
        return cls(
            database_url=database_url,
            main_schema=main_schema,
            location_schema=location_schema,
            pool_min=pool_min,
            pool_max=pool_max,
            connect_timeout=connect_timeout,
        )


def _postgres_dependencies() -> tuple[Any, Any, Any]:
    """Load psycopg lazily and return pool, row factory, and error base."""

    try:
        from psycopg.rows import dict_row
        from psycopg_pool import ConnectionPool
        import psycopg
    except ImportError as exc:
        raise DatabaseDependencyError(
            "PostgreSQL support requires psycopg 3 and psycopg_pool"
        ) from exc
    return ConnectionPool, dict_row, psycopg.Error


@dataclass(frozen=True)
class DatabaseHandle:
    """Logical access handle for one schema in the shared PostgreSQL database."""

    manager: "DatabaseManager"
    schema: str

    def __post_init__(self) -> None:
        if self.schema not in ALLOWED_SCHEMAS:
            raise DatabaseConfigurationError(
                "schema must be one of: %s"
                % ", ".join(sorted(ALLOWED_SCHEMAS))
            )

    def qualify(self, table: str) -> str:
        """Return a safe schema-qualified table name for repository SQL."""

        if not _IDENTIFIER_PATTERN.fullmatch(table):
            raise ValueError("invalid table identifier")
        return "%s.%s" % (self.schema, table)

    @contextmanager
    def transaction(self, *, read_only: bool = False) -> Iterator[Any]:
        """Acquire a pooled connection and run one transaction."""

        with self.manager.transaction(read_only=read_only) as connection:
            yield connection


class DatabaseManager:
    """Own one shared psycopg pool and expose independent schema handles."""

    def __init__(self, config: DatabaseConfig) -> None:
        self.config = config
        connection_pool, dict_row, psycopg_error = _postgres_dependencies()
        self._psycopg_error = psycopg_error
        try:
            self._pool = connection_pool(
                config.database_url,
                min_size=config.pool_min,
                max_size=config.pool_max,
                kwargs={
                    "connect_timeout": config.connect_timeout,
                    "row_factory": dict_row,
                },
                open=False,
            )
        except Exception as exc:
            raise DatabaseConnectionError(
                "unable to configure the PostgreSQL connection pool"
            ) from exc
        self._pool_lock = threading.Lock()
        self._opened = False
        self.main = DatabaseHandle(self, config.main_schema)
        self.location_ui = DatabaseHandle(self, config.location_schema)

    @classmethod
    def from_env(
        cls, environ: Optional[Mapping[str, str]] = None
    ) -> "DatabaseManager":
        """Create a manager from environment configuration without connecting."""

        return cls(DatabaseConfig.from_env(environ))

    def _open_pool(self) -> None:
        if self._opened:
            return
        with self._pool_lock:
            if self._opened:
                return
            try:
                self._pool.open(wait=True)
            except self._psycopg_error:
                raise
            except Exception as exc:
                raise DatabaseConnectionError(
                    "unable to open the PostgreSQL connection pool"
                ) from exc
            self._opened = True

    @contextmanager
    def transaction(self, *, read_only: bool = False) -> Iterator[Any]:
        """Run a transaction with automatic commit, rollback, and pool return."""

        self._open_pool()
        yielded = False
        try:
            with self._pool.connection() as connection:
                with connection.transaction():
                    if read_only:
                        connection.execute("SET TRANSACTION READ ONLY")
                    yielded = True
                    yield connection
        except self._psycopg_error:
            raise
        except Exception as exc:
            if not yielded:
                raise DatabaseConnectionError(
                    "unable to acquire a PostgreSQL connection"
                ) from exc
            raise

    def close(self) -> None:
        """Close the pool and release all idle PostgreSQL connections."""

        with self._pool_lock:
            if self._opened:
                self._pool.close()
                self._opened = False

    def __enter__(self) -> "DatabaseManager":
        return self

    def __exit__(self, exc_type: Any, exc_value: Any, traceback: Any) -> None:
        self.close()
