// Line-oriented driver around the JSON API, for cross-checking against other implementations.
//   ssa_cli <records> <seed> [export_dir]   then stdin lines:  query {json} | stats {json}
// Writes one JSON response per input line to stdout.
#include <cstdlib>
#include <iostream>
#include <string>

#include "ssa/api.hpp"
#include "ssa/engine.hpp"

int main(int argc, char** argv) {
  if (argc < 3) { std::cerr << "usage: ssa_cli <records> <seed> [export_dir]\n"; return 2; }
  ssa::Engine e;
  e.generate(static_cast<std::uint32_t>(std::atoll(argv[1])), static_cast<std::uint64_t>(std::atoll(argv[2])));
  if (argc > 3 && !e.exportColumns(argv[3])) { std::cerr << "export failed\n"; return 1; }
  std::string line;
  while (std::getline(std::cin, line)) {
    auto sp = line.find(' ');
    std::string op = line.substr(0, sp), body = sp == std::string::npos ? "" : line.substr(sp + 1);
    std::cout << (op == "stats" ? ssa::api::stats(e, body) : ssa::api::query(e, body)) << '\n';
  }
  return 0;
}
