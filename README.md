# Wichtle

Wichteln (Secret Santa) for a group, run by its host: one link in the group chat, everyone taps their
name, and the draw stays sealed, even from the host. No accounts; everything is deleted 30 days after
the party. Live at [wichtle.ewolution.cloud](https://wichtle.ewolution.cloud).

- **One group link, claim your name.** The host lists the names (typed or pasted, one per line), or
  people add themselves until the draw. Each person taps their name; that device keeps their own
  link, "My link" copies it for another one, and the host can free a wrong claim (its link stops).
- **Wishes and handover.** Up to eight wishes, each with an optional link shown as it is and never
  fetched, plus "please not". Each person is at the party or wants post; only post asks for an
  address, and only their giver sees it.
- **The draw.** Couples and households never draw each other. The host picks one closed chain or any
  valid draw, and quiet (people open theirs whenever) or live (the host's screen lights a candle arch,
  then every open page opens its Advent door at once). Drawn on the server from `node:crypto`.
- **Sealed, with an unseal code.** The host sees each person's steps (joined, opened, present ready;
  on its way and arrived per recipient), never the pairs. The code, set when the group starts, opens
  every pair and address on that device for 30 minutes and leaves a line in the host's log; the same
  code gives a lost host a new host link.
- **Changes after the draw.** A drop-out or a late joiner: patch with the fewest changes, or draw
  everyone again; the host chooses each time.
- **A practice run.** The home starts a practice group of nine made-up colleagues who join, write
  wishes, open their draws and tick their steps on their own; their pages open from the host's page.
  Its unseal code is `wichtel`, and it's deleted after a day.
- **The family's shell.** German first and English, light and dark (look B "Scherenschnitt",
  Gingerbread), installs to the home screen with a splash, Census counts visits without cookies (the
  keys are cut out of the paths it sees).

## How it works

A group is one JSON document in SQLite (`server/store.mjs`, `node:sqlite`, WAL, `secure_delete`),
beside a table of keys: the group link (`g`), the host link (`h`) and one personal link (`p`) per
claimed name, each 128 random bits in base64url, none derived from another. A key's letter must match
its kind, so `/h/<group key>` is a 404. `server/model.mjs` holds the limits, the cleaning of what
people send and the views: the group's (names and who has joined), the host's (statuses, never pairs)
and a person's (their own details and, once revealed, the person they drew).

Nothing secret is ever in a page's HTML or in a GET a messenger could fetch for its preview: a claim,
an opening and a reveal are POSTs after a tap. `server/pages.mjs` puts the group's name in the title
and the link preview, and nothing else from it. The host's view carries the pairs only with a valid
`x-unseal` header: the unseal code is an scrypt hash with the group's own salt, five tries per 15
minutes per group, and a right code returns a 30-minute token the page keeps in memory only.

`shared/draw.mjs` draws: a chain is a random order with no two neighbours from one household, closed
into a circle; any valid draw is a random assignment with nobody drawing themselves or their
household. Rejection sampling first, which is exactly uniform; a randomised search takes over where
that would be slow (large households). `possible` says before the draw when none exists (a household
of more than half the group). `patchOut` and `patchIn` change the fewest draws for a drop-out and a
late joiner.

Every change sends `v` on the group's stream (`GET /api/live/<key>`, server-sent events), and every
open page fetches its own view again; `gone` tells them the group was deleted. A live draw is made at
once and staged by its timestamps, so the host's arch and every person's door open on the same clock.
An hourly sweep deletes groups 30 days after their party (practice groups after a day) and vacuums.

## Run it

```bash
npm install
npm run dev         # http://localhost:7710, the API in Vite's dev server (data/dev.sqlite)
npm run check       # svelte-check
npm test            # unit tests: the draw, the API (an in-memory store, real SSE), the pages, Census's forwarder, Dashboard's manifest and defaults
npm run test:sim    # the draw's statistics on node:crypto, over many draws
npm run test:e2e    # Playwright against a fresh production build: every workflow, both languages and themes
npm run build && npm start   # the production server on :8080 (PORT or --port to change it)
```

The end-to-end tests and the simulations run locally before a push; CI runs the type check, the unit
tests, the build and a smoke test of the production server.

## Deploy (NAS)

A push to `release` runs the checks (`ci.yml`) and publishes `ghcr.io/ewolution94/wichtle:latest`
(amd64 and arm64); the shared Watchtower deploys it. The stack is `deploy/portainer-stack.yml`, not
`docker-compose.yml` (that one builds from source). The groups live in the `wichtle-data` volume.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8080` | Where the server listens (the NAS stack sets its registry port). |
| `HOST` | `0.0.0.0` | |
| `WICHTLE_DATA` | `./data` (`/data` in the image) | The folder for `wichtle.sqlite`. |
| `WICHTLE_ORIGIN` | `https://wichtle.ewolution.cloud` | The origin in link previews. |
| `WICHTLE_CENSUS` | off | Census's ingest origin (`http://census:4901` on the `ewolution` network). |
| `WICHTLE_PRACTICE_PACE` | `1` | Runs the practice colleagues that many times faster: for the end-to-end tests, never on the NAS. |
| `DASHBOARD_URL` | off | Dashboard's apps' port (`http://dashboard:8081`): the language and theme a device that hasn't picked starts from. |

## Project layout

```
shared/draw.mjs      the draw: chain and any, households, possible, patches (server and tests)
server/              server.mjs (static, page heads, headers), api.mjs (groups, claims, the draw, unseal,
                     SSE, the sweep, the practice colleagues), model.mjs (limits, cleaning, views),
                     store.mjs (SQLite), pages.mjs (each address's page), practice.mjs, census.mjs
src/lib/             api, loader (a view and its stream), known (this device's groups), i18n and strings,
                     router, theme, format, paper (the village's shapes)
src/components/      Home, NewGroup, Practice, GroupPage, PersonPage, HostPage, Village, Door, Arch,
                     LiveStage, WishList, Event, Settings
vendor/ewo/          Folio's tokens and elements (npm run vendor -- wichtle, in Folio)
tests/               node --test; *.sim.mjs (simulations, local); e2e/run.mjs (Playwright, local)
```
