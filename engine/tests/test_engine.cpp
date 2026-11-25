// Dependency-free tests. Run: ctest, or ./ssa_tests
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <string>

#include "ssa/api.hpp"
#include "ssa/engine.hpp"

static int g_fail = 0, g_checks = 0;
#define CHECK(cond)                                                              \
  do {                                                                           \
    ++g_checks;                                                                  \
    if (!(cond)) { ++g_fail; std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond); } \
  } while (0)

using namespace ssa;

static bool lowerContains(const std::string& hay, const std::string& needle) {
  std::string h = hay, n = needle;
  for (char& c : h) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  for (char& c : n) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return h.find(n) != std::string::npos;
}

// Independent brute-force matcher working only on public Record data.
static bool bruteMatch(const Record& r, const Filter& f) {
  if (!((f.stateMask >> r.state) & 1)) return false;
  if (!((f.typeMask >> static_cast<int>(r.type)) & 1)) return false;
  if (!((f.statusMask >> static_cast<int>(r.status)) & 1)) return false;
  if (r.monthlyCents < f.minCents || r.monthlyCents > f.maxCents) return false;
  if (r.birthYear < f.minBirthYear || r.birthYear > f.maxBirthYear) return false;
  if (r.entitlementYear < f.minEntYear || r.entitlementYear > f.maxEntYear) return false;
  if (f.last4 >= 0 && r.last4 != f.last4) return false;
  std::string tok;
  std::string text = f.text + " ";
  for (char c : text) {
    if (c == ' ') {
      if (!tok.empty()) {
        if (!lowerContains(r.firstName, tok) && !lowerContains(r.lastName, tok)) return false;
        tok.clear();
      }
    } else tok.push_back(c);
  }
  return true;
}

static std::uint64_t bruteCount(const Engine& e, const Filter& f) {
  std::uint64_t n = 0;
  for (std::uint32_t i = 0; i < e.size(); ++i) n += bruteMatch(e.record(i), f);
  return n;
}

static void testDeterminism() {
  Engine a, b;
  a.generate(5000, 42);
  b.generate(5000, 42);
  bool same = true;
  for (std::uint32_t i = 0; i < 5000; ++i) {
    Record x = a.record(i), y = b.record(i);
    same &= x.firstName == y.firstName && x.lastName == y.lastName && x.monthlyCents == y.monthlyCents &&
            x.birthYear == y.birthYear && x.state == y.state && x.last4 == y.last4;
  }
  CHECK(same);
  Engine c;
  c.generate(5000, 43);
  bool differs = false;
  for (std::uint32_t i = 0; i < 100; ++i) differs |= a.record(i).monthlyCents != c.record(i).monthlyCents;
  CHECK(differs);
}

static void testRecordsPlausible() {
  Engine e;
  e.generate(20000, 7);
  for (std::uint32_t i = 0; i < e.size(); ++i) {
    Record r = e.record(i);
    CHECK(r.id == i + 1);
    CHECK(r.state < kNumStates);
    CHECK(r.birthYear >= 1925 && r.birthYear <= 2025);
    CHECK(r.entitlementYear >= r.birthYear && r.entitlementYear <= 2026);
    CHECK(r.monthlyCents >= 10000 && r.monthlyCents <= 420000);
    CHECK(r.last4 <= 9999);
    if (g_fail > 20) return;
  }
}

static void testFilterCounts() {
  Engine e;
  e.generate(30000, 99);

  Filter f1;
  f1.stateMask = (1ULL << stateIndex("MD")) | (1ULL << stateIndex("VA"));
  CHECK(e.query({f1}).total == bruteCount(e, f1));

  Filter f2;
  f2.typeMask = 1u << typeIndex("Disability");
  f2.statusMask = (1u << statusIndex("Active")) | (1u << statusIndex("Pending"));
  f2.minCents = 120000;
  f2.maxCents = 200000;
  CHECK(e.query({f2}).total == bruteCount(e, f2));

  Filter f3;
  f3.minBirthYear = 1945;
  f3.maxBirthYear = 1955;
  f3.minEntYear = 2010;
  CHECK(e.query({f3}).total == bruteCount(e, f3));

  Filter f4;
  f4.text = "smith";
  CHECK(e.query({f4}).total == bruteCount(e, f4));
  CHECK(e.query({f4}).total > 0);

  Filter f5;
  f5.text = "mar smi";  // two tokens, each may hit first or last name
  CHECK(e.query({f5}).total == bruteCount(e, f5));

  Filter f6;
  f6.text = "JOHN";  // case-insensitive
  Filter f6b;
  f6b.text = "john";
  CHECK(e.query({f6}).total == e.query({f6b}).total);

  Filter f7;
  f7.last4 = 1234;
  CHECK(e.query({f7}).total == bruteCount(e, f7));

  Filter none;
  CHECK(e.query({none}).total == e.size());

  Filter impossible;
  impossible.minCents = 500;
  impossible.maxCents = 100;
  CHECK(e.query({impossible}).total == 0);

  Filter byId;
  byId.id = 77;
  QueryResult r = e.query({byId});
  CHECK(r.total == 1 && r.rows.size() == 1 && r.rows[0] == 76);
  byId.id = 999999;
  CHECK(e.query({byId}).total == 0);
}

static void testSortAndPaging() {
  Engine e;
  e.generate(20000, 5);

  Query q;
  q.filter.text = "an";
  q.sort = SortKey::Benefit;
  q.desc = true;
  q.limit = 100;
  QueryResult r = e.query(q);
  CHECK(r.rows.size() == 100);
  bool ordered = true;
  for (std::size_t i = 1; i < r.rows.size(); ++i)
    ordered &= e.record(r.rows[i - 1]).monthlyCents >= e.record(r.rows[i]).monthlyCents;
  CHECK(ordered);

  // The page must equal the matching slice of a full sort.
  Query full = q;
  full.limit = 1000;
  full.offset = 0;
  QueryResult big = e.query(full);
  Query page = q;
  page.offset = 40;
  page.limit = 30;
  QueryResult pr = e.query(page);
  CHECK(pr.rows.size() == 30);
  CHECK(std::equal(pr.rows.begin(), pr.rows.end(), big.rows.begin() + 40));

  // Large windows take the nth_element path (window > 8192): must equal a full sort's slice.
  Query lw;
  lw.sort = SortKey::Benefit;
  lw.desc = true;
  lw.offset = 8000;
  lw.limit = 1500;
  QueryResult lwr = e.query(lw);
  Query all = lw;
  all.offset = 0;
  all.limit = static_cast<std::uint32_t>(e.size());  // window covers everything -> std::sort path
  QueryResult allr = e.query(all);
  CHECK(lwr.rows.size() == 1500);
  CHECK(std::equal(lwr.rows.begin(), lwr.rows.end(), allr.rows.begin() + 8000));

  // Name sort: ascending last name then first name.
  Query n;
  n.sort = SortKey::LastName;
  n.limit = 500;
  QueryResult nr = e.query(n);
  bool nameOrdered = true;
  for (std::size_t i = 1; i < nr.rows.size(); ++i) {
    Record a = e.record(nr.rows[i - 1]), b = e.record(nr.rows[i]);
    nameOrdered &= std::tie(a.lastName, a.firstName) <= std::tie(b.lastName, b.firstName);
  }
  CHECK(nameOrdered);

  // Id sort, descending.
  Query d;
  d.sort = SortKey::Id;
  d.desc = true;
  d.limit = 3;
  QueryResult dr = e.query(d);
  CHECK(dr.rows.size() == 3 && dr.rows[0] == e.size() - 1 && dr.rows[2] == e.size() - 3);

  // Offset past the end yields an empty page but a correct total.
  Query past;
  past.offset = 1'000'000;
  QueryResult pr2 = e.query(past);
  CHECK(pr2.rows.empty() && pr2.total == e.size());
}

static void testStats() {
  Engine e;
  e.generate(25000, 11);
  Filter f;
  f.typeMask = 1u << typeIndex("Retirement");
  Stats s = e.stats(f);
  CHECK(s.count == bruteCount(e, f));
  std::uint64_t st = 0, ty = 0, su = 0, hi = 0, sum = 0;
  for (auto v : s.byState) st += v;
  for (auto v : s.byType) ty += v;
  for (auto v : s.byStatus) su += v;
  for (auto v : s.benefitHist) hi += v;
  CHECK(st == s.count && ty == s.count && su == s.count && hi == s.count);
  CHECK(s.byType[typeIndex("Retirement")] == s.count);
  for (std::uint32_t i = 0; i < e.size(); ++i) {
    Record r = e.record(i);
    if (bruteMatch(r, f)) sum += r.monthlyCents;
  }
  CHECK(s.sumCents == sum);
  CHECK(s.minCents <= s.maxCents);

  Filter none;
  none.minCents = 9;
  none.maxCents = 1;
  Stats z = e.stats(none);
  CHECK(z.count == 0 && z.minCents == 0 && z.maxCents == 0);
}

static void testApiJson() {
  Engine e;
  e.generate(10000, 3);

  std::string m = api::meta(e);
  CHECK(m.find("\"count\":10000") != std::string::npos);
  CHECK(m.find("\"code\":\"MD\"") != std::string::npos);

  std::string r = api::query(
      e, R"({"text":"smith","states":["MD","VA"],"types":["Retirement"],"minBenefit":1500.5,
            "sort":"benefit","desc":true,"offset":0,"limit":5})");
  CHECK(r.find("\"error\"") == std::string::npos);
  CHECK(r.find("\"records\":[") != std::string::npos);

  // Same filter through the typed API must give the same total.
  Query q;
  q.filter.text = "smith";
  q.filter.stateMask = (1ULL << stateIndex("MD")) | (1ULL << stateIndex("VA"));
  q.filter.typeMask = 1u << typeIndex("Retirement");
  q.filter.minCents = 150050;
  CHECK(r.find("\"total\":" + std::to_string(e.query(q).total) + ",") != std::string::npos);

  CHECK(api::query(e, "{bad json").find("\"error\"") != std::string::npos);
  CHECK(api::query(e, R"({"states":["ZZ"]})").find("unknown value") != std::string::npos);
  CHECK(api::query(e, R"({"sort":"nope"})").find("unknown sort key") != std::string::npos);
  CHECK(api::query(e, R"({"limit":"abc"})").find("must be a number") != std::string::npos);
  CHECK(api::query(e, "[1,2]").find("JSON object") != std::string::npos);
  CHECK(api::query(e, R"({"limit":100000})").find("\"limit\":1000") != std::string::npos);  // capped

  CHECK(api::query(e, R"({"states":[]})").find("\"total\":10000") != std::string::npos);  // empty = all
  CHECK(api::get(e, 1).find("\"id\":1,") != std::string::npos);
  CHECK(api::get(e, 0).find("\"error\"") != std::string::npos);
  CHECK(api::get(e, 10001).find("\"error\"") != std::string::npos);
  CHECK(api::stats(e, R"({"types":["SSI"]})").find("\"byType\":[0,0,0,") != std::string::npos);

  // Escaping / unicode in the text filter must not break parsing.
  CHECK(api::query(e, R"({"text":"smith \"x\""})").find("\"error\"") == std::string::npos);
}

// The builder (used to load from PostgreSQL) must reproduce generate() exactly, row for row and
// query for query, even when rows arrive with names in a different first-seen order.
static void testBuilderRoundTrip() {
  Engine gen;
  gen.generate(20000, 77);
  EngineBuilder b;
  b.reserve(gen.size());
  std::string err;
  bool ok = true;
  std::vector<Record> keep;  // InputRow holds string_views; keep the strings alive
  keep.reserve(gen.size());
  for (std::uint32_t i = 0; i < gen.size(); ++i) keep.push_back(gen.record(i));
  for (const Record& r : keep) {
    InputRow in;
    in.id = r.id;
    in.firstName = r.firstName;
    in.lastName = r.lastName;
    in.last4 = r.last4;
    in.birthYear = r.birthYear;
    in.zip3 = r.zip3;
    in.state = r.state;
    in.type = static_cast<std::uint8_t>(r.type);
    in.status = static_cast<std::uint8_t>(r.status);
    in.monthlyCents = r.monthlyCents;
    in.entitlementYear = r.entitlementYear;
    ok &= b.add(in, err);
  }
  CHECK(ok);
  Engine loaded;
  CHECK(b.build(loaded, err));
  CHECK(loaded.size() == gen.size());
  bool same = true;
  for (std::uint32_t i = 0; i < gen.size(); ++i) {
    Record x = gen.record(i), y = loaded.record(i);
    same &= x.firstName == y.firstName && x.lastName == y.lastName && x.monthlyCents == y.monthlyCents &&
            x.birthYear == y.birthYear && x.state == y.state && x.last4 == y.last4 && x.type == y.type &&
            x.status == y.status && x.zip3 == y.zip3 && x.entitlementYear == y.entitlementYear;
  }
  CHECK(same);
  for (const char* req : {R"({"text":"smi","sort":"lastName","limit":200})",
                          R"({"states":["MD","VA"],"sort":"firstName","desc":true,"offset":30,"limit":100})",
                          R"({"types":["SSI"],"sort":"benefit","limit":50})"}) {
    CHECK(api::query(gen, req).substr(0, 40) == api::query(loaded, req).substr(0, 40));  // totals
    std::string a = api::query(gen, req), c = api::query(loaded, req);
    auto strip = [](std::string s) {  // elapsedMs differs; compare everything else
      auto p = s.find("\"elapsedMs\":");
      auto q = s.find(',', p);
      return s.erase(p, q - p);
    };
    CHECK(strip(a) == strip(c));
  }
  CHECK(api::stats(gen, "{}").substr(0, 60) == api::stats(loaded, "{}").substr(0, 60));

  // Validation: out-of-order ids and bad codes are rejected with a message, never truncated silently.
  EngineBuilder bad;
  InputRow r;
  r.id = 2;
  r.firstName = "A";
  r.lastName = "B";
  CHECK(!bad.add(r, err) && err.find("dense") != std::string::npos);
  r.id = 1;
  r.state = 60;
  CHECK(!bad.add(r, err) && err.find("state") != std::string::npos);
  Engine untouched;
  untouched.generate(10, 1);
  CHECK(!bad.build(untouched, err) && untouched.size() == 10);  // failed build leaves target intact
}

int main() {
  testBuilderRoundTrip();
  testDeterminism();
  testRecordsPlausible();
  testFilterCounts();
  testSortAndPaging();
  testStats();
  testApiJson();
  std::printf("%d checks, %d failures\n", g_checks, g_fail);
  return g_fail ? 1 : 0;
}
