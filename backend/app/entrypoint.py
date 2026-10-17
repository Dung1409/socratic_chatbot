"""Runtime dispatcher; explicit Docker command overrides still bypass this module."""
import os
import sys

from . import config


def api_command():
    return [sys.executable, "-m", "uvicorn", "backend.app.main:app",
            "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--no-access-log"]


def main():
    try:
        mode = config.run_mode()
        if mode == "combined":
            from .combined import main as combined_main
            return combined_main()
        command = api_command() if mode == "api" else [sys.executable, "-m", "backend.app.worker"]
        os.execv(sys.executable, command)
    except Exception as exc:
        # Never emit environment values or exception messages (which may contain DSNs).
        config.configure_logging()
        import logging
        logging.getLogger("socratic.entrypoint").error("Startup failed error_type=%s", type(exc).__name__)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
