// Writes the deterministic synthetic dataset as CSV (with header) for PostgreSQL COPY:
//   ssa_export <records> [seed=2026] | psql -c "\copy recipients FROM STDIN WITH (FORMAT csv, HEADER true)"
// Column order matches db/schema.sql. Coded columns (state_id, benefit_type_id, status_id) use the
// engine's indices, which the lookup tables in db/schema.sql mirror exactly.
#include <charconv>
#include <cstdio>
#include <cstdlib>
#include <string>

#include "ssa/engine.hpp"

namespace {
char buf[1 << 16];
std::size_t used = 0;

void flush() {
  std::fwrite(buf, 1, used, stdout);
  used = 0;
}
void put(std::string_view s) {
  if (used + s.size() > sizeof buf) flush();
  std::copy(s.begin(), s.end(), buf + used);
  used += s.size();
}
void putNum(unsigned long long v) {
  char tmp[24];
  auto [end, ec] = std::to_chars(tmp, tmp + sizeof tmp, v);
  put(std::string_view(tmp, static_cast<std::size_t>(end - tmp)));
}
// CSV-quote only when needed (synthetic names never need it, but the tool must not corrupt data).
void putText(const std::string& s) {
  if (s.find_first_of(",\"\n\r") == std::string::npos) { put(s); return; }
  std::string q = "\"";
  for (char c : s) { if (c == '"') q += '"'; q += c; }
  q += '"';
  put(q);
}
}  // namespace

int main(int argc, char** argv) {
  if (argc < 2) {
    std::fprintf(stderr, "usage: ssa_export <records> [seed=2026]\n");
    return 2;
  }
  const auto n = static_cast<std::uint32_t>(std::strtoull(argv[1], nullptr, 10));
  const auto seed = argc > 2 ? std::strtoull(argv[2], nullptr, 10) : 2026ULL;
  ssa::Engine e;
  e.generate(n, seed);

  put("id,first_name,last_name,ssn_last4,birth_year,zip3,state_id,benefit_type_id,status_id,monthly_cents,entitlement_year\n");
  for (std::uint32_t i = 0; i < e.size(); ++i) {
    const ssa::Record r = e.record(i);
    putNum(r.id); put(",");
    putText(r.firstName); put(",");
    putText(r.lastName); put(",");
    putNum(r.last4); put(",");
    putNum(r.birthYear); put(",");
    putNum(r.zip3); put(",");
    putNum(r.state); put(",");
    putNum(static_cast<unsigned>(r.type)); put(",");
    putNum(static_cast<unsigned>(r.status)); put(",");
    putNum(r.monthlyCents); put(",");
    putNum(r.entitlementYear); put("\n");
  }
  flush();
  return std::ferror(stdout) ? 1 : 0;
}
