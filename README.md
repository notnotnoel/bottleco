# BottleCo

Two AI agents for a bottling plant (sample data, Bottle Co):

- **Line Watcher** – watches 5 live KPIs on 2 filling lines. It warns when a limit breaks and writes an RCA.
- **Data Explorer** – answers questions in a chat, only from data, and shows the rows it used.

Code does every number. The language model only writes the words. The agents read the data only up to the time on the time bar.

## Status

| Phase | What | State |
|---|---|---|
| 1 | Check the basics (one model call, key, budget) | **Done** – 6 models tested |
| 2 | Build the data (one SQLite file) | **Done** – tests pass |
| 3 | Data Kit, 5 KPIs, alert engine | **Done** – tests pass |
| 4 | Line Watcher (LangGraph, RCA, number check) | **Done** – tests pass |
| 5 | Data Explorer (LangGraph, 3 look-around lenses) | **Done** – tests pass |
| 6 | App (React + Vite + FastAPI, from the approved preview) | **Done** – tests pass |
| 7 | Polish and QA | Desktop, phone, dark and light checked |
| 8 | Publish (noel.sg/opsagent/bottleco) | – |

## Folders

```
data/       generator (same engine as the preview), export and SQLite build
backend/    Python: Data Kit, KPIs, alert engine, Line Watcher, Data Explorer, API, tests
frontend/   React + Vite app (the approved preview's look, data from the API)
preview/    the approved clickable preview (source); the React app copies its look
docs/       plan notes
```

## Run it

Needs Python 3.11+ and Node 20+.

```bash
# 1. Build the data (about 5 seconds)
cd data
node export.mjs build/raw.json
python3 build_db.py           # writes data/bottleco.sqlite and the test answer key
node oracle.mjs               # writes the preview numbers the tests compare with

# 2. Run the tests
cd ../backend
pip install -e ".[test]"
pytest -q
```

## Run the app

```bash
cd frontend && npm ci && npx vite build          # builds frontend/dist
cd ../backend && pip install -e ".[test]"
uvicorn bottleco.api:app --port 8000             # open http://localhost:8000
```

For live development run `npx vite` in `frontend/` (it sends `/api` to port 8000).
One container for hosting: `docker build -t bottleco .` (see `Dockerfile`).

Settings for hosting (environment variables):

| Variable | Meaning | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude key. Without it the app runs with no model (rule reader, code wording). | – |
| `BOTTLECO_DAILY_USD` | Daily spend cap. When reached, the app keeps working without the model. | 2.0 |
| `BOTTLECO_ASK_LIMIT` | Questions per visitor per 10 minutes. | 30 |
| `BOTTLECO_ORIGINS` | Allowed page origins if the page is hosted apart, e.g. `https://noel.sg`. | – |

## What the tests prove

- **Data:** every minute is there; totals in SQLite equal the generator totals; every stopped minute belongs to one stop event; the 10 Sep Line 1 overall score is 51.8% by plain SQL.
- **Same numbers as the preview:** Python KPIs equal the preview's KPIs (28,800 values), and alerts are equal for 3 slider sets.
- **Story events:** at default sliders, each of the 8 story events raises its expected alert, and no other alert raises.
- **No future peek:** every tool gives the same answer when all data after "now" is replaced with junk.
- **Read-only:** a write to the database fails.
- **Answer key is hidden:** the story events are only in `backend/tests/fixtures`, never in the agent database.
- **Line Watcher = preview:** 168 reports (3 slider sets) equal the preview word for word: causes, checks, data analysis, triangulation.
- **Causes at alert time:** with data only up to the alert minute, the top cause is the known cause for the 7 story events that have one; event 8 says "not clear".
- **Number check:** every number is computed twice and must agree. When Claude re-words a report, it may not add, drop or change a number (else retry, then the code template is used).

- **Data Explorer = preview:** 52 questions x 2 slider sets equal the preview word for word.
- **Golden questions (30):** every number equals an independent plain-SQL result; every "why" names the known cause.
- **Trick questions (10):** forecasts, money, energy, people, opinions, Line 3, dates outside the data, dates after "now": all get "not in the data".
- **Claude as planner (live):** Haiku 5.5 and Sonnet 5.5 each passed all 40 (cost for 40 questions: US$0.008 and US$0.16).

## Models

Brain slider: Fast = Claude Haiku 5.5, Balanced = Sonnet 5.5, Deep = Opus 5.5. Wording slider 0 = code templates (no model call).
Put the key in `.env` (`ANTHROPIC_API_KEY=...`, never committed). Live model test: `BOTTLECO_LIVE=1 pytest -q -s -k model_wording`.
