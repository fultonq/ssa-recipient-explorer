#include "sql_backend.hpp"

#include <charconv>
#include <chrono>
#include <cctype>

namespace ssa::sql {
namespace {

using Clock = std::chrono::steady_clock;
double msSince(Clock::time_point t0) { return std::chrono::duration<double, std::milli>(Clock::now() - t0).count(); }

constexpr const char* kColumns =
    "id, first_name, last_name, ssn_last4, birth_year, zip3, state_id, benefit_type_id, status_id, "
    "monthly_cents, entitlement_year";

std::string arrayLiteral(std::uint64_t mask, std::size_t n) {
  std::string s = "{";
  for (std::size_t i = 0; i < n; ++i) {
    if ((mask >> i) & 1) {
      if (s.size() > 1) s += ',';
      s += std::to_string(i);
    }
  }
  return s + "}";
}

// Same tokenisation as Engine::compile: split on whitespace, lower-case ASCII, keep at most 8 tokens.
std::vector<std::string> tokens(const std::string& text) {
  std::vector<std::string> out;
  std::string cur;
  for (char ch : text) {
    if (std::isspace(static_cast<unsigned char>(ch))) {
      if (!cur.empty()) { out.push_back(cur); cur.clear(); }
    } else {
      cur.push_back(ch);
    }
  }
  if (!cur.empty()) out.push_back(cur);
  if (out.size() > 8) out.resize(8);
  return out;
}

template <typename T>
T num(const PGresult* r, int row, int col) {
  T v{};
  const char* s = PQgetvalue(r, row, col);
  std::from_chars(s, s + PQgetlength(r, row, col), v);
  return v;
}

Record toRecord(const PGresult* r, int row) {
  Record rec;
  rec.id = num<std::uint32_t>(r, row, 0);
  rec.firstName = PQgetvalue(r, row, 1);
  rec.lastName = PQgetvalue(r, row, 2);
  rec.last4 = num<std::uint16_t>(r, row, 3);
  rec.birthYear = num<std::uint16_t>(r, row, 4);
  rec.zip3 = num<std::uint16_t>(r, row, 5);
  rec.state = num<std::uint8_t>(r, row, 6);
  rec.type = static_cast<BenefitType>(num<unsigned>(r, row, 7));
  rec.status = static_cast<Status>(num<unsigned>(r, row, 8));
  rec.monthlyCents = num<std::uint32_t>(r, row, 9);
  rec.entitlementYear = num<std::uint16_t>(r, row, 10);
  return rec;
}

}  // namespace

std::string likePattern(std::string_view token) {
  std::string p = "%";
  for (char ch : token) {
    char c = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
    if (c == '\\' || c == '%' || c == '_') p += '\\';
    p += c;
  }
  return p + "%";
}

Where buildWhere(const Filter& f) {
  Where w;
  w.clause = "TRUE";
  auto param = [&](std::string v) {
    w.params.push_back(std::move(v));
    return "$" + std::to_string(w.params.size());
  };

  constexpr std::uint64_t kAllStates = (1ULL << kNumStates) - 1;
  const std::uint64_t states = f.stateMask & kAllStates;
  const std::uint64_t types = f.typeMask & ((1u << kNumTypes) - 1);
  const std::uint64_t statuses = f.statusMask & ((1u << kNumStatuses) - 1);
  if (states != kAllStates) w.clause += " AND state_id = ANY(" + param(arrayLiteral(states, kNumStates)) + "::smallint[])";
  if (types != (1u << kNumTypes) - 1) w.clause += " AND benefit_type_id = ANY(" + param(arrayLiteral(types, kNumTypes)) + "::smallint[])";
  if (statuses != (1u << kNumStatuses) - 1) w.clause += " AND status_id = ANY(" + param(arrayLiteral(statuses, kNumStatuses)) + "::smallint[])";

  if (f.minCents != 0) w.clause += " AND monthly_cents >= " + param(std::to_string(f.minCents)) + "::bigint";
  if (f.maxCents != UINT32_MAX) w.clause += " AND monthly_cents <= " + param(std::to_string(f.maxCents)) + "::bigint";
  if (f.minBirthYear != 0) w.clause += " AND birth_year >= " + param(std::to_string(f.minBirthYear)) + "::int";
  if (f.maxBirthYear != UINT16_MAX) w.clause += " AND birth_year <= " + param(std::to_string(f.maxBirthYear)) + "::int";
  if (f.minEntYear != 0) w.clause += " AND entitlement_year >= " + param(std::to_string(f.minEntYear)) + "::int";
  if (f.maxEntYear != UINT16_MAX) w.clause += " AND entitlement_year <= " + param(std::to_string(f.maxEntYear)) + "::int";
  if (f.last4 >= 0) w.clause += " AND ssn_last4 = " + param(std::to_string(f.last4)) + "::int";
  if (f.id >= 0) w.clause += " AND id = " + param(std::to_string(f.id)) + "::bigint";

  for (const auto& t : tokens(f.text)) {
    const std::string p = param(likePattern(t));
    w.clause += " AND (lower(first_name) LIKE " + p + " ESCAPE '\\' OR lower(last_name) LIKE " + p + " ESCAPE '\\')";
  }
  return w;
}

std::string orderBy(SortKey k, bool desc) {
  const std::string d = desc ? " DESC" : "";
  switch (k) {
    case SortKey::LastName: return "last_name COLLATE \"C\"" + d + ", first_name COLLATE \"C\"" + d + ", id" + d;
    case SortKey::FirstName: return "first_name COLLATE \"C\"" + d + ", last_name COLLATE \"C\"" + d + ", id" + d;
    case SortKey::Benefit: return "monthly_cents" + d + ", id" + d;
    case SortKey::BirthYear: return "birth_year" + d + ", id" + d;
    case SortKey::EntitlementYear: return "entitlement_year" + d + ", id" + d;
    case SortKey::State: return "state_id" + d + ", id" + d;
    case SortKey::Id: break;
  }
  return "id" + d;
}

PageResult query(PGconn* c, const Query& q) {
  const auto t0 = Clock::now();
  const Where w = buildWhere(q.filter);
  PageResult out;
  {
    pg::Result r = pg::exec(c, "SELECT count(*) FROM recipients WHERE " + w.clause, w.params);
    out.total = num<std::uint64_t>(r.get(), 0, 0);
  }
  if (q.limit > 0 && q.offset < out.total) {
    auto params = w.params;
    params.push_back(std::to_string(q.limit));
    const std::string lim = "$" + std::to_string(params.size());
    params.push_back(std::to_string(q.offset));
    const std::string off = "$" + std::to_string(params.size());
    pg::Result r = pg::exec(c,
                            std::string("SELECT ") + kColumns + " FROM recipients WHERE " + w.clause + " ORDER BY " +
                                orderBy(q.sort, q.desc) + " LIMIT " + lim + "::bigint OFFSET " + off + "::bigint",
                            params);
    const int n = PQntuples(r.get());
    out.records.reserve(static_cast<std::size_t>(n));
    for (int i = 0; i < n; ++i) out.records.push_back(toRecord(r.get(), i));
  }
  out.elapsedMs = msSince(t0);
  return out;
}

Stats stats(PGconn* c, const Filter& f) {
  const auto t0 = Clock::now();
  const Where w = buildWhere(f);
  // One scan, five groupings. GROUPING() bits identify which grouping set each row belongs to.
  const std::string sql =
      "SELECT GROUPING(state_id, benefit_type_id, status_id, bucket) AS g, state_id, benefit_type_id, status_id, "
      "bucket, count(*), coalesce(sum(monthly_cents), 0), coalesce(min(monthly_cents), 0), "
      "coalesce(max(monthly_cents), 0) "
      "FROM (SELECT state_id, benefit_type_id, status_id, monthly_cents, "
      "least(monthly_cents / " + std::to_string(kHistBucketCents) + ", " + std::to_string(kHistBuckets - 1) +
      ") AS bucket FROM recipients WHERE " + w.clause +
      ") f GROUP BY GROUPING SETS ((), (state_id), (benefit_type_id), (status_id), (bucket))";
  pg::Result r = pg::exec(c, sql, w.params);
  Stats s;
  for (int i = 0, n = PQntuples(r.get()); i < n; ++i) {
    const auto g = num<int>(r.get(), i, 0);
    const auto cnt = num<std::uint64_t>(r.get(), i, 5);
    switch (g) {
      case 0b1111:  // ()
        s.count = cnt;
        s.sumCents = num<std::uint64_t>(r.get(), i, 6);
        s.minCents = num<std::uint32_t>(r.get(), i, 7);
        s.maxCents = num<std::uint32_t>(r.get(), i, 8);
        break;
      case 0b0111: s.byState.at(num<std::size_t>(r.get(), i, 1)) = cnt; break;
      case 0b1011: s.byType.at(num<std::size_t>(r.get(), i, 2)) = cnt; break;
      case 0b1101: s.byStatus.at(num<std::size_t>(r.get(), i, 3)) = cnt; break;
      case 0b1110: s.benefitHist.at(num<std::size_t>(r.get(), i, 4)) = cnt; break;
      default: break;
    }
  }
  s.elapsedMs = msSince(t0);
  return s;
}

bool get(PGconn* c, std::uint32_t id, Record& out) {
  pg::Result r = pg::exec(c, std::string("SELECT ") + kColumns + " FROM recipients WHERE id = $1::bigint", {std::to_string(id)});
  if (PQntuples(r.get()) != 1) return false;
  out = toRecord(r.get(), 0);
  return true;
}

}  // namespace ssa::sql
