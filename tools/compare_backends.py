#!/usr/bin/env python3
"""Equivalence check: the C++ engine and PostgreSQL must give identical answers.

Fires random /api/query, /api/stats and /api/records requests at a running ssa_server, once per backend,
and compares the JSON responses (ignoring elapsedMs). Any difference is a bug in one backend.

    python3 tools/compare_backends.py [--url http://localhost:8080] [--queries 300] [--seed 1]

Standard library only. Exit code 1 on any mismatch.
"""
import argparse
import json
import random
import sys
import time
import urllib.error
import urllib.request

STATES = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS",
          "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC",
          "ND", "OH", "OK", "OR", "PA", "PR", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"]
TYPES = ["Retirement", "Disability", "Survivor", "SSI", "Spouse", "Child"]
STATUSES = ["Active", "Pending", "Suspended", "Terminated"]
SORTS = ["id", "lastName", "firstName", "benefit", "birthYear", "entitlementYear", "state"]


def call(base, method, path, body=None, timeout=60):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=data, method=method)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            status, payload = r.status, r.read()
    except urllib.error.HTTPError as e:
        status, payload = e.code, e.read()
    return status, json.loads(payload), (time.perf_counter() - t0) * 1000


def name_pool(base, rnd):
    """Real name fragments taken from the data, so text filters actually hit rows."""
    names = set()
    for _ in range(5):
        _, d, _ = call(base, "POST", "/api/query?backend=engine",
                       {"sort": "lastName", "offset": rnd.randrange(0, 100000), "limit": 200})
        for r in d["records"]:
            names.update((r["firstName"], r["lastName"]))
    return sorted(names)


def random_filter(rnd, names, n_records):
    f = {}
    if rnd.random() < .5:
        toks = []
        for _ in range(rnd.randint(1, 3)):
            if rnd.random() < .1:
                toks.append(rnd.choice(["zzq", "50%", "a_b", "o'b", "\\"]))  # no-hit and LIKE metacharacters
            else:
                w = rnd.choice(names)
                a = rnd.randrange(0, max(1, len(w) - 2))
                toks.append(w[a:a + rnd.randint(2, 5)])
        f["text"] = " ".join(toks) if rnd.random() < .8 else "  " + toks[0].upper() + "  "
    if rnd.random() < .4: f["states"] = rnd.sample(STATES, rnd.randint(0, 8))
    if rnd.random() < .4: f["types"] = rnd.sample(TYPES, rnd.randint(0, 4))
    if rnd.random() < .4: f["statuses"] = rnd.sample(STATUSES, rnd.randint(0, 3))
    if rnd.random() < .4: f["minBenefit"] = round(rnd.uniform(0, 3000), 2)
    if rnd.random() < .4: f["maxBenefit"] = round(rnd.uniform(500, 4500), 2)  # may be < min: empty result
    for key, lo, hi in [("minBirthYear", 1925, 2010), ("maxBirthYear", 1925, 2010),
                        ("minEntYear", 1974, 2026), ("maxEntYear", 1974, 2026)]:
        if rnd.random() < .3: f[key] = rnd.randint(lo, hi)
    if rnd.random() < .1: f["last4"] = rnd.randint(0, 9999)
    if rnd.random() < .05: f["id"] = rnd.randint(0, n_records + 3)  # includes 0 and out of range
    return f


def targeted_cases():
    """Deterministic cases random sampling under-covers: every sort key x direction over large, tie-heavy
    result sets (thousands of rows share a birth year or a cent value), at page boundaries deep and shallow.
    Added after a planted tie-break bug survived 60 random queries (see README, 'Verification')."""
    for sort in SORTS:
        for desc in (False, True):
            for offset in (0, 999, 123457):
                yield {"sort": sort, "desc": desc, "offset": offset, "limit": 1000}
            yield {"types": ["SSI"], "statuses": ["Active"], "sort": sort, "desc": desc, "offset": 5000, "limit": 500}
    yield {"maxBenefit": 0}                      # empty result
    yield {"minBenefit": 4000, "maxBenefit": 1}  # impossible range
    yield {"text": "%"}                          # LIKE metacharacter must be literal
    yield {"text": "_"}
    yield {"id": 0}
    yield {"last4": 0, "sort": "benefit", "desc": True}


def strip(d):
    d = dict(d)
    d.pop("elapsedMs", None)
    return d


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default="http://localhost:8080")
    ap.add_argument("--queries", type=int, default=300)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--no-targeted", action="store_true", help="random requests only")
    a = ap.parse_args()
    rnd = random.Random(a.seed)

    status, health, _ = call(a.url, "GET", "/api/health")
    if status != 200 or "postgres" not in health.get("backends", []):
        sys.exit(f"server not ready for comparison: {health}")
    n = health["records"]
    names = name_pool(a.url, rnd)
    print(f"comparing backends on {n:,} records: targeted cases + {a.queries} random requests (seed {a.seed})")

    mismatches = nonempty = 0
    t_engine = t_pg = 0.0

    def requests():
        for q in ([] if a.no_targeted else list(targeted_cases())):
            f = {k: v for k, v in q.items() if k not in ("sort", "desc", "offset", "limit")}
            yield "targeted", [("POST", "/api/query", q), ("POST", "/api/stats", f)]
        for _ in range(a.queries):
            f = random_filter(rnd, names, n)
            q = dict(f, sort=rnd.choice(SORTS), desc=rnd.random() < .5,
                     offset=rnd.choice([0, 0, 0, 7, 50, 1000, 20000]), limit=rnd.choice([1, 10, 50, 100, 1000]))
            checks = [("POST", "/api/query", q), ("POST", "/api/stats", f)]
            if rnd.random() < .2:
                checks.append(("GET", f"/api/records/{rnd.randint(0, n + 2)}", None))
            yield "random", checks

    done = {"targeted": 0, "random": 0}
    for kind, checks in requests():
        done[kind] += 1
        for method, path, body in checks:
            se, de, me = call(a.url, method, path + "?backend=engine", body)
            sp, dp, mp = call(a.url, method, path + "?backend=postgres", body)
            t_engine += me
            t_pg += mp
            if (se, strip(de)) != (sp, strip(dp)):
                mismatches += 1
                if mismatches <= 5:
                    print(f"MISMATCH {method} {path} {json.dumps(body)}\n  engine   [{se}] {json.dumps(strip(de))[:300]}"
                          f"\n  postgres [{sp}] {json.dumps(strip(dp))[:300]}")
            elif path == "/api/query" and de.get("total", 0) > 0:
                nonempty += 1
        if kind == "random" and done["random"] % 50 == 0:
            print(f"  {done['random']}/{a.queries} random requests checked, {mismatches} mismatches")

    print(f"done: {done['targeted']} targeted + {done['random']} random requests; {mismatches} mismatches; "
          f"{nonempty} queries had non-empty results; "
          f"client time engine {t_engine / 1000:.1f}s vs postgres {t_pg / 1000:.1f}s")
    sys.exit(1 if mismatches else 0)


if __name__ == "__main__":
    main()
