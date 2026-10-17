"""Docker/Northflank command probe selected by RUN_MODE."""
import logging
import urllib.request

from . import config


def main():
    config.configure_logging()
    try:
        mode = config.run_mode()
        if mode == "worker":
            from .worker import check_health
            check_health()
        else:
            # In combined mode /api/ready also checks supervisor/children/worker.
            with urllib.request.urlopen("http://127.0.0.1:8000/api/ready", timeout=3) as response:
                if response.status != 200:
                    raise RuntimeError("API is not ready")
    except Exception as exc:
        logging.getLogger("socratic.healthcheck").error("Health check failed error_type=%s", type(exc).__name__)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
