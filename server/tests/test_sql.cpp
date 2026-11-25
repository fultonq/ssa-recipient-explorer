// Database-free unit tests for the SQL backend's translation layer and the COPY parser.
// (End-to-end equivalence against a live PostgreSQL is checked by tools/compare_backends.py.)
#include <cstdio>
#include <string>

#include "pg_loader.hpp"
#include "sql_backend.hpp"
#include "ssa/api.hpp"

static int g_fail = 0, g_checks = 0;
#define CHECK(cond)                                                                            \
  do {                                                                                         \
    ++g_checks;                                                                                \
    if (!(cond)) { ++g_fail; std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond); } \
  } while (0)

using namespace ssa;

static bool has(const std::string& s, const std::string& part) { return s.find(part) != std::string::npos; }

static void testDefaultFilterIsUnrestricted() {
  sql::Where w = sql::buildWhere(Filter{});
  CHECK(w.clause == "TRUE");
  CHECK(w.params.empty());
}

static void testParametersNeverInlined() {
  Filter f;
  std::string err;
  CHECK(api::parseFilter(R"({"text":"o'brien; DROP TABLE x --","states":["MD","VA"],"types":["SSI"],
       "statuses":["Active","Pending"],"minBenefit":12.34,"maxBenefit":99,"minBirthYear":1950,
       "maxEntYear":2020,"last4":42,"id":7})", f, err));
  sql::Where w = sql::buildWhere(f);
  CHECK(!has(w.clause, "brien"));   // user text only ever travels as a parameter
  CHECK(!has(w.clause, "DROP"));
  CHECK(has(w.clause, "state_id = ANY($1::smallint[])"));
  CHECK(w.params[0] == "{20,47}");  // MD=20, VA=47 in engine order
  CHECK(w.params[1] == "{3}");      // SSI
  CHECK(w.params[2] == "{0,1}");    // Active, Pending
  CHECK(w.params[3] == "1234");     // cents, rounded exactly like the engine
  CHECK(w.params[4] == "9900");
  CHECK(has(w.clause, "birth_year >= $6::int") && w.params[5] == "1950");
  CHECK(has(w.clause, "entitlement_year <= $7::int") && w.params[6] == "2020");
  CHECK(has(w.clause, "ssn_last4 = $8::int") && w.params[7] == "42");
  CHECK(has(w.clause, "id = $9::bigint") && w.params[8] == "7");
  CHECK(w.params.size() == 14);     // 9 filters + 5 text tokens
  CHECK(w.params[9] == "%o'brien;%");
  CHECK(w.params[10] == "%drop%");  // lower-cased like the engine
  CHECK(has(w.clause, "LIKE $14 ESCAPE"));
}

static void testLikeEscaping() {
  CHECK(sql::likePattern("Ab") == "%ab%");
  CHECK(sql::likePattern("50%") == "%50\\%%");
  CHECK(sql::likePattern("a_b") == "%a\\_b%");
  CHECK(sql::likePattern("x\\y") == "%x\\\\y%");
}

static void testTokenLimitMatchesEngine() {
  Filter f;
  f.text = "a b c d e f g h i j";  // engine keeps the first 8 tokens
  CHECK(sql::buildWhere(f).params.size() == 8);
  f.text = "   ";
  CHECK(sql::buildWhere(f).clause == "TRUE");
}

static void testOrderBy() {
  CHECK(sql::orderBy(SortKey::Id, false) == "id");
  CHECK(sql::orderBy(SortKey::Id, true) == "id DESC");
  CHECK(sql::orderBy(SortKey::LastName, false) == "last_name COLLATE \"C\", first_name COLLATE \"C\", id");
  CHECK(sql::orderBy(SortKey::Benefit, true) == "monthly_cents DESC, id DESC");
  CHECK(sql::orderBy(SortKey::State, false) == "state_id, id");
}

static void testCopyLineParsing() {
  InputRow r;
  std::string s1, s2, err;
  CHECK(pg::parseCopyLine("12\tMary\tSmith\t42\t1950\t212\t20\t0\t1\t185000\t2015\n", r, s1, s2, err));
  CHECK(r.id == 12 && r.firstName == "Mary" && r.lastName == "Smith" && r.last4 == 42 && r.birthYear == 1950);
  CHECK(r.zip3 == 212 && r.state == 20 && r.type == 0 && r.status == 1 && r.monthlyCents == 185000 &&
        r.entitlementYear == 2015);
  CHECK(pg::parseCopyLine("1\tA\\tB\tC\\\\D\t1\t1\t1\t1\t1\t1\t1\t1", r, s1, s2, err));
  CHECK(r.firstName == "A\tB" && r.lastName == "C\\D");
  CHECK(!pg::parseCopyLine("1\tA\tB\t1\t1\t1\t1\t1\t1\t1", r, s1, s2, err));               // 10 columns
  CHECK(!pg::parseCopyLine("1\tA\tB\t1\t1\t1\t1\t1\t1\tx\t1", r, s1, s2, err));            // not a number
  CHECK(!pg::parseCopyLine("1\t\\N\tB\t1\t1\t1\t1\t1\t1\t1\t1", r, s1, s2, err));          // NULL
  CHECK(!pg::parseCopyLine("1\tA\tB\t1\t1\t1\t999\t1\t1\t1\t1", r, s1, s2, err));          // state > 255
}

int main() {
  testDefaultFilterIsUnrestricted();
  testParametersNeverInlined();
  testLikeEscaping();
  testTokenLimitMatchesEngine();
  testOrderBy();
  testCopyLineParsing();
  std::printf("%d checks, %d failures\n", g_checks, g_fail);
  return g_fail ? 1 : 0;
}
