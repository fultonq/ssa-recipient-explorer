#include "pg_loader.hpp"

#include <array>
#include <charconv>
#include <chrono>

#include "pg.hpp"

namespace ssa::pg {
namespace {

constexpr const char* kCopySql =
    "COPY (SELECT id, first_name, last_name, ssn_last4, birth_year, zip3, state_id, benefit_type_id, "
    "status_id, monthly_cents, entitlement_year FROM recipients ORDER BY id) TO STDOUT";

// COPY text format escapes backslash, tab, newline and carriage return.
std::string_view unescape(std::string_view f, std::string& scratch) {
  if (f.find('\\') == std::string_view::npos) return f;
  scratch.clear();
  for (std::size_t i = 0; i < f.size(); ++i) {
    if (f[i] != '\\' || i + 1 == f.size()) { scratch += f[i]; continue; }
    char e = f[++i];
    scratch += e == 't' ? '\t' : e == 'n' ? '\n' : e == 'r' ? '\r' : e;
  }
  return scratch;
}

template <typename T>
bool num(std::string_view s, T& out) {
  auto [p, ec] = std::from_chars(s.data(), s.data() + s.size(), out);
  return ec == std::errc() && p == s.data() + s.size();
}

}  // namespace

bool parseCopyLine(std::string_view line, InputRow& row, std::string& scratchFirst, std::string& scratchLast,
                   std::string& err) {
  if (!line.empty() && line.back() == '\n') line.remove_suffix(1);
  std::array<std::string_view, 11> f;
  std::size_t n = 0, start = 0;
  for (std::size_t i = 0; i <= line.size(); ++i) {
    if (i == line.size() || line[i] == '\t') {
      if (n == f.size()) { err = "too many columns"; return false; }
      f[n++] = line.substr(start, i - start);
      start = i + 1;
    }
  }
  if (n != f.size()) { err = "expected 11 columns, got " + std::to_string(n); return false; }
  for (const auto& col : f) {
    if (col == "\\N") { err = "unexpected NULL"; return false; }
  }
  unsigned state = 0, type = 0, status = 0;
  bool ok = num(f[0], row.id) && num(f[3], row.last4) && num(f[4], row.birthYear) && num(f[5], row.zip3) &&
            num(f[6], state) && num(f[7], type) && num(f[8], status) && num(f[9], row.monthlyCents) &&
            num(f[10], row.entitlementYear) && state < 256 && type < 256 && status < 256;
  if (!ok) { err = "malformed numeric column"; return false; }
  row.state = static_cast<std::uint8_t>(state);
  row.type = static_cast<std::uint8_t>(type);
  row.status = static_cast<std::uint8_t>(status);
  row.firstName = unescape(f[1], scratchFirst);
  row.lastName = unescape(f[2], scratchLast);
  return true;
}

LoadStats loadEngine(PGconn* c, Engine& out) {
  const auto t0 = std::chrono::steady_clock::now();
  std::size_t expected = 0;
  {
    Result r = exec(c, "SELECT count(*) FROM recipients");
    expected = std::stoull(PQgetvalue(r.get(), 0, 0));
  }
  Result start(PQexec(c, kCopySql));
  if (!start || PQresultStatus(start.get()) != PGRES_COPY_OUT) throw Error(std::string("COPY failed: ") + PQerrorMessage(c));

  EngineBuilder b;
  b.reserve(expected);
  std::string err, s1, s2;
  InputRow row;
  bool failed = false;
  for (;;) {
    char* buf = nullptr;
    int len = PQgetCopyData(c, &buf, 0);
    if (len == -1) break;  // done
    if (len == -2) throw Error(std::string("COPY stream error: ") + PQerrorMessage(c));
    std::string_view line(buf, static_cast<std::size_t>(len));
    if (!failed && (!parseCopyLine(line, row, s1, s2, err) || !b.add(row, err))) failed = true;
    PQfreemem(buf);  // keep draining even after a failure so the connection stays usable
  }
  Result end(PQgetResult(c));
  if (!end || PQresultStatus(end.get()) != PGRES_COMMAND_OK) throw Error(std::string("COPY did not complete: ") + PQerrorMessage(c));
  while (Result extra{PQgetResult(c)}) {
  }
  if (failed) throw Error("invalid data in recipients: " + err);
  if (!b.build(out, err)) throw Error("cannot build engine: " + err);
  return {out.size(), std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count()};
}

}  // namespace ssa::pg
