# Engine vs PostgreSQL (5,000,000 records)

Generated 2026-11-19T17:02:34-0500 on 2 CPUs; PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1), shared_buffers 512MB, work_mem 64MB. Median of 15 runs after 2 warm-up; server ms = time inside the backend.

| Case | Matches | Engine ms | PostgreSQL ms | Speed-up |
|---|---:|---:|---:|---:|
| Unfiltered, top 50 by id | 5,000,000 | 10.75 | 119.74 | 11.1x |
| Unfiltered, top 50 by benefit (desc) | 5,000,000 | 19.05 | 121.03 | 6.4x |
| Unfiltered, top 50 by last name | 5,000,000 | 19.88 | 120.03 | 6.0x |
| Name search "smith" | 211,701 | 14.52 | 178.01 | 12.3x |
| Name "mar smi" + MD/VA/DC | 609 | 7.6 | 109.09 | 14.4x |
| Disability, Active, $1.2k-$2k, by benefit | 367,267 | 19.06 | 181.66 | 9.5x |
| Deep page: offset 100,000 by last name | 5,000,000 | 85.74 | 224.48 | 2.6x |
| Exact record id | 1 | 0.0 | 0.42 | n/a (both < 1 ms) |
| Aggregates, unfiltered | 5,000,000 | 19.8 | 1656.63 | 83.7x |
| Aggregates, Retirement in TX | 243,149 | 12.13 | 196.52 | 16.2x |
| Aggregates, "smith" + MD/VA/DC + Retirement | 5,185 | 8.92 | 56.75 | 6.4x |

Throughput, 4 concurrent clients, 10s mixed workload: engine 90.4 req/s (p95 171.6 ms), PostgreSQL 5.1 req/s (p95 3282.0 ms).
