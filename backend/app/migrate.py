from .db import Database


if __name__ == "__main__":
    Database.from_env().initialize()
    print("Database migrations completed.")
