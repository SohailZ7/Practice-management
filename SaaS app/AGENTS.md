# Agent notes

**Start here:** read [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md) (current state, rules, open issues, gotchas), then check `git status` and `git log`: other sessions also work in this repo.

## Requirements are versioned
Whenever the user gives new or changed requirements, create the next file in `specs/`
(`requirements-v2.md`, `requirements-v3.md`, ...) as a full, current copy of the spec with a
"Changes since vN" section, and leave older versions untouched. Keep the latest version in sync
with what the app actually does as work proceeds.
