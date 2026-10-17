from .db import Database
from . import config
import logging


def main():
    config.configure_logging()
    try:
        Database.from_env().initialize()
    except Exception as exc:
        # Avoid printing a DSN, credentials, SQL values or driver traceback.
        logging.getLogger("socratic.migrate").error("Migration failed error_type=%s", type(exc).__name__)
        return 1
    logging.getLogger("socratic.migrate").info("Database migrations completed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
