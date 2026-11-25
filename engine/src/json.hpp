#pragma once
// Minimal JSON reader (enough for query objects) - no external dependencies.
#include <cstdio>
#include <cstdlib>
#include <string>
#include <string_view>
#include <vector>

namespace ssa::json {

struct Value {
  enum class Kind { Null, Bool, Num, Str, Arr, Obj } kind = Kind::Null;
  bool b = false;
  double n = 0;
  std::string s;
  std::vector<Value> a;           // array items, or object values
  std::vector<std::string> keys;  // object keys (parallel to `a`)

  const Value* get(std::string_view key) const {
    if (kind != Kind::Obj) return nullptr;
    for (std::size_t i = 0; i < keys.size(); ++i)
      if (keys[i] == key) return &a[i];
    return nullptr;
  }
};

class Parser {
 public:
  explicit Parser(std::string_view t) : t_(t) {}

  bool parse(Value& out, std::string& err) {
    skip();
    if (!value(out, 0)) { err = err_; return false; }
    skip();
    if (p_ != t_.size()) { err = "trailing characters at offset " + std::to_string(p_); return false; }
    return true;
  }

 private:
  std::string_view t_;
  std::size_t p_ = 0;
  std::string err_;

  bool fail(const char* m) { err_ = std::string(m) + " at offset " + std::to_string(p_); return false; }
  void skip() { while (p_ < t_.size() && (t_[p_] == ' ' || t_[p_] == '\t' || t_[p_] == '\n' || t_[p_] == '\r')) ++p_; }
  bool lit(std::string_view w) {
    if (t_.substr(p_, w.size()) == w) { p_ += w.size(); return true; }
    return false;
  }

  bool value(Value& v, int depth) {
    if (depth > 32) return fail("nesting too deep");
    if (p_ >= t_.size()) return fail("unexpected end");
    char c = t_[p_];
    if (c == '{') return object(v, depth);
    if (c == '[') return array(v, depth);
    if (c == '"') { v.kind = Value::Kind::Str; return string(v.s); }
    if (lit("true")) { v.kind = Value::Kind::Bool; v.b = true; return true; }
    if (lit("false")) { v.kind = Value::Kind::Bool; v.b = false; return true; }
    if (lit("null")) { v.kind = Value::Kind::Null; return true; }
    if (c == '-' || (c >= '0' && c <= '9')) return number(v);
    return fail("unexpected character");
  }

  bool number(Value& v) {
    std::size_t start = p_;
    if (t_[p_] == '-') ++p_;
    while (p_ < t_.size() && ((t_[p_] >= '0' && t_[p_] <= '9') || t_[p_] == '.' || t_[p_] == 'e' ||
                              t_[p_] == 'E' || t_[p_] == '+' || t_[p_] == '-'))
      ++p_;
    std::string tmp(t_.substr(start, p_ - start));
    char* end = nullptr;
    v.n = std::strtod(tmp.c_str(), &end);
    if (end == tmp.c_str() || *end != '\0') return fail("bad number");
    v.kind = Value::Kind::Num;
    return true;
  }

  static void utf8(std::string& o, unsigned cp) {
    if (cp < 0x80) o.push_back(static_cast<char>(cp));
    else if (cp < 0x800) { o.push_back(static_cast<char>(0xC0 | (cp >> 6))); o.push_back(static_cast<char>(0x80 | (cp & 0x3F))); }
    else { o.push_back(static_cast<char>(0xE0 | (cp >> 12))); o.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F))); o.push_back(static_cast<char>(0x80 | (cp & 0x3F))); }
  }

  bool string(std::string& out) {
    ++p_;  // opening quote
    out.clear();
    while (p_ < t_.size()) {
      char c = t_[p_++];
      if (c == '"') return true;
      if (c != '\\') { out.push_back(c); continue; }
      if (p_ >= t_.size()) break;
      char e = t_[p_++];
      switch (e) {
        case '"': out.push_back('"'); break;
        case '\\': out.push_back('\\'); break;
        case '/': out.push_back('/'); break;
        case 'b': out.push_back('\b'); break;
        case 'f': out.push_back('\f'); break;
        case 'n': out.push_back('\n'); break;
        case 'r': out.push_back('\r'); break;
        case 't': out.push_back('\t'); break;
        case 'u': {
          if (p_ + 4 > t_.size()) return fail("bad \\u escape");
          unsigned cp = 0;
          for (int i = 0; i < 4; ++i) {
            char h = t_[p_++];
            cp <<= 4;
            if (h >= '0' && h <= '9') cp |= static_cast<unsigned>(h - '0');
            else if (h >= 'a' && h <= 'f') cp |= static_cast<unsigned>(h - 'a' + 10);
            else if (h >= 'A' && h <= 'F') cp |= static_cast<unsigned>(h - 'A' + 10);
            else return fail("bad \\u escape");
          }
          utf8(out, cp);
          break;
        }
        default: return fail("bad escape");
      }
    }
    return fail("unterminated string");
  }

  bool array(Value& v, int depth) {
    ++p_;
    v.kind = Value::Kind::Arr;
    skip();
    if (p_ < t_.size() && t_[p_] == ']') { ++p_; return true; }
    for (;;) {
      skip();
      v.a.emplace_back();
      if (!value(v.a.back(), depth + 1)) return false;
      skip();
      if (p_ < t_.size() && t_[p_] == ',') { ++p_; continue; }
      if (p_ < t_.size() && t_[p_] == ']') { ++p_; return true; }
      return fail("expected , or ]");
    }
  }

  bool object(Value& v, int depth) {
    ++p_;
    v.kind = Value::Kind::Obj;
    skip();
    if (p_ < t_.size() && t_[p_] == '}') { ++p_; return true; }
    for (;;) {
      skip();
      if (p_ >= t_.size() || t_[p_] != '"') return fail("expected key");
      std::string key;
      if (!string(key)) return false;
      skip();
      if (p_ >= t_.size() || t_[p_] != ':') return fail("expected :");
      ++p_;
      skip();
      v.keys.push_back(std::move(key));
      v.a.emplace_back();
      if (!value(v.a.back(), depth + 1)) return false;
      skip();
      if (p_ < t_.size() && t_[p_] == ',') { ++p_; continue; }
      if (p_ < t_.size() && t_[p_] == '}') { ++p_; return true; }
      return fail("expected , or }");
    }
  }
};

inline bool parse(std::string_view text, Value& out, std::string& err) {
  return Parser(text).parse(out, err);
}

inline void escapeInto(std::string& out, std::string_view s) {
  out.push_back('"');
  for (char c : s) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (static_cast<unsigned char>(c) < 0x20) {
          char buf[8];
          std::snprintf(buf, sizeof buf, "\\u%04x", c);
          out += buf;
        } else out.push_back(c);
    }
  }
  out.push_back('"');
}

}  // namespace ssa::json
