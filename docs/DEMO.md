# Live demo script (about 12 minutes)

Companion to `docs/SSA-Recipient-Explorer-Research-Demo.pptx` (the slide notes repeat the cues below).

## Before the session (allow 15 minutes)

1. `docker compose up --build -d`, then `docker compose logs -f app` until you see
   `listening on http://0.0.0.0:8080`. First start seeds 5M rows (~1 min plus the image build). Do this **before**
   the room fills; the volume persists, so later starts take seconds.
2. Browser at http://localhost:8080, zoom 110–125%, 3270 theme (or **Standard** for projectors with poor contrast).
   Clear all filters. Cross-check switch **on**, backend **C++ engine**.
3. Terminal (large font) in the repository root, two tabs:
   `python3 tools/compare_backends.py --queries 40` (ready, not run) and
   `docker compose exec db psql -U ssa ssa`.
4. Open `docs/screenshots/` as the fallback if anything fails live.

## Run of show

| Time | Do | Say |
|---|---|---|
| 0:00 | Slide: Architecture | "One server, two engines behind the same API. PostgreSQL is the system of record; the C++ engine loads a snapshot of it at startup." |
| 1:00 | App, top bar | Point at **5,000,000 records · 91 MB · loaded from PostgreSQL in ~3 s**. "Five million rows in 91 megabytes." |
| 1:30 | Type `smith` | Cross-check line appears: **identical page**, both timings. "Every page you see is answered twice and compared." |
| 2:30 | States MD, VA, DC; type Retirement; sort Monthly benefit twice (descending) | "Same as the screenshot in the deck: 5,185 matches; the top record is SYN-03178999 at $4,053.81." |
| 3:30 | Click **PostgreSQL** | Badge now says PostgreSQL; numbers and records unchanged; timings swap roles. |
| 4:30 | Click **Reset**; stay on PostgreSQL | Aggregates over all 5M rows take ~1.5 s: the stats cards visibly lag. Switch to **C++ engine**: ~20 ms. "This is the 84x case." |
| 5:30 | Sort Last name; type `2000` in **Go to…** | Deep paging (offset ~100k): engine ~85 ms vs ~225 ms. "Our smallest win: both sides really have to do the work." |
| 6:30 | Terminal: run the cross-check | 62 targeted + 40 random requests, **0 mismatches** in ~30 s. Tell the tie-break story (slide "The checker can fail"). |
| 8:30 | psql: `EXPLAIN ANALYZE SELECT count(*) FROM recipients;` | "~108 ms of PostgreSQL's 120 ms for an unfiltered page is the exact total. That's a design choice, not a tuning bug." |
| 9:30 | Slides: results, findings, threats | Read the threats slide out loud: 2 vCPUs, synthetic names, unequal guarantees. |
| 11:00 | Slide: next steps / questions | |

## If something goes wrong

| Problem | Recovery |
|---|---|
| Docker or the database will not start | `build/release/server/ssa_server --source=generate --static=web/dist`: engine only, no PostgreSQL switch; or show the screenshots |
| Seed is still running | `docker compose logs -f seed`; meanwhile present slides 1–5 |
| Port 8080 busy | `APP_PORT=8090 docker compose up -d` |
| Slow projector laptop | Lower `SSA_RECORDS` in `.env` to 1,000,000 and `docker compose down -v && docker compose up -d`; say so |
| Cross-check shows a mismatch | Do not hide it. Copy the request from the browser's network tab; it is a real bug report |

## Likely questions

* **"Why not just tune PostgreSQL?"** We indexed every filter and sort key and tried two aggregate formulations
  (`docs/RESEARCH.md`, finding 3). The fair next experiments are estimated counts, keyset pagination and
  materialized views. They help some cases and change the semantics.
* **"What happens when data changes?"** Today, restart (3 s for 5M rows). Next: `LISTEN/NOTIFY` or logical
  replication to apply deltas.
* **"Does this scale to real SSA volumes?"** Memory is ~19 bytes/record (≈ 1.3 GB for 70M), so a single server
  can hold it; real name diversity and authorization are the harder problems.
* **"Why C++ and not Rust?"** A Rust port matched C++ within noise once both were tuned; the choice is about
  safety and staffing, not speed.
