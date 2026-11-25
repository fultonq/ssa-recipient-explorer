# Research notes: in-memory C++ engine vs PostgreSQL

## Question

For interactive analyst search over millions of benefit records, how much does a purpose-built in-memory columnar
engine gain over a well-indexed PostgreSQL database, what does it cost, and can we show the two return exactly
the same answers?

## Systems under test

| | C++ engine | PostgreSQL 16 |
|---|---|---|
| Storage | Struct-of-arrays in RAM; names dictionary-coded (sorted dictionaries, so codes are alphabetical ranks); ~19 bytes/record | Heap table + 13 indexes: B-tree on every filter and sort key, trigram GIN on lower(name) |
| Size, 5M rows | 91 MB resident | 338 MB table, 1.48 GB with indexes |
| Filters | One sequential pass; state/type/status as bitmasks; name tokens pre-matched against the dictionaries once per query | Planner chooses index / bitmap / sequential scans; `LIKE '%tok%'` via trigram index |
| Sort + page | Selection of the requested window only (heap for small windows, `nth_element` for large) | `ORDER BY ... LIMIT/OFFSET` over byte-order (`COLLATE "C"`) indexes |
| Total count | Free by-product of the scan | Separate exact `count(*)` |
| Aggregates | Same single pass: count/sum/min/max, by state/type/status, histogram | One `GROUPING SETS` query (one scan, five groupings) |
| Freshness | Snapshot loaded at startup (3.2 s for 5M rows via `COPY`) | Live, transactional (MVCC) |

Both run behind the same HTTP server and the same request parser (`ssa::api::parseQuery`), so they receive
identical, already-validated `Query` objects; responses are formatted by the same code.

## Method

* **Data:** 5,000,000 synthetic records (seed 2026): state weighted by population, six benefit types with
  type-specific age and benefit distributions, 92% Active. 128 first names x 560 last names, skewed.
* **Machine:** 2-vCPU Linux VM, 7 GB RAM; PostgreSQL 16.15 with `shared_buffers=512MB`, `work_mem=64MB`,
  `max_parallel_workers_per_gather=2`; data fully cached (warm). Server and database on the same machine.
* **Timing:** `tools/bench_backends.py`. 11 representative cases, 2 warm-up + 15 measured runs per backend,
  backends **alternated** each iteration to cancel drift. Reported: median server-side time (inside the backend);
  client end-to-end time is in `results/benchmark.json` and is consistently ~1 ms higher.
* **Throughput:** 4 closed-loop clients for 10 s per backend on a mix of the 10 non-trivial cases.

## Results (median ms, 5M rows)

| Case | Matches | Engine | PostgreSQL | Speed-up |
|---|---:|---:|---:|---:|
| Unfiltered, top 50 by id | 5,000,000 | 10.8 | 119.7 | 11.1x |
| Unfiltered, top 50 by benefit (desc) | 5,000,000 | 19.1 | 121.0 | 6.4x |
| Unfiltered, top 50 by last name | 5,000,000 | 19.9 | 120.0 | 6.0x |
| Name search "smith" | 211,701 | 14.5 | 178.0 | 12.3x |
| Name "mar smi" + MD/VA/DC | 609 | 7.6 | 109.1 | 14.4x |
| Disability, Active, $1.2k–$2k, by benefit | 367,267 | 19.1 | 181.7 | 9.5x |
| Deep page: offset 100,000 by last name | 5,000,000 | 85.7 | 224.5 | 2.6x |
| Exact record id | 1 | < 0.01 | 0.42 | both < 1 ms |
| Aggregates, unfiltered | 5,000,000 | 19.8 | 1,656.6 | 83.7x |
| Aggregates, Retirement in TX | 243,149 | 12.1 | 196.5 | 16.2x |
| Aggregates, "smith" + MD/VA/DC + Retirement | 5,185 | 8.9 | 56.8 | 6.4x |

**Throughput (4 clients):** engine 90.4 req/s (median 31 ms, p95 172 ms); PostgreSQL 5.1 req/s (median 427 ms,
p95 3,282 ms). Both: 0 errors.

## Findings

1. **The engine wins every non-trivial case, by 2.6x to 84x.** The gap is smallest where both systems must do
   similar work (deep paging: the engine still selects 100,050 rows) and largest where PostgreSQL must touch every
   row with per-row executor overhead (unfiltered aggregates).
2. **Exact totals dominate PostgreSQL's cost for paged browsing.** For "unfiltered, top 50 by id", the page itself
   costs 0.75 ms via the primary key; the exact `count(*)` over 5M rows costs ~108 ms. Showing "1–50 of 5,000,000"
   exactly is what is expensive. An estimated count (`pg_class.reltuples` / `EXPLAIN`) or keyset pagination would
   change that picture and is a fair next experiment.
3. **We gave PostgreSQL its best formulation we could find.** For aggregates, `GROUPING SETS` (one scan) ran
   ~1.5 s unfiltered and is single-threaded. A single parallel scan with 74 `FILTER` aggregates was only ~15%
   faster unfiltered (1.25–1.33 s) and *slower* when filtered (241 ms vs 186 ms), so `GROUPING SETS` was kept.
   Pre-aggregation (materialized views) would make unfiltered aggregates near-instant but changes the problem
   (staleness, per-filter combinations).
4. **Under concurrency the gap widens (~18x).** On 2 cores PostgreSQL's parallel workers compete with concurrent
   queries; the engine's single-pass scans are short enough to interleave.
5. **Correctness is demonstrable, not assumed** (next section).

Earlier phases, same engine: a line-for-line **Rust** port matched C++ within noise once both were tuned (the
initial Rust lead was tuning, not language); **NumPy** was 3–5x slower on scans and aggregates. See
`experiments/` and the executive briefing deck.

## Verification

* **Unit tests:** 120,060 engine checks (filters vs an independent brute-force matcher, sort order, paging,
  stats invariants, JSON errors, builder round-trip); 39 server checks (SQL translation, parameter binding,
  LIKE escaping, COPY parsing).
* **Backend equivalence:** `tools/compare_backends.py` sends each request to both backends and compares the full
  JSON (all records, totals, every aggregate), ignoring only `elapsedMs`. On 5M rows: 62 targeted + 300 random
  requests (≈ 790 compared responses), **0 mismatches**.
* **The checker can fail:** two bugs planted in a scratch copy of the SQL backend.
  * `monthly_cents > min` instead of `>=`: caught by random requests (6 of 60).
  * Descending benefit sort with an ascending id tie-break: **survived 60 random requests**. Only ~4 of them used
    that sort, and their filtered results rarely had ties at a page boundary. Targeted cases (every sort key x
    direction over tie-heavy result sets) were added; the bug is now caught on the first case. Lesson: random
    testing needs coverage-directed cases for ordering semantics.
* **Independent oracle (earlier phase):** a NumPy re-implementation matched the engine on 1,100 random queries.
* **Sanitizers:** tests and the live server (real, malformed and oversized requests, shutdown) under
  AddressSanitizer + UBSan: no reports, no leaks.

## Threats to validity

* **Small machine.** 2 vCPUs limit PostgreSQL's parallel query far more than they limit a single-pass scan.
  Re-run on target hardware (`tools/bench_backends.py`); absolute numbers will change, ordering likely not.
* **Synthetic names.** Only ~690 distinct names, so the engine's dictionary pre-matching is nearly free. Real
  data has far more distinct names; name search will slow down (dictionary matching grows with distinct names)
  and the 65,535-name limit must be widened.
* **Unequal guarantees.** PostgreSQL is live, durable and transactional; the engine is a read-only snapshot.
  The comparison is "interactive read path", not "database vs database".
* **Tuning is never exhaustive.** Indexes cover every filter and sort key, settings are sensible, and two
  aggregate formulations were tried; materialized views, estimated counts or extensions (e.g. columnar storage)
  were deliberately out of scope.
* **Same-host database.** No network latency between server and database; a remote database adds latency to
  every PostgreSQL request, which would widen the gap.

## Reproduce

```bash
docker compose up --build -d                          # or a local cluster + db/seed.sh
python3 tools/compare_backends.py --queries 300       # equivalence
python3 tools/bench_backends.py                       # writes docs/results/benchmark.{json,md}
```
