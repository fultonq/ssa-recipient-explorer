#include "ssa/api.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>

#include "json.hpp"

namespace ssa::api {
namespace {

using json::Value;

std::string fmtMs(double ms) {
  char buf[32];
  std::snprintf(buf, sizeof buf, "%.3f", ms);
  return buf;
}

std::string pad(unsigned v, int width) {
  char buf[16];
  std::snprintf(buf, sizeof buf, "%0*u", width, v);
  return buf;
}

// Reads an optional numeric field; returns false (with err) if present but not a number.
bool numField(const Value& obj, const char* key, double& out, bool& present, std::string& err) {
  present = false;
  const Value* v = obj.get(key);
  if (!v || v->kind == Value::Kind::Null) return true;
  if (v->kind == Value::Kind::Num) { out = v->n; present = true; return true; }
  if (v->kind == Value::Kind::Str && !v->s.empty()) {
    char* end = nullptr;
    out = std::strtod(v->s.c_str(), &end);
    if (end && *end == '\0') { present = true; return true; }
  }
  err = std::string("field '") + key + "' must be a number";
  return false;
}

bool yearField(const Value& obj, const char* key, std::uint16_t& out, std::string& err) {
  double d = 0;
  bool present = false;
  if (!numField(obj, key, d, present, err)) return false;
  if (present) out = static_cast<std::uint16_t>(std::clamp(d, 0.0, 65535.0));
  return true;
}

bool maskField(const Value& obj, const char* key, int (*lookup)(std::string_view), std::uint64_t& mask,
               std::string& err) {
  const Value* v = obj.get(key);
  if (!v || v->kind == Value::Kind::Null) return true;
  if (v->kind != Value::Kind::Arr) { err = std::string("field '") + key + "' must be an array"; return false; }
  if (v->a.empty()) return true;  // empty = no restriction
  std::uint64_t m = 0;
  for (const Value& it : v->a) {
    if (it.kind != Value::Kind::Str) { err = std::string("field '") + key + "' must contain strings"; return false; }
    int idx = lookup(it.s);
    if (idx < 0) { err = "unknown value '" + it.s + "' in '" + key + "'"; return false; }
    m |= 1ULL << idx;
  }
  mask = m;
  return true;
}

bool parseFilterValue(const Value& obj, Filter& f, std::string& err) {
  if (const Value* t = obj.get("text")) {
    if (t->kind == Value::Kind::Str) f.text = t->s;
    else if (t->kind != Value::Kind::Null) { err = "field 'text' must be a string"; return false; }
  }
  if (!maskField(obj, "states", stateIndex, f.stateMask, err)) return false;
  std::uint64_t tm = f.typeMask, sm = f.statusMask;
  if (!maskField(obj, "types", typeIndex, tm, err)) return false;
  if (!maskField(obj, "statuses", statusIndex, sm, err)) return false;
  f.typeMask = static_cast<std::uint8_t>(tm);
  f.statusMask = static_cast<std::uint8_t>(sm);

  double d = 0;
  bool present = false;
  if (!numField(obj, "minBenefit", d, present, err)) return false;
  if (present) f.minCents = static_cast<std::uint32_t>(std::llround(std::clamp(d, 0.0, 1e7) * 100));
  if (!numField(obj, "maxBenefit", d, present, err)) return false;
  if (present) f.maxCents = static_cast<std::uint32_t>(std::llround(std::clamp(d, 0.0, 1e7) * 100));
  if (!yearField(obj, "minBirthYear", f.minBirthYear, err)) return false;
  if (!yearField(obj, "maxBirthYear", f.maxBirthYear, err)) return false;
  if (!yearField(obj, "minEntYear", f.minEntYear, err)) return false;
  if (!yearField(obj, "maxEntYear", f.maxEntYear, err)) return false;
  if (!numField(obj, "last4", d, present, err)) return false;
  if (present) f.last4 = (d < 0 || d > 9999) ? 10000 : static_cast<std::int32_t>(d);
  if (!numField(obj, "id", d, present, err)) return false;
  if (present) f.id = d < 0 ? 0 : static_cast<std::int64_t>(d);
  return true;
}

bool parseSort(const std::string& s, SortKey& k) {
  if (s == "id") k = SortKey::Id;
  else if (s == "lastName") k = SortKey::LastName;
  else if (s == "firstName") k = SortKey::FirstName;
  else if (s == "benefit") k = SortKey::Benefit;
  else if (s == "birthYear") k = SortKey::BirthYear;
  else if (s == "entitlementYear") k = SortKey::EntitlementYear;
  else if (s == "state") k = SortKey::State;
  else return false;
  return true;
}

void appendRecord(std::string& o, const Record& r) {
  o += "{\"id\":" + std::to_string(r.id);
  o += ",\"firstName\":"; json::escapeInto(o, r.firstName);
  o += ",\"lastName\":"; json::escapeInto(o, r.lastName);
  o += ",\"last4\":\"" + pad(r.last4, 4) + "\"";
  o += ",\"birthYear\":" + std::to_string(r.birthYear);
  o += ",\"state\":\""; o += stateCode(r.state); o += "\"";
  o += ",\"stateName\":\""; o += stateName(r.state); o += "\"";
  o += ",\"zip3\":\"" + pad(r.zip3, 3) + "\"";
  o += ",\"type\":\""; o += typeName(static_cast<std::size_t>(r.type)); o += "\"";
  o += ",\"status\":\""; o += statusName(static_cast<std::size_t>(r.status)); o += "\"";
  o += ",\"monthlyCents\":" + std::to_string(r.monthlyCents);
  o += ",\"entitlementYear\":" + std::to_string(r.entitlementYear);
  o += "}";
}

template <typename T, std::size_t N>
void appendArray(std::string& o, const char* key, const std::array<T, N>& a) {
  o += ",\""; o += key; o += "\":[";
  for (std::size_t i = 0; i < N; ++i) { if (i) o += ','; o += std::to_string(a[i]); }
  o += "]";
}

bool parseRoot(std::string_view text, Value& root, std::string& err) {
  if (text.empty()) { root.kind = Value::Kind::Obj; return true; }
  if (!json::parse(text, root, err)) { err = "invalid JSON: " + err; return false; }
  if (root.kind != Value::Kind::Obj) { err = "request must be a JSON object"; return false; }
  return true;
}

bool parseQueryValue(const Value& root, Query& q, std::string& err) {
  if (!parseFilterValue(root, q.filter, err)) return false;
  if (const Value* s = root.get("sort")) {
    if (s->kind != Value::Kind::Str || !parseSort(s->s, q.sort)) { err = "unknown sort key"; return false; }
  }
  if (const Value* d = root.get("desc")) q.desc = d->kind == Value::Kind::Bool && d->b;
  double d = 0;
  bool present = false;
  if (!numField(root, "offset", d, present, err)) return false;
  if (present) q.offset = static_cast<std::uint32_t>(std::clamp(d, 0.0, 4e9));
  q.limit = 50;
  if (!numField(root, "limit", d, present, err)) return false;
  if (present) q.limit = static_cast<std::uint32_t>(std::clamp(d, 0.0, 1000.0));
  return true;
}

}  // namespace

std::string errorJson(const std::string& msg) {
  std::string o = "{\"error\":";
  json::escapeInto(o, msg);
  o += "}";
  return o;
}

bool parseQuery(std::string_view json, Query& q, std::string& err) {
  Value root;
  if (!parseRoot(json, root, err)) return false;
  return parseQueryValue(root, q, err);
}

bool parseFilter(std::string_view json, Filter& f, std::string& err) {
  Value root;
  if (!parseRoot(json, root, err)) return false;
  return parseFilterValue(root, f, err);
}

std::string recordJson(const Record& r) {
  std::string o;
  appendRecord(o, r);
  return o;
}

std::string queryResponse(std::uint64_t total, const Query& q, double elapsedMs, const std::vector<Record>& page) {
  std::string o;
  o.reserve(256 + page.size() * 220);
  o += "{\"total\":" + std::to_string(total);
  o += ",\"offset\":" + std::to_string(q.offset);
  o += ",\"limit\":" + std::to_string(q.limit);
  o += ",\"elapsedMs\":" + fmtMs(elapsedMs);
  o += ",\"records\":[";
  for (std::size_t i = 0; i < page.size(); ++i) {
    if (i) o += ',';
    appendRecord(o, page[i]);
  }
  o += "]}";
  return o;
}

std::string statsResponse(const Stats& s) {
  std::string o = "{\"count\":" + std::to_string(s.count);
  o += ",\"sumCents\":" + std::to_string(s.sumCents);
  o += ",\"minCents\":" + std::to_string(s.minCents);
  o += ",\"maxCents\":" + std::to_string(s.maxCents);
  o += ",\"avgCents\":" + std::to_string(s.count ? s.sumCents / s.count : 0);
  appendArray(o, "byState", s.byState);
  appendArray(o, "byType", s.byType);
  appendArray(o, "byStatus", s.byStatus);
  appendArray(o, "benefitHist", s.benefitHist);
  o += ",\"elapsedMs\":" + fmtMs(s.elapsedMs) + "}";
  return o;
}

std::string meta(const Engine& e) {
  std::string o = "{\"count\":" + std::to_string(e.size());
  o += ",\"memoryBytes\":" + std::to_string(e.memoryBytes());
  o += ",\"states\":[";
  for (std::size_t i = 0; i < kNumStates; ++i) {
    if (i) o += ',';
    o += "{\"code\":\""; o += stateCode(i); o += "\",\"name\":\""; o += stateName(i); o += "\"}";
  }
  o += "],\"types\":[";
  for (std::size_t i = 0; i < kNumTypes; ++i) { if (i) o += ','; o += "\""; o += typeName(i); o += "\""; }
  o += "],\"statuses\":[";
  for (std::size_t i = 0; i < kNumStatuses; ++i) { if (i) o += ','; o += "\""; o += statusName(i); o += "\""; }
  o += "],\"histBucketCents\":" + std::to_string(kHistBucketCents) + "}";
  return o;
}

std::string query(const Engine& e, std::string_view text) {
  Query q;
  std::string err;
  if (!parseQuery(text, q, err)) return errorJson(err);
  QueryResult r = e.query(q);
  std::vector<Record> page;
  page.reserve(r.rows.size());
  for (auto row : r.rows) page.push_back(e.record(row));
  return queryResponse(r.total, q, r.elapsedMs, page);
}

std::string stats(const Engine& e, std::string_view text) {
  Filter f;
  std::string err;
  if (!parseFilter(text, f, err)) return errorJson(err);
  return statsResponse(e.stats(f));
}

std::string get(const Engine& e, std::uint32_t id) {
  if (id == 0 || id > e.size()) return errorJson("no such record");
  return recordJson(e.record(id - 1));
}

}  // namespace ssa::api
