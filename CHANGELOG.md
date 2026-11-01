# Changelog

## 0.1.1 (2026-11-02)

First public release.

- The `hpc` provider kind is an optional adapter with a documented JSON contract (`/health`, `/state`); nothing else depends on it.
- `orch_*` tools return lossless JSON on DSH 0.2.1 (sanitized at the tool boundary, regression test).
- Agent follow-ups use the `plugin:<id>` source kind on DSH 0.2.x.
- Tests and build resolve esbuild, jsdom and react from the devDependencies (or `ESBUILD_MAIN`, `DSH_TEST_REQUIRE_SEED`), no absolute paths; neutral host names in fixtures.

## 0.1.0

- Orchestrate tab in dsh-better-sidebar: agents (spawn, prompt, fork, cancel, chat drawer), tasks (command, scrape, http, agent) with live output, runners (local, ssh, http tool servers), provider cards, machine API settings.
- 14 `orch_*` agent tools, settings on DSH 0.1.5 (namespace) and 0.2.x (profile row), secret-protected machine API with rate limits.
