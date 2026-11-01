# Vikan

Kvöldmatur vikunnar fyrir heimilið: símavæn síða, uppskriftir, innkaupalisti
með sögu, og MCP þjónn sem Claude notar til að setja saman næstu viku.

- **Í kvöld**: kvöldmatur dagsins, eldunarhamur (skjárinn helst vakandi).
- **Vikan**: 2–4 valmöguleikar á dag; innkaupalistinn fylgir valinu.
- **Listi**: flokkað eftir göngum, „til heima“, einn takki í Snjallverslun Krónunnar.
- **Saga**: hvað var borðað, umsagnir, oftast keypt, hvað er líklega þörf á.
- **Við**: fjölskylduprófíll sem Claude les fyrir hverja viku.

## Architecture

One Node container (no build step):

| Path | What |
|---|---|
| `/` | Static PWA from `public/` |
| `/api/*` | Tiny JSON API for phone taps (choose option, tick item, rate, family profile) |
| `/mcp` | MCP over streamable HTTP (stateless), bearer token `MCP_TOKEN` |

Data is JSON on the `/data` volume: `weeks/<monday>.json`, `family.json`,
`feedback.json`. The first start seeds week 45 (2.–8. nóv 2026).

MCP tools: `get_context`, `get_week`, `put_week_plan`, `get_grocery_history`,
`read_recipe_page`, `update_family_profile`.

## Deploy on the home server

GitHub Actions builds `ghcr.io/jbbjarnason/vikan` (amd64 + arm64) on every push
to `main`; Watchtower on the server pulls it within 5 minutes.

```sh
# once, on the home server
mkdir -p ~/vikan && cd ~/vikan
curl -fsSLO https://raw.githubusercontent.com/jbbjarnason/vikan/main/docker-compose.yml   # or scp it
echo "MCP_TOKEN=$(openssl rand -hex 32)" > .env
# the image is private: log in with a classic PAT that has read:packages
echo <PAT> | docker login ghcr.io -u jbbjarnason --password-stdin
docker compose up -d
```

The site is then at `http://homeserver:8080`. On iPhone: Share → Add to Home Screen.

## The weekly run

The prompt is in [`planner/PROMPT.md`](planner/PROMPT.md). It needs the vikan
MCP and the Krónan connector. Pick one:

**A. On the home server with `claude -p`** (nothing exposed to the internet):

```sh
claude mcp add --transport http vikan http://localhost:8080/mcp --header "Authorization: Bearer $MCP_TOKEN"
# crontab: Sundays 16:00
0 16 * * 0  cd ~/vikan && claude -p "$(cat PROMPT.md)" --allowedTools "mcp__vikan__*,mcp__claude_ai_Kr_nan__*"
```

**B. Claude Code scheduled task (cloud)**: expose `/mcp` over HTTPS with the
`tunnel` compose profile (Cloudflare Tunnel), add it as a custom connector with
header `Authorization: Bearer <MCP_TOKEN>`, then create the task with
`/schedule` using the prompt.

## Local dev

```sh
npm install
npm run dev        # http://localhost:8080, data in ./data, MCP token "dev"
```
