# bbc-practice-mcp

stdio MCP server that lets Claude manage **Tasks** in the Practice Management web app (`../SaaS app`).
It calls the app's token-authenticated API (`/api/mcp/v1/*`); it holds no database access and no PHI of its own.

## Tools

| Tool | Does |
|---|---|
| `task_options` | people (assignable ids), categories, your own id |
| `list_tasks` | `status` open/done/all, `assignee` (id or `me`), `due_before`, `limit`; no notes |
| `get_task` | one task with notes |
| `create_task` | `title`, `notes`, `due`, `assignee`, `category` |
| `update_task` | any of title, notes, due, assignee, category, done (`null` clears) |
| `complete_task` | done (or `done=false` to reopen) |
| `delete_task` | permanent; requires `confirm=true` |

## Security model

- **Token**: an admin issues it in the web app (Admin > Claude tokens). Shown once; only its SHA-256 hash is stored.
  `bbcmcp_...`, scope `tasks` only, expires (default 90 days, max 365), revocable, revoked automatically when the user is deactivated.
  Desktop recorder tokens are not accepted here and these tokens are not accepted by the desktop API.
- **Acts as the chosen user**: never more than that user can do in the Tasks screen (admin: all tasks; others: their own and granted tabs).
- **No PHI**: the API refuses titles/notes that look like patient identifiers (MRN, SSN, DOB, phone, email) and cannot be told to
  override that. Existing tasks that match are returned as `[withheld: possible patient info]`. Audit entries hold ids only.
- **Audit**: every call (including denials) is written to the app's audit log (`mcp.task.*`, `mcp.denied`) with the token id.
- **Transport**: https only (http allowed for `localhost`); redirects are refused so the token is never forwarded.

## Setup

1. Deploy the app with the new `ApiToken` table (`npm run db:push` in `SaaS app`, additive).
2. Admin > **Claude tokens**: pick the user, label, days, **Create token**, copy it.
3. Build:
   ```bash
   cd "MCP Server" && npm install && npm run build
   ```
4. Register it in Claude (not done automatically; it costs context on every turn, so add only when needed):
   ```json
   {
     "mcpServers": {
       "bbc-practice": {
         "command": "node",
         "args": ["/Users/szafar/Documents/GitHub/Practice-management/MCP Server/dist/index.js"],
         "env": {
           "BBC_API_URL": "https://practice-mgmt-321509350517.us-east4.run.app",
           "BBC_API_TOKEN": "bbcmcp_..."
         }
       }
     }
   }
   ```
   `BBC_API_URL` above is staging. For local dev use `http://localhost:3000` after `npm run dev` in `SaaS app`.

Smoke test without Claude: `curl -H "Authorization: Bearer $BBC_API_TOKEN" "$BBC_API_URL/api/mcp/v1/options"`.

## Develop

```bash
npm run typecheck && npm test      # here
cd "../SaaS app" && npx vitest run tests/mcpApi.test.ts   # API side
```
