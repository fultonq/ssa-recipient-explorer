#pragma once
// JSON request/response layer over ssa::Engine. Shared by the native tests, the WebAssembly C exports
// and the HTTP server, so every front end and both backends (engine, PostgreSQL) speak exactly the
// same JSON with exactly the same request semantics.
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

#include "ssa/engine.hpp"

namespace ssa::api {

// ---- engine-backed endpoints (request JSON in, response JSON out) ----------------------------------
std::string meta(const Engine& e);
std::string query(const Engine& e, std::string_view json);
std::string stats(const Engine& e, std::string_view json);
std::string get(const Engine& e, std::uint32_t id);

// ---- building blocks for other backends -----------------------------------------------------------
// Parse a query / stats request. On failure returns false and sets `err` to a user-facing message.
bool parseQuery(std::string_view json, Query& q, std::string& err);
bool parseFilter(std::string_view json, Filter& f, std::string& err);

std::string errorJson(const std::string& msg);
std::string recordJson(const Record& r);
std::string queryResponse(std::uint64_t total, const Query& q, double elapsedMs, const std::vector<Record>& page);
std::string statsResponse(const Stats& s);

}  // namespace ssa::api
