#pragma once
#include <libpq-fe.h>

#include <string>

#include "ssa/engine.hpp"

namespace ssa::pg {

struct LoadStats {
  std::size_t rows = 0;
  double seconds = 0;
};

// Streams `recipients` (ORDER BY id) with COPY ... TO STDOUT into the engine. Throws pg::Error on any
// database or validation failure; on failure `out` is left unchanged.
LoadStats loadEngine(PGconn* c, Engine& out);

// Parses one COPY text-format line into `row`; `scratch` keeps unescaped names alive. Exposed for tests.
bool parseCopyLine(std::string_view line, InputRow& row, std::string& scratchFirst, std::string& scratchLast,
                   std::string& err);

}  // namespace ssa::pg
