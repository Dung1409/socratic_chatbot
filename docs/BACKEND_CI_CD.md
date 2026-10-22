# Backend CI/CD

Workflow: `.github/workflows/backend-northflank.yml`.

## CI

For pull requests and pushes to `main` that touch `backend/**`, GitHub Actions:

1. installs Python 3.11 dependencies;
2. compiles `backend/app`;
3. runs all backend tests;
4. builds `backend/Dockerfile` with `backend/` as the Docker context.

The Docker build uses the same context and Dockerfile as the Northflank build service, so a
successful CI build catches missing files and dependency errors before release.

## Production CD

The `deploy` job runs only after CI passes on `main`. It calls the Northflank release/deploy
hook stored as the GitHub Actions **environment secret**:

```text
NORTHFLANK_DEPLOY_HOOK_URL
```

Create the hook in Northflank so it executes the production release pipeline in this order:

```text
build image -> migration job (python -m backend.app.migrate) -> deploy socratic-api
```

The migration job must use the exact image digest produced for the release and must finish
successfully before the API service is rolled out. Do not put `OPENAI_API_KEY`, `DATABASE_URL`,
or any runtime secret in GitHub Actions; they remain Northflank environment/secret-group values.

If `NORTHFLANK_DEPLOY_HOOK_URL` is not configured, CI still runs and the deploy job reports that
production deployment was skipped. This makes pull-request validation usable before Northflank
credentials are added.

## One-time setup

1. In GitHub, open **Settings → Environments → production**.
2. Add the secret `NORTHFLANK_DEPLOY_HOOK_URL`.
3. Configure the Northflank hook to deploy from `main` and to run the migration gate above.
4. Push a backend change and verify the Actions run, migration job, API rollout, and `/api/ready`.
