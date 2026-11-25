// C exports for WebAssembly (and any other FFI host). All strings returned are
// owned by the module and valid until the next call.
#include <cstdint>
#include <string>

#include "ssa/api.hpp"

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define SSA_EXPORT extern "C" EMSCRIPTEN_KEEPALIVE
#else
#define SSA_EXPORT extern "C"
#endif

namespace {
ssa::Engine g_engine;
std::string g_out;
const char* ret(std::string s) {
  g_out = std::move(s);
  return g_out.c_str();
}
}  // namespace

SSA_EXPORT std::uint32_t ssa_init(std::uint32_t n, std::uint32_t seed) {
  g_engine.generate(n, seed);
  return static_cast<std::uint32_t>(g_engine.size());
}
SSA_EXPORT const char* ssa_meta() { return ret(ssa::api::meta(g_engine)); }
SSA_EXPORT const char* ssa_query(const char* json) { return ret(ssa::api::query(g_engine, json ? json : "")); }
SSA_EXPORT const char* ssa_stats(const char* json) { return ret(ssa::api::stats(g_engine, json ? json : "")); }
SSA_EXPORT const char* ssa_get(std::uint32_t id) { return ret(ssa::api::get(g_engine, id)); }
