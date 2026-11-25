#pragma once
// SSA Recipient Explorer - core engine.
// Columnar, dictionary-compressed in-memory store for millions of (synthetic)
// benefit-recipient records, with filter / text search / sort / paginate /
// aggregate. No external dependencies; compiles natively and to WebAssembly.
//
// DATA NOTE: all data is synthetic. Records carry only a masked "last four"
// and a synthetic id - never a real SSN or real person.

#include <array>
#include <cstdint>
#include <functional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace ssa {

inline constexpr std::size_t kNumStates = 52;  // 50 states + DC + PR
inline constexpr std::size_t kNumTypes = 6;
inline constexpr std::size_t kNumStatuses = 4;
inline constexpr std::size_t kHistBuckets = 12;  // $500 buckets, last is open-ended
inline constexpr std::uint32_t kHistBucketCents = 50'000;

enum class BenefitType : std::uint8_t { Retirement, Disability, Survivor, SSI, Spouse, Child };
enum class Status : std::uint8_t { Active, Pending, Suspended, Terminated };

std::string_view stateCode(std::size_t i);
std::string_view stateName(std::size_t i);
std::string_view typeName(std::size_t i);
std::string_view statusName(std::size_t i);
int stateIndex(std::string_view code);    // -1 if unknown
int typeIndex(std::string_view name);     // -1 if unknown
int statusIndex(std::string_view name);   // -1 if unknown

struct Record {
  std::uint32_t id = 0;  // 1-based synthetic id
  std::string firstName;
  std::string lastName;
  std::uint16_t last4 = 0;
  std::uint16_t birthYear = 0;
  std::uint16_t zip3 = 0;
  std::uint8_t state = 0;
  BenefitType type = BenefitType::Retirement;
  Status status = Status::Active;
  std::uint32_t monthlyCents = 0;
  std::uint16_t entitlementYear = 0;
};

struct Filter {
  std::string text;  // whitespace-separated tokens, each must be a substring of first OR last name
  std::uint64_t stateMask = ~0ULL;
  std::uint8_t typeMask = 0xFF;
  std::uint8_t statusMask = 0xFF;
  std::uint32_t minCents = 0;
  std::uint32_t maxCents = UINT32_MAX;
  std::uint16_t minBirthYear = 0;
  std::uint16_t maxBirthYear = UINT16_MAX;
  std::uint16_t minEntYear = 0;
  std::uint16_t maxEntYear = UINT16_MAX;
  std::int32_t last4 = -1;  // -1 = any
  std::int64_t id = -1;     // -1 = any (exact lookup, 1-based)
};

enum class SortKey : std::uint8_t { Id, LastName, FirstName, Benefit, BirthYear, EntitlementYear, State };

struct Query {
  Filter filter;
  SortKey sort = SortKey::Id;
  bool desc = false;
  std::uint32_t offset = 0;
  std::uint32_t limit = 50;
};

struct QueryResult {
  std::uint64_t total = 0;
  std::vector<std::uint32_t> rows;  // row indices of the requested page
  double elapsedMs = 0;
};

struct Stats {
  std::uint64_t count = 0;
  std::uint64_t sumCents = 0;
  std::uint32_t minCents = 0;
  std::uint32_t maxCents = 0;
  std::array<std::uint64_t, kNumStates> byState{};
  std::array<std::uint64_t, kNumTypes> byType{};
  std::array<std::uint64_t, kNumStatuses> byStatus{};
  std::array<std::uint64_t, kHistBuckets> benefitHist{};
  double elapsedMs = 0;
};

// One row from an external source (e.g. a PostgreSQL COPY stream), using the same coded values as
// the engine: state is the index into the state table, type/status the enum values.
struct InputRow {
  std::uint32_t id = 0;  // must arrive densely in order: 1, 2, 3, ...
  std::string_view firstName;
  std::string_view lastName;
  std::uint16_t last4 = 0;
  std::uint16_t birthYear = 0;
  std::uint16_t zip3 = 0;
  std::uint8_t state = 0;
  std::uint8_t type = 0;
  std::uint8_t status = 0;
  std::uint32_t monthlyCents = 0;
  std::uint16_t entitlementYear = 0;
};

class Engine;

// Builds an Engine from external rows. Names are interned while streaming and the dictionaries are
// sorted at build(), so the result is indistinguishable from an engine built by generate().
// Limits (validated, never silently truncated): <= 65,535 distinct first and last names; ids dense 1..N.
class EngineBuilder {
 public:
  void reserve(std::size_t n);
  bool add(const InputRow& r, std::string& err);
  bool build(Engine& out, std::string& err);  // on success replaces `out`'s dataset; builder is left empty
  std::size_t size() const { return state_.size(); }

 private:
  // Transparent hashing: look names up by string_view without allocating a std::string per row.
  struct SvHash {
    using is_transparent = void;
    std::size_t operator()(std::string_view s) const noexcept { return std::hash<std::string_view>{}(s); }
  };
  using Index = std::unordered_map<std::string, std::uint32_t, SvHash, std::equal_to<>>;
  static std::uint32_t intern(std::string_view s, std::vector<std::string>& dict, Index& index);
  std::vector<std::string> firstDict_, lastDict_;  // insertion order
  Index firstIdx_, lastIdx_;
  std::vector<std::uint32_t> first_, last_;  // insertion-order ids; remapped to sorted ranks in build()
  std::vector<std::uint16_t> last4_, birth_, ent_, zip3_;
  std::vector<std::uint32_t> cents_;
  std::vector<std::uint8_t> state_, type_, status_;
};

class Engine {
 public:
  friend class EngineBuilder;

  // Replace the dataset with `n` deterministic synthetic records.
  void generate(std::uint32_t n, std::uint64_t seed);

  std::size_t size() const { return count_; }
  std::size_t memoryBytes() const;

  Record record(std::uint32_t row) const;  // row must be < size()

  QueryResult query(const Query& q) const;
  Stats stats(const Filter& f) const;

  // Dump raw little-endian columns (*.u16/*.u32/*.u8) plus first_dict.txt / last_dict.txt into an
  // existing directory. Used by external tooling (e.g. the NumPy oracle) to cross-check results.
  bool exportColumns(const std::string& dir) const;

 private:
  struct Compiled;  // filter compiled against dictionaries
  Compiled compile(const Filter& f) const;
  bool matches(const Compiled& c, std::size_t row) const;

  std::size_t count_ = 0;
  // Dictionaries are stored sorted, so a dictionary index is also its alphabetical rank.
  std::vector<std::string> firstDict_, lastDict_;
  std::vector<std::uint16_t> first_, last_, last4_, birth_, ent_, zip3_;
  std::vector<std::uint32_t> cents_;
  std::vector<std::uint8_t> state_, type_, status_;
};

}  // namespace ssa
