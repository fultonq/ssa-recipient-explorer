#include "ssa/engine.hpp"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cmath>
#include <fstream>
#include <numeric>

namespace ssa {
namespace {

using Clock = std::chrono::steady_clock;
double msSince(Clock::time_point t0) {
  return std::chrono::duration<double, std::milli>(Clock::now() - t0).count();
}

struct StateInfo {
  const char* code;
  const char* name;
  double popM;  // approximate population (millions) - used to weight synthetic data
};

// Alphabetical by name, so the index is also the sort rank.
constexpr StateInfo kStates[kNumStates] = {
    {"AL", "Alabama", 5.1},          {"AK", "Alaska", 0.74},        {"AZ", "Arizona", 7.4},
    {"AR", "Arkansas", 3.1},         {"CA", "California", 39.0},    {"CO", "Colorado", 5.9},
    {"CT", "Connecticut", 3.6},      {"DE", "Delaware", 1.04},      {"DC", "District of Columbia", 0.69},
    {"FL", "Florida", 23.0},         {"GA", "Georgia", 11.0},       {"HI", "Hawaii", 1.4},
    {"ID", "Idaho", 2.0},            {"IL", "Illinois", 12.5},      {"IN", "Indiana", 6.9},
    {"IA", "Iowa", 3.2},             {"KS", "Kansas", 2.9},         {"KY", "Kentucky", 4.5},
    {"LA", "Louisiana", 4.6},        {"ME", "Maine", 1.4},          {"MD", "Maryland", 6.2},
    {"MA", "Massachusetts", 7.0},    {"MI", "Michigan", 10.0},      {"MN", "Minnesota", 5.7},
    {"MS", "Mississippi", 2.9},      {"MO", "Missouri", 6.2},       {"MT", "Montana", 1.1},
    {"NE", "Nebraska", 2.0},         {"NV", "Nevada", 3.2},         {"NH", "New Hampshire", 1.4},
    {"NJ", "New Jersey", 9.3},       {"NM", "New Mexico", 2.1},     {"NY", "New York", 19.6},
    {"NC", "North Carolina", 11.0},  {"ND", "North Dakota", 0.78},  {"OH", "Ohio", 11.8},
    {"OK", "Oklahoma", 4.0},         {"OR", "Oregon", 4.2},         {"PA", "Pennsylvania", 13.0},
    {"PR", "Puerto Rico", 3.2},      {"RI", "Rhode Island", 1.1},   {"SC", "South Carolina", 5.4},
    {"SD", "South Dakota", 0.9},     {"TN", "Tennessee", 7.1},      {"TX", "Texas", 30.5},
    {"UT", "Utah", 3.4},             {"VT", "Vermont", 0.65},       {"VA", "Virginia", 8.7},
    {"WA", "Washington", 7.8},       {"WV", "West Virginia", 1.8},  {"WI", "Wisconsin", 5.9},
    {"WY", "Wyoming", 0.58},
};

constexpr const char* kTypeNames[kNumTypes] = {"Retirement", "Disability", "Survivor",
                                               "SSI",        "Spouse",     "Child"};
constexpr const char* kStatusNames[kNumStatuses] = {"Active", "Pending", "Suspended", "Terminated"};

// ---- deterministic RNG (splitmix64) ---------------------------------------
struct Rng {
  std::uint64_t s;
  explicit Rng(std::uint64_t seed) : s(seed) {}
  std::uint64_t next() {
    std::uint64_t z = (s += 0x9E3779B97F4A7C15ULL);
    z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ULL;
    z = (z ^ (z >> 27)) * 0x94D049BB133111EBULL;
    return z ^ (z >> 31);
  }
  std::uint32_t below(std::uint32_t n) { return static_cast<std::uint32_t>((next() >> 11) % n); }
  double real() { return static_cast<double>(next() >> 11) * (1.0 / 9007199254740992.0); }
  int range(int lo, int hi) { return lo + static_cast<int>(below(static_cast<std::uint32_t>(hi - lo + 1))); }
  double normal(double mean, double sd) {
    double u1 = std::max(real(), 1e-12), u2 = real();
    return mean + sd * std::sqrt(-2.0 * std::log(u1)) * std::cos(6.283185307179586 * u2);
  }
  // Skewed index in [0,n): low indices more likely (rough name-frequency curve).
  std::uint32_t skewed(std::uint32_t n) {
    double u = real();
    return std::min<std::uint32_t>(n - 1, static_cast<std::uint32_t>(n * u * u));
  }
};

const std::vector<std::string>& baseFirstNames() {
  static const std::vector<std::string> v = {
      "James",   "Mary",    "Robert",  "Patricia", "John",    "Jennifer", "Michael", "Linda",
      "David",   "Elizabeth", "William", "Barbara", "Richard", "Susan",    "Joseph",  "Jessica",
      "Thomas",  "Sarah",   "Charles", "Karen",    "Christopher", "Lisa", "Daniel",  "Nancy",
      "Matthew", "Betty",   "Anthony", "Margaret", "Mark",    "Sandra",   "Donald",  "Ashley",
      "Steven",  "Kimberly", "Paul",   "Emily",    "Andrew",  "Donna",    "Joshua",  "Michelle",
      "Kenneth", "Carol",   "Kevin",   "Amanda",   "Brian",   "Dorothy",  "George",  "Melissa",
      "Timothy", "Deborah", "Ronald",  "Stephanie", "Edward", "Rebecca",  "Jason",   "Sharon",
      "Jeffrey", "Laura",   "Ryan",    "Cynthia",  "Jacob",   "Kathleen", "Gary",    "Amy",
      "Nicholas", "Angela", "Eric",    "Shirley",  "Jonathan", "Anna",   "Stephen", "Brenda",
      "Larry",   "Pamela",  "Justin",  "Emma",     "Scott",   "Nicole",   "Brandon", "Helen",
      "Benjamin", "Samantha", "Samuel", "Katherine", "Gregory", "Christine", "Alexander", "Debra",
      "Frank",   "Rachel",  "Patrick", "Carolyn",  "Raymond", "Janet",    "Jack",    "Catherine",
      "Dennis",  "Maria",   "Jerry",   "Heather",  "Tyler",   "Diane",    "Aaron",   "Olivia",
      "Henry",   "Julie",   "Douglas", "Joyce",    "Peter",   "Victoria", "Walter",  "Ruth",
      "Harold",  "Virginia", "Carl",   "Frances",  "Arthur",  "Evelyn",   "Roger",   "Gloria",
      "Albert",  "Teresa",  "Willie",  "Doris",    "Wayne",   "Marie",    "Ralph",   "Jean",
  };
  return v;
}

const std::vector<std::string>& baseLastNames() {
  static const std::vector<std::string> v = [] {
    std::vector<std::string> out = {
        "Smith",    "Johnson", "Williams", "Brown",   "Jones",    "Garcia",  "Miller",  "Davis",
        "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas",
        "Taylor",   "Moore",   "Jackson",  "Martin",  "Lee",      "Perez",   "Thompson", "White",
        "Harris",   "Sanchez", "Clark",    "Ramirez", "Lewis",    "Robinson", "Walker",  "Young",
        "Allen",    "King",    "Wright",   "Scott",   "Torres",   "Nguyen",  "Hill",    "Flores",
        "Green",    "Adams",   "Nelson",   "Baker",   "Hall",     "Rivera",  "Campbell", "Mitchell",
        "Carter",   "Roberts", "Gomez",    "Phillips", "Evans",   "Turner",  "Diaz",    "Parker",
        "Cruz",     "Edwards", "Collins",  "Reyes",   "Stewart",  "Morris",  "Morales", "Murphy",
        "Cook",     "Rogers",  "Gutierrez", "Ortiz",  "Morgan",   "Cooper",  "Peterson", "Bailey",
        "Reed",     "Kelly",   "Howard",   "Ramos",   "Kim",      "Cox",     "Ward",    "Richardson",
    };
    const char* pre[] = {"Ash",  "Black", "Bright", "Clay",  "Cliff", "Dun",   "East",  "Fair",
                         "Glen", "Green", "Hart",   "High",  "Kings", "Lake",  "Long",  "Marsh",
                         "Mill", "North", "Oak",    "Pine",  "Red",   "River", "Rose",  "Stone",
                         "Sum",  "Thorn", "Wade",   "West",  "Win",   "Wood"};
    const char* suf[] = {"field", "ford",  "ton",  "wood", "worth", "man",  "son",  "ley",
                         "well",  "by",    "berg", "stead", "hurst", "more", "wick", "ridge"};
    for (const char* p : pre)
      for (const char* s : suf) out.push_back(std::string(p) + s);
    return out;
  }();
  return v;
}

// Build a sorted unique dictionary from `base`; map[i] gives the sorted index of base[i].
void buildDict(const std::vector<std::string>& base, std::vector<std::string>& dict,
               std::vector<std::uint16_t>& map) {
  dict = base;
  std::sort(dict.begin(), dict.end());
  dict.erase(std::unique(dict.begin(), dict.end()), dict.end());
  map.resize(base.size());
  for (std::size_t i = 0; i < base.size(); ++i)
    map[i] = static_cast<std::uint16_t>(std::lower_bound(dict.begin(), dict.end(), base[i]) - dict.begin());
}

std::string lower(std::string_view s) {
  std::string o(s);
  for (char& c : o) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return o;
}

}  // namespace

// ---- lookup tables ---------------------------------------------------------
std::string_view stateCode(std::size_t i) { return kStates[i].code; }
std::string_view stateName(std::size_t i) { return kStates[i].name; }
std::string_view typeName(std::size_t i) { return kTypeNames[i]; }
std::string_view statusName(std::size_t i) { return kStatusNames[i]; }

int stateIndex(std::string_view code) {
  for (std::size_t i = 0; i < kNumStates; ++i)
    if (code == kStates[i].code) return static_cast<int>(i);
  return -1;
}
int typeIndex(std::string_view name) {
  for (std::size_t i = 0; i < kNumTypes; ++i)
    if (name == kTypeNames[i]) return static_cast<int>(i);
  return -1;
}
int statusIndex(std::string_view name) {
  for (std::size_t i = 0; i < kNumStatuses; ++i)
    if (name == kStatusNames[i]) return static_cast<int>(i);
  return -1;
}

// ---- generation ------------------------------------------------------------
void Engine::generate(std::uint32_t n, std::uint64_t seed) {
  std::vector<std::uint16_t> fmap, lmap;
  buildDict(baseFirstNames(), firstDict_, fmap);
  buildDict(baseLastNames(), lastDict_, lmap);

  count_ = n;
  first_.assign(n, 0);
  last_.assign(n, 0);
  last4_.assign(n, 0);
  birth_.assign(n, 0);
  ent_.assign(n, 0);
  zip3_.assign(n, 0);
  cents_.assign(n, 0);
  state_.assign(n, 0);
  type_.assign(n, 0);
  status_.assign(n, 0);

  std::array<double, kNumStates> cum{};
  double total = 0;
  for (std::size_t i = 0; i < kNumStates; ++i) cum[i] = (total += kStates[i].popM);

  const auto nFirst = static_cast<std::uint32_t>(baseFirstNames().size());
  const auto nLast = static_cast<std::uint32_t>(baseLastNames().size());
  Rng rng(seed ? seed : 1);

  for (std::uint32_t i = 0; i < n; ++i) {
    first_[i] = fmap[rng.skewed(nFirst)];
    last_[i] = lmap[rng.skewed(nLast)];
    last4_[i] = static_cast<std::uint16_t>(rng.below(10000));
    zip3_[i] = static_cast<std::uint16_t>(rng.range(10, 998));

    double sp = rng.real() * total;
    state_[i] = static_cast<std::uint8_t>(std::lower_bound(cum.begin(), cum.end(), sp) - cum.begin());
    if (state_[i] >= kNumStates) state_[i] = kNumStates - 1;

    double t = rng.real();
    BenefitType type = t < 0.54   ? BenefitType::Retirement
                       : t < 0.67 ? BenefitType::Disability
                       : t < 0.76 ? BenefitType::Survivor
                       : t < 0.88 ? BenefitType::SSI
                       : t < 0.93 ? BenefitType::Spouse
                                  : BenefitType::Child;
    type_[i] = static_cast<std::uint8_t>(type);

    int birth = 1950, ent = 2010;
    double cents = 150000;
    switch (type) {
      case BenefitType::Retirement:
        birth = static_cast<int>(std::clamp(rng.normal(1953, 8), 1928.0, 1964.0));
        ent = std::min(2026, birth + rng.range(62, 70));
        cents = std::clamp(rng.normal(1900, 650), 300.0, 4200.0) * 100;
        break;
      case BenefitType::Disability:
        birth = rng.range(1958, 2004);
        ent = std::min(2026, std::max(birth + 20, rng.range(2000, 2026)));
        cents = std::clamp(rng.normal(1500, 450), 300.0, 3800.0) * 100;
        break;
      case BenefitType::Survivor:
        birth = rng.range(1930, 2010);
        ent = std::min(2026, std::max(birth, rng.range(1995, 2026)));
        cents = std::clamp(rng.normal(1600, 550), 300.0, 3600.0) * 100;
        break;
      case BenefitType::SSI:
        birth = rng.range(1925, 2008);
        ent = std::min(2026, std::max(birth, rng.range(1974, 2026)));
        cents = (100 + rng.real() * 894) * 100;  // capped near the federal benefit rate
        break;
      case BenefitType::Spouse:
        birth = rng.range(1930, 1966);
        ent = std::min(2026, birth + rng.range(62, 68));
        cents = std::clamp(rng.normal(950, 350), 150.0, 2100.0) * 100;
        break;
      case BenefitType::Child:
        birth = rng.range(2007, 2025);
        ent = std::min(2026, std::max(birth, rng.range(2007, 2026)));
        cents = std::clamp(rng.normal(750, 300), 150.0, 1800.0) * 100;
        break;
    }
    birth_[i] = static_cast<std::uint16_t>(birth);
    ent_[i] = static_cast<std::uint16_t>(ent);
    cents_[i] = static_cast<std::uint32_t>(cents);

    double s = rng.real();
    status_[i] = static_cast<std::uint8_t>(s < 0.92   ? Status::Active
                                           : s < 0.95 ? Status::Pending
                                           : s < 0.97 ? Status::Suspended
                                                      : Status::Terminated);
  }
}

// ---- external load ---------------------------------------------------------
void EngineBuilder::reserve(std::size_t n) {
  for (auto* v : {&first_, &last_, &cents_}) v->reserve(n);
  for (auto* v : {&last4_, &birth_, &ent_, &zip3_}) v->reserve(n);
  for (auto* v : {&state_, &type_, &status_}) v->reserve(n);
}

std::uint32_t EngineBuilder::intern(std::string_view s, std::vector<std::string>& dict, Index& index) {
  if (auto it = index.find(s); it != index.end()) return it->second;
  const auto id = static_cast<std::uint32_t>(dict.size());
  index.emplace(std::string(s), id);
  dict.emplace_back(s);
  return id;
}

bool EngineBuilder::add(const InputRow& r, std::string& err) {
  const std::size_t n = state_.size();
  auto fail = [&](const std::string& m) {
    err = "row id " + std::to_string(r.id) + ": " + m;
    return false;
  };
  if (r.id != n + 1) return fail("ids must be dense and ordered (expected " + std::to_string(n + 1) + ")");
  if (n >= UINT32_MAX - 1) return fail("too many rows");
  if (r.firstName.empty() || r.lastName.empty()) return fail("empty name");
  if (r.state >= kNumStates) return fail("state index out of range");
  if (r.type >= kNumTypes) return fail("benefit type out of range");
  if (r.status >= kNumStatuses) return fail("status out of range");
  if (r.last4 > 9999) return fail("last4 out of range");
  if (r.zip3 > 999) return fail("zip3 out of range");

  first_.push_back(intern(r.firstName, firstDict_, firstIdx_));
  last_.push_back(intern(r.lastName, lastDict_, lastIdx_));
  if (firstDict_.size() > UINT16_MAX || lastDict_.size() > UINT16_MAX) {
    first_.pop_back();
    last_.pop_back();
    return fail("more than 65,535 distinct names; widen the name columns before loading this dataset");
  }
  last4_.push_back(r.last4);
  birth_.push_back(r.birthYear);
  ent_.push_back(r.entitlementYear);
  zip3_.push_back(r.zip3);
  cents_.push_back(r.monthlyCents);
  state_.push_back(r.state);
  type_.push_back(r.type);
  status_.push_back(r.status);
  return true;
}

bool EngineBuilder::build(Engine& out, std::string& err) {
  if (state_.empty()) {
    err = "no rows loaded";
    return false;
  }
  // Sort each dictionary and remap insertion-order ids to sorted ranks.
  auto finish = [](std::vector<std::string>& dict, const std::vector<std::uint32_t>& ids,
                   std::vector<std::string>& sortedOut, std::vector<std::uint16_t>& col) {
    std::vector<std::uint32_t> order(dict.size());
    for (std::uint32_t i = 0; i < order.size(); ++i) order[i] = i;
    std::sort(order.begin(), order.end(), [&](std::uint32_t a, std::uint32_t b) { return dict[a] < dict[b]; });
    std::vector<std::uint16_t> rank(dict.size());
    sortedOut.clear();
    sortedOut.reserve(dict.size());
    for (std::uint32_t r = 0; r < order.size(); ++r) {
      rank[order[r]] = static_cast<std::uint16_t>(r);
      sortedOut.push_back(std::move(dict[order[r]]));
    }
    col.resize(ids.size());
    for (std::size_t i = 0; i < ids.size(); ++i) col[i] = rank[ids[i]];
  };

  Engine e;
  finish(firstDict_, first_, e.firstDict_, e.first_);
  finish(lastDict_, last_, e.lastDict_, e.last_);
  e.count_ = state_.size();
  e.last4_ = std::move(last4_);
  e.birth_ = std::move(birth_);
  e.ent_ = std::move(ent_);
  e.zip3_ = std::move(zip3_);
  e.cents_ = std::move(cents_);
  e.state_ = std::move(state_);
  e.type_ = std::move(type_);
  e.status_ = std::move(status_);
  out = std::move(e);
  *this = EngineBuilder{};
  return true;
}

std::size_t Engine::memoryBytes() const {
  std::size_t b = 0;
  for (const auto* v : {&first_, &last_, &last4_, &birth_, &ent_, &zip3_}) b += v->capacity() * 2;
  b += cents_.capacity() * 4 + state_.capacity() + type_.capacity() + status_.capacity();
  return b;
}

bool Engine::exportColumns(const std::string& dir) const {
  auto raw = [&](const char* name, const void* data, std::size_t bytes) {
    std::ofstream f(dir + "/" + name, std::ios::binary);
    f.write(static_cast<const char*>(data), static_cast<std::streamsize>(bytes));
    return static_cast<bool>(f);
  };
  auto dict = [&](const char* name, const std::vector<std::string>& d) {
    std::ofstream f(dir + "/" + name);
    for (const auto& w : d) f << w << '\n';
    return static_cast<bool>(f);
  };
  return raw("first.u16", first_.data(), first_.size() * 2) && raw("last.u16", last_.data(), last_.size() * 2) &&
         raw("last4.u16", last4_.data(), last4_.size() * 2) && raw("birth.u16", birth_.data(), birth_.size() * 2) &&
         raw("ent.u16", ent_.data(), ent_.size() * 2) && raw("zip3.u16", zip3_.data(), zip3_.size() * 2) &&
         raw("cents.u32", cents_.data(), cents_.size() * 4) && raw("state.u8", state_.data(), state_.size()) &&
         raw("type.u8", type_.data(), type_.size()) && raw("status.u8", status_.data(), status_.size()) &&
         dict("first_dict.txt", firstDict_) && dict("last_dict.txt", lastDict_);
}

Record Engine::record(std::uint32_t row) const {
  Record r;
  r.id = row + 1;
  r.firstName = firstDict_[first_[row]];
  r.lastName = lastDict_[last_[row]];
  r.last4 = last4_[row];
  r.birthYear = birth_[row];
  r.zip3 = zip3_[row];
  r.state = state_[row];
  r.type = static_cast<BenefitType>(type_[row]);
  r.status = static_cast<Status>(status_[row]);
  r.monthlyCents = cents_[row];
  r.entitlementYear = ent_[row];
  return r;
}

// ---- filter compilation ----------------------------------------------------
struct Engine::Compiled {
  bool impossible = false;
  bool hasId = false;
  std::uint32_t idRow = 0;
  std::uint64_t stateMask = 0;
  std::uint8_t typeMask = 0, statusMask = 0;
  std::uint32_t minC = 0, maxC = 0;
  std::uint16_t minB = 0, maxB = 0, minE = 0, maxE = 0;
  std::int32_t last4 = -1;
  std::uint8_t nameFull = 0;
  std::vector<std::uint8_t> fm, lm;  // per-dictionary-entry bitmask of matching tokens
};

Engine::Compiled Engine::compile(const Filter& f) const {
  Compiled c;
  constexpr std::uint64_t kAllStates = (1ULL << kNumStates) - 1;
  c.stateMask = f.stateMask & kAllStates;
  c.typeMask = f.typeMask & 0x3F;
  c.statusMask = f.statusMask & 0x0F;
  c.minC = f.minCents;
  c.maxC = f.maxCents;
  c.minB = f.minBirthYear;
  c.maxB = f.maxBirthYear;
  c.minE = f.minEntYear;
  c.maxE = f.maxEntYear;
  c.last4 = f.last4;

  if (!c.stateMask || !c.typeMask || !c.statusMask || c.minC > c.maxC || c.minB > c.maxB ||
      c.minE > c.maxE || f.last4 > 9999)
    c.impossible = true;

  if (f.id >= 0) {
    if (f.id == 0 || static_cast<std::uint64_t>(f.id) > count_) c.impossible = true;
    else { c.hasId = true; c.idRow = static_cast<std::uint32_t>(f.id - 1); }
  }

  // Text tokens: each must be a (case-insensitive) substring of first OR last name.
  std::vector<std::string> tokens;
  {
    std::string cur;
    for (char ch : f.text) {
      if (std::isspace(static_cast<unsigned char>(ch))) {
        if (!cur.empty()) { tokens.push_back(lower(cur)); cur.clear(); }
      } else cur.push_back(ch);
    }
    if (!cur.empty()) tokens.push_back(lower(cur));
    if (tokens.size() > 8) tokens.resize(8);
  }
  if (!tokens.empty()) {
    c.nameFull = static_cast<std::uint8_t>((1u << tokens.size()) - 1);
    c.fm.assign(firstDict_.size(), 0);
    c.lm.assign(lastDict_.size(), 0);
    for (std::size_t d = 0; d < firstDict_.size(); ++d) {
      std::string l = lower(firstDict_[d]);
      for (std::size_t t = 0; t < tokens.size(); ++t)
        if (l.find(tokens[t]) != std::string::npos) c.fm[d] |= static_cast<std::uint8_t>(1u << t);
    }
    for (std::size_t d = 0; d < lastDict_.size(); ++d) {
      std::string l = lower(lastDict_[d]);
      for (std::size_t t = 0; t < tokens.size(); ++t)
        if (l.find(tokens[t]) != std::string::npos) c.lm[d] |= static_cast<std::uint8_t>(1u << t);
    }
  }
  return c;
}

bool Engine::matches(const Compiled& c, std::size_t i) const {
  if (!((c.stateMask >> state_[i]) & 1) || !((c.typeMask >> type_[i]) & 1) ||
      !((c.statusMask >> status_[i]) & 1))
    return false;
  const std::uint32_t cents = cents_[i];
  if (cents < c.minC || cents > c.maxC) return false;
  const std::uint16_t b = birth_[i], e = ent_[i];
  if (b < c.minB || b > c.maxB || e < c.minE || e > c.maxE) return false;
  if (c.last4 >= 0 && last4_[i] != c.last4) return false;
  if (c.nameFull && static_cast<std::uint8_t>(c.fm[first_[i]] | c.lm[last_[i]]) != c.nameFull) return false;
  return true;
}

// ---- query -----------------------------------------------------------------
QueryResult Engine::query(const Query& q) const {
  const auto t0 = Clock::now();
  const Compiled c = compile(q.filter);
  QueryResult res;

  std::vector<std::uint32_t> m;
  if (!c.impossible) {
    if (c.hasId) {
      if (matches(c, c.idRow)) m.push_back(c.idRow);
    } else {
      m.reserve(count_);
      // Hoist column pointers/masks into locals so the hot loop keeps them in registers.
      const std::uint8_t *st = state_.data(), *ty = type_.data(), *su = status_.data();
      const std::uint32_t* ce = cents_.data();
      const std::uint16_t *fi = first_.data(), *la = last_.data();
      const std::uint8_t *fm = c.fm.data(), *lm = c.lm.data();
      const std::uint64_t sm = c.stateMask;
      const std::uint8_t tm = c.typeMask, um = c.statusMask, nf = c.nameFull;
      const std::uint32_t lo = c.minC, hi = c.maxC;
      const bool simple = c.minB == 0 && c.maxB == UINT16_MAX && c.minE == 0 && c.maxE == UINT16_MAX && c.last4 < 0;
      if (simple) {
        for (std::size_t i = 0; i < count_; ++i) {
          if (!((sm >> st[i]) & 1) || !((tm >> ty[i]) & 1) || !((um >> su[i]) & 1)) continue;
          const std::uint32_t cents = ce[i];
          if (cents < lo || cents > hi) continue;
          if (nf && static_cast<std::uint8_t>(fm[fi[i]] | lm[la[i]]) != nf) continue;
          m.push_back(static_cast<std::uint32_t>(i));
        }
      } else {
        for (std::size_t i = 0; i < count_; ++i)
          if (matches(c, i)) m.push_back(static_cast<std::uint32_t>(i));
      }
    }
  }
  res.total = m.size();

  const std::size_t offset = q.offset;
  const std::size_t want = std::min<std::size_t>(m.size(), offset + static_cast<std::size_t>(q.limit));
  if (offset >= want) { res.elapsedMs = msSince(t0); return res; }

  if (q.sort == SortKey::Id) {
    // m is already in ascending row order.
    if (!q.desc) res.rows.assign(m.begin() + offset, m.begin() + want);
    else {
      std::size_t total = m.size();
      for (std::size_t k = offset; k < want; ++k) res.rows.push_back(m[total - 1 - k]);
    }
    res.elapsedMs = msSince(t0);
    return res;
  }

  auto primary = [&](std::uint32_t a, std::uint32_t b) -> int {
    auto cmp = [](auto x, auto y) { return x < y ? -1 : (x > y ? 1 : 0); };
    switch (q.sort) {
      case SortKey::LastName: { int r = cmp(last_[a], last_[b]); return r ? r : cmp(first_[a], first_[b]); }
      case SortKey::FirstName: { int r = cmp(first_[a], first_[b]); return r ? r : cmp(last_[a], last_[b]); }
      case SortKey::Benefit: return cmp(cents_[a], cents_[b]);
      case SortKey::BirthYear: return cmp(birth_[a], birth_[b]);
      case SortKey::EntitlementYear: return cmp(ent_[a], ent_[b]);
      case SortKey::State: return cmp(state_[a], state_[b]);
      default: return 0;
    }
  };
  const bool desc = q.desc;
  auto less = [&](std::uint32_t a, std::uint32_t b) {
    int r = primary(a, b);
    if (r != 0) return desc ? r > 0 : r < 0;
    return desc ? a > b : a < b;  // deterministic tie-break on row
  };

  // `less` is a strict total order (row tie-break), so every path below yields the same
  // result as a full sort. Small windows: one heap pass (cache-friendly, mostly rejects).
  // Large windows: O(n) selection of the window, then sort just the window.
  constexpr std::size_t kHeapWindowMax = 8192;
  if (want >= m.size()) {
    std::sort(m.begin(), m.end(), less);
  } else if (want <= kHeapWindowMax) {
    std::partial_sort(m.begin(), m.begin() + want, m.end(), less);
  } else {
    std::nth_element(m.begin(), m.begin() + want, m.end(), less);
    std::sort(m.begin(), m.begin() + want, less);
  }

  res.rows.assign(m.begin() + offset, m.begin() + want);
  res.elapsedMs = msSince(t0);
  return res;
}

// ---- stats -----------------------------------------------------------------
Stats Engine::stats(const Filter& f) const {
  const auto t0 = Clock::now();
  const Compiled c = compile(f);
  Stats s;
  std::uint32_t mn = UINT32_MAX, mx = 0;

  auto add = [&](std::size_t i) {
    const std::uint32_t cents = cents_[i];
    ++s.count;
    s.sumCents += cents;
    mn = std::min(mn, cents);
    mx = std::max(mx, cents);
    ++s.byState[state_[i]];
    ++s.byType[type_[i]];
    ++s.byStatus[status_[i]];
    ++s.benefitHist[std::min<std::uint32_t>(cents / kHistBucketCents, kHistBuckets - 1)];
  };

  if (!c.impossible) {
    if (c.hasId) { if (matches(c, c.idRow)) add(c.idRow); }
    else for (std::size_t i = 0; i < count_; ++i) if (matches(c, i)) add(i);
  }
  s.minCents = s.count ? mn : 0;
  s.maxCents = mx;
  s.elapsedMs = msSince(t0);
  return s;
}

}  // namespace ssa
