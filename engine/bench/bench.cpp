// Benchmark: generation + representative queries at scale.
// Usage: ./ssa_bench [records=5000000]
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <string>

#include "ssa/api.hpp"
#include "ssa/engine.hpp"

using Clock = std::chrono::steady_clock;

int main(int argc, char** argv) {
  std::uint32_t n = argc > 1 ? static_cast<std::uint32_t>(std::atoll(argv[1])) : 5'000'000;
  ssa::Engine e;
  auto t0 = Clock::now();
  e.generate(n, 2026);
  double gen = std::chrono::duration<double, std::milli>(Clock::now() - t0).count();
  std::printf("generated %u records in %.0f ms, %.1f MB resident\n", n, gen, e.memoryBytes() / 1048576.0);

  struct Case { const char* name; const char* json; };
  const Case cases[] = {
      {"no filter, sort id", R"({"limit":50})"},
      {"no filter, sort benefit desc", R"({"sort":"benefit","desc":true,"limit":50})"},
      {"no filter, sort last name", R"({"sort":"lastName","limit":50})"},
      {"text 'smith'", R"({"text":"smith","limit":50})"},
      {"text 'mar smi' + MD/VA/DC", R"({"text":"mar smi","states":["MD","VA","DC"],"limit":50})"},
      {"Disability, Active, $1.2k-$2k, sort benefit", R"({"types":["Disability"],"statuses":["Active"],"minBenefit":1200,"maxBenefit":2000,"sort":"benefit","limit":50})"},
      {"deep page (offset 100000)", R"({"sort":"lastName","offset":100000,"limit":50})"},
      {"exact id", R"({"id":1234567})"},
      {"stats, no filter", nullptr},
      {"stats, Retirement in TX", nullptr},
  };
  for (const Case& c : cases) {
    // Best of 5 to damp scheduler noise.
    double best = 1e18;
    std::string out;
    for (int rep = 0; rep < 5; ++rep) {
      auto s = Clock::now();
      if (c.json) out = ssa::api::query(e, c.json);
      else if (std::string(c.name).find("TX") != std::string::npos) out = ssa::api::stats(e, R"({"types":["Retirement"],"states":["TX"]})");
      else out = ssa::api::stats(e, "{}");
      best = std::min(best, std::chrono::duration<double, std::milli>(Clock::now() - s).count());
    }
    // Report the match count so different implementations can be cross-checked.
    auto key = out.find("\"total\":") != std::string::npos ? std::string("\"total\":") : std::string("\"count\":");
    auto pos = out.find(key);
    unsigned long long matched = pos == std::string::npos ? 0 : std::strtoull(out.c_str() + pos + key.size(), nullptr, 10);
    std::printf("%-46s %8.1f ms   total=%llu\n", c.name, best, matched);
  }
  return 0;
}
