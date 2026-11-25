#pragma once
// PostgreSQL implementation of the same query/stats/get semantics as ssa::Engine. Requests are parsed
// once by ssa::api, so both backends see an identical ssa::Query / ssa::Filter.
#include <string>
#include <vector>

#include "pg.hpp"
#include "ssa/engine.hpp"

namespace ssa::sql {

// A WHERE clause plus its positional parameters ($1..$n), built only from the parsed Filter.
struct Where {
  std::string clause;  // e.g. "TRUE AND state_id = ANY($1::smallint[])"
  std::vector<std::string> params;
};

Where buildWhere(const Filter& f);
std::string orderBy(SortKey k, bool desc);
// Lower-cases ASCII exactly like the engine and escapes LIKE metacharacters (\ % _).
std::string likePattern(std::string_view token);

struct PageResult {
  std::uint64_t total = 0;
  std::vector<Record> records;
  double elapsedMs = 0;
};

PageResult query(PGconn* c, const Query& q);
Stats stats(PGconn* c, const Filter& f);
bool get(PGconn* c, std::uint32_t id, Record& out);

}  // namespace ssa::sql
