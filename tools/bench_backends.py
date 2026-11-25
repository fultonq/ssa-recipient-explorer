#!/usr/bin/env python3
"""Benchmark: C++ in-memory engine vs PostgreSQL on identical requests through the same HTTP server.

For each case, both backends are measured alternately (same warm caches, same machine state):
  * server ms  - time inside the backend (engine scan / SQL round-trips), from the response's elapsedMs
  * client ms  - end-to-end HTTP time seen by the client (includes JSON + transport)
Then a short closed-loop throughput test with concurrent clients.

    python3 tools/bench_backends.py [--url http://localhost:8080] [--reps 15] [--out docs/results]

Writes <out>/benchmark.json and <out>/benchmark.md. Standard library only.
"""
import argparse
import json
import os
import platform
import statistics
import subprocess
import threading
import time
import urllib.request

CASES = [
    ("Unfiltered, top 50 by id", "query", {"limit": 50}),
    ("Unfiltered, top 50 by benefit (desc)", "query", {"sort": "benefit", "desc": True, "limit": 50}),
    ("Unfiltered, top 50 by last name", "query", {"sort": "lastName", "limit": 50}),
    ("Name search \"smith\"", "query", {"text": "smith", "limit": 50}),
    ("Name \"mar smi\" + MD/VA/DC", "query", {"text": "mar smi", "states": ["MD", "VA", "DC"], "limit": 50}),
    ("Disability, Active, $1.2k-$2k, by benefit", "query",
     {"types": ["Disability"], "statuses": ["Active"], "minBenefit": 1200, "maxBenefit": 2000, "sort": "benefit",
      "limit": 50}),
    ("Deep page: offset 100,000 by last name", "query", {"sort": "lastName", "offset": 100000, "limit": 50}),
    ("Exact record id", "query", {"id": 1234567}),
    ("Aggregates, unfiltered", "stats", {}),
    ("Aggregates, Retirement in TX", "stats", {"types": ["Retirement"], "states": ["TX"]}),
    ("Aggregates, \"smith\" + MD/VA/DC + Retirement", "stats",
     {"text": "smith", "states": ["MD", "VA", "DC"], "types": ["Retirement"]}),
]
BACKENDS = ["engine", "postgres"]


def post(base, path, body, timeout=120):
    req = urllib.request.Request(base + path, data=json.dumps(body).encode(), method="POST")
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        payload = json.loads(r.read())
    return payload, (time.perf_counter() - t0) * 1000


def p95(xs):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(0.95 * (len(xs) - 1))))]


def pg_settings():
    keys = ["server_version", "shared_buffers", "work_mem", "max_parallel_workers_per_gather", "effective_cache_size"]
    out = {}
    for k in keys:
        try:
            out[k] = subprocess.run(["psql", "-tAXc", f"SHOW {k}"], capture_output=True, text=True,
                                    timeout=10).stdout.strip() or None
        except (OSError, subprocess.SubprocessError):
            out[k] = None
    return out


def throughput(base, backend, clients, seconds):
    """Closed loop: each client sends the next request as soon as the previous returns."""
    mix = [c for c in CASES if c[2] != {"id": 1234567}]
    lat, errors, stop = [], [0], time.perf_counter() + seconds
    lock = threading.Lock()

    def worker(i):
        k = i
        while time.perf_counter() < stop:
            _, kind, body = mix[k % len(mix)]
            k += 1
            try:
                _, ms = post(base, f"/api/{kind}?backend={backend}", body)
                with lock:
                    lat.append(ms)
            except Exception:  # noqa: BLE001 - count, don't crash the run
                with lock:
                    errors[0] += 1

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(clients)]
    t0 = time.perf_counter()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    wall = time.perf_counter() - t0
    return {"clients": clients, "seconds": round(wall, 2), "requests": len(lat), "errors": errors[0],
            "rps": round(len(lat) / wall, 1), "median_ms": round(statistics.median(lat), 1) if lat else None,
            "p95_ms": round(p95(lat), 1) if lat else None}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default="http://localhost:8080")
    ap.add_argument("--reps", type=int, default=15)
    ap.add_argument("--warmup", type=int, default=2)
    ap.add_argument("--clients", type=int, default=4)
    ap.add_argument("--seconds", type=int, default=10)
    ap.add_argument("--out", default="docs/results")
    a = ap.parse_args()

    with urllib.request.urlopen(a.url + "/api/health", timeout=10) as r:
        health = json.loads(r.read())
    print(f"benchmarking {health['records']:,} records; {a.reps} reps per case after {a.warmup} warm-up")

    results = []
    for name, kind, body in CASES:
        row = {"case": name, "kind": kind, "request": body}
        samples = {b: {"server": [], "client": []} for b in BACKENDS}
        for i in range(a.warmup + a.reps):
            for b in (BACKENDS if i % 2 == 0 else BACKENDS[::-1]):  # alternate order to cancel drift
                payload, ms = post(a.url, f"/api/{kind}?backend={b}", body)
                if i >= a.warmup:
                    samples[b]["server"].append(payload["elapsedMs"])
                    samples[b]["client"].append(ms)
                row["matches"] = payload.get("total", payload.get("count"))
        for b in BACKENDS:
            s = samples[b]
            row[b] = {"server_median_ms": round(statistics.median(s["server"]), 2),
                      "server_p95_ms": round(p95(s["server"]), 2),
                      "client_median_ms": round(statistics.median(s["client"]), 2),
                      "client_p95_ms": round(p95(s["client"]), 2)}
        # Below the engine's timer resolution a ratio is meaningless (exact-id lookups): report none.
        e_ms = row["engine"]["server_median_ms"]
        row["speedup"] = round(row["postgres"]["server_median_ms"] / e_ms, 1) if e_ms >= 0.05 else None
        results.append(row)
        print(f"  {name:<46} engine {row['engine']['server_median_ms']:>8.2f} ms   "
              f"postgres {row['postgres']['server_median_ms']:>9.2f} ms   "
              f"{'x' + str(row['speedup']) if row['speedup'] else 'both < 1 ms'}")

    tput = {}
    for b in BACKENDS:
        tput[b] = throughput(a.url, b, a.clients, a.seconds)
        print(f"  throughput {b:<9} {tput[b]['rps']:>7} req/s  p95 {tput[b]['p95_ms']} ms  "
              f"({tput[b]['clients']} clients, {tput[b]['errors']} errors)")

    report = {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "records": health["records"],
        "machine": {"cpus": os.cpu_count(), "platform": platform.platform(), "python": platform.python_version()},
        "postgres": pg_settings(),
        "method": {"reps": a.reps, "warmup": a.warmup, "order": "alternating", "server_ms": "backend elapsedMs",
                   "client_ms": "end-to-end HTTP"},
        "cases": results,
        "throughput": tput,
    }
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "benchmark.json"), "w") as f:
        json.dump(report, f, indent=2)
    with open(os.path.join(a.out, "benchmark.md"), "w") as f:
        f.write(f"# Engine vs PostgreSQL ({health['records']:,} records)\n\n")
        f.write(f"Generated {report['generated']} on {os.cpu_count()} CPUs; PostgreSQL "
                f"{report['postgres'].get('server_version')}, shared_buffers {report['postgres'].get('shared_buffers')}, "
                f"work_mem {report['postgres'].get('work_mem')}. Median of {a.reps} runs after {a.warmup} warm-up; "
                "server ms = time inside the backend.\n\n")
        f.write("| Case | Matches | Engine ms | PostgreSQL ms | Speed-up |\n|---|---:|---:|---:|---:|\n")
        for r in results:
            f.write(f"| {r['case']} | {r['matches']:,} | {r['engine']['server_median_ms']} | "
                    f"{r['postgres']['server_median_ms']} | {str(r['speedup']) + 'x' if r['speedup'] else 'n/a (both < 1 ms)'} |\n")
        f.write(f"\nThroughput, {a.clients} concurrent clients, {a.seconds}s mixed workload: engine "
                f"{tput['engine']['rps']} req/s (p95 {tput['engine']['p95_ms']} ms), PostgreSQL "
                f"{tput['postgres']['rps']} req/s (p95 {tput['postgres']['p95_ms']} ms).\n")
    print(f"wrote {a.out}/benchmark.json and benchmark.md")


if __name__ == "__main__":
    main()
