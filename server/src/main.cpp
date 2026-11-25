// ssa_server: HTTP front for the SSA Recipient Explorer.
//   * Loads the in-memory C++ engine from PostgreSQL (system of record) or generates synthetic data.
//   * Serves the same JSON API from two backends, selectable per request with ?backend=engine|postgres,
//     so the UI, the cross-check tool and the benchmark can compare them on identical requests.
//   * Optionally serves the built web UI (same origin; no CORS needed).
//
// Configuration: flags (--name=value) override environment variables; see printUsage().
#include <pthread.h>

#include <atomic>
#include <chrono>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <ctime>
#include <filesystem>
#include <memory>
#include <optional>
#include <string>
#include <thread>

#include "httplib.h"
#include "pg.hpp"
#include "pg_loader.hpp"
#include "sql_backend.hpp"
#include "ssa/api.hpp"
#include "ssa/engine.hpp"

namespace {

using Clock = std::chrono::steady_clock;

struct Config {
  std::string host = "0.0.0.0";
  int port = 8080;
  std::string staticDir;
  std::string source = "postgres";  // postgres | generate
  std::uint32_t records = 1'000'000;  // generate mode only
  std::string conninfo;             // empty = libpq environment (PGHOST, PGUSER, ...)
  std::size_t pool = 4;
  int timeoutMs = 15'000;
  std::size_t threads = 8;
  int connectWaitSeconds = 60;
};

void printUsage() {
  std::puts(
      "ssa_server [--name=value ...]   (flag / environment variable / default)\n"
      "  --host        SSA_HOST            0.0.0.0\n"
      "  --port        SSA_PORT            8080\n"
      "  --static      SSA_STATIC_DIR      (none)     directory with the built web UI\n"
      "  --source      SSA_SOURCE          postgres   postgres | generate\n"
      "  --records     SSA_RECORDS         1000000    rows to generate (generate mode)\n"
      "  --pg          SSA_PG_CONNINFO     (libpq env) e.g. \"host=db dbname=ssa user=ssa\"\n"
      "  --pool        SSA_PG_POOL         4          PostgreSQL connections for the SQL backend\n"
      "  --timeout-ms  SSA_PG_TIMEOUT_MS   15000      per-statement timeout\n"
      "  --threads     SSA_THREADS         8          HTTP worker threads\n"
      "  --wait        SSA_PG_WAIT_S       60         seconds to wait for the database at startup");
}

std::string env(const char* k, const std::string& def) {
  const char* v = std::getenv(k);
  return v && *v ? v : def;
}

Config loadConfig(int argc, char** argv) {
  Config c;
  c.host = env("SSA_HOST", c.host);
  c.port = std::stoi(env("SSA_PORT", std::to_string(c.port)));
  c.staticDir = env("SSA_STATIC_DIR", c.staticDir);
  c.source = env("SSA_SOURCE", c.source);
  c.records = static_cast<std::uint32_t>(std::stoul(env("SSA_RECORDS", std::to_string(c.records))));
  c.conninfo = env("SSA_PG_CONNINFO", c.conninfo);
  c.pool = std::stoul(env("SSA_PG_POOL", std::to_string(c.pool)));
  c.timeoutMs = std::stoi(env("SSA_PG_TIMEOUT_MS", std::to_string(c.timeoutMs)));
  c.threads = std::stoul(env("SSA_THREADS", std::to_string(c.threads)));
  c.connectWaitSeconds = std::stoi(env("SSA_PG_WAIT_S", std::to_string(c.connectWaitSeconds)));
  for (int i = 1; i < argc; ++i) {
    std::string a = argv[i];
    if (a == "--help" || a == "-h") { printUsage(); std::exit(0); }
    auto eq = a.find('=');
    if (a.rfind("--", 0) != 0 || eq == std::string::npos) throw std::invalid_argument("bad argument: " + a);
    std::string k = a.substr(2, eq - 2), v = a.substr(eq + 1);
    if (k == "host") c.host = v;
    else if (k == "port") c.port = std::stoi(v);
    else if (k == "static") c.staticDir = v;
    else if (k == "source") c.source = v;
    else if (k == "records") c.records = static_cast<std::uint32_t>(std::stoul(v));
    else if (k == "pg") c.conninfo = v;
    else if (k == "pool") c.pool = std::stoul(v);
    else if (k == "timeout-ms") c.timeoutMs = std::stoi(v);
    else if (k == "threads") c.threads = std::stoul(v);
    else if (k == "wait") c.connectWaitSeconds = std::stoi(v);
    else throw std::invalid_argument("unknown option --" + k);
  }
  if (c.source != "postgres" && c.source != "generate") throw std::invalid_argument("--source must be postgres or generate");
  if (c.pool == 0 || c.threads == 0) throw std::invalid_argument("--pool and --threads must be positive");
  return c;
}

void logLine(const char* fmt, auto... args) {
  char ts[32];
  std::time_t t = std::time(nullptr);
  std::strftime(ts, sizeof ts, "%Y-%m-%dT%H:%M:%SZ", std::gmtime(&t));
  std::printf("%s ", ts);
  if constexpr (sizeof...(args) == 0) std::fputs(fmt, stdout);
  else std::printf(fmt, args...);
  std::printf("\n");
  std::fflush(stdout);
}

ssa::pg::Conn connectWithRetry(const Config& c) {
  const auto deadline = Clock::now() + std::chrono::seconds(c.connectWaitSeconds);
  for (int attempt = 1;; ++attempt) {
    try {
      return ssa::pg::connect(c.conninfo, c.timeoutMs * 20);  // the initial load may take a while
    } catch (const ssa::pg::Error& e) {
      if (Clock::now() >= deadline) throw;
      if (attempt == 1 || attempt % 10 == 0) logLine("waiting for PostgreSQL (%s)", e.what());
      std::this_thread::sleep_for(std::chrono::seconds(1));
    }
  }
}

thread_local Clock::time_point t_requestStart;

}  // namespace

int main(int argc, char** argv) {
  Config cfg;
  try {
    cfg = loadConfig(argc, argv);
  } catch (const std::exception& e) {
    std::fprintf(stderr, "configuration error: %s\n", e.what());
    printUsage();
    return 2;
  }

  // Block SIGINT/SIGTERM in every thread; a dedicated thread waits for them and stops the server.
  sigset_t sigs;
  sigemptyset(&sigs);
  sigaddset(&sigs, SIGINT);
  sigaddset(&sigs, SIGTERM);
  pthread_sigmask(SIG_BLOCK, &sigs, nullptr);

  ssa::Engine engine;
  std::unique_ptr<ssa::pg::Pool> pool;
  double loadSeconds = 0;
  try {
    if (cfg.source == "postgres") {
      auto conn = connectWithRetry(cfg);
      logLine("loading engine from PostgreSQL...");
      auto st = ssa::pg::loadEngine(conn.get(), engine);
      loadSeconds = st.seconds;
      logLine("engine loaded: %zu records in %.2f s (%.0f MB resident)", st.rows, st.seconds,
              engine.memoryBytes() / 1048576.0);
      pool = std::make_unique<ssa::pg::Pool>(cfg.conninfo, cfg.pool, cfg.timeoutMs);
      logLine("PostgreSQL backend ready (%zu connections, %d ms statement timeout)", cfg.pool, cfg.timeoutMs);
    } else {
      const auto t0 = Clock::now();
      engine.generate(cfg.records, 2026);
      loadSeconds = std::chrono::duration<double>(Clock::now() - t0).count();
      logLine("generated %zu synthetic records in %.2f s; PostgreSQL backend disabled", engine.size(), loadSeconds);
    }
  } catch (const std::exception& e) {
    logLine("startup failed: %s", e.what());
    return 1;
  }

  const bool havePg = pool != nullptr;
  const std::string backendsJson = havePg ? R"(["engine","postgres"])" : R"(["engine"])";

  httplib::Server svr;
  svr.new_task_queue = [&] { return new httplib::ThreadPool(cfg.threads); };
  svr.set_payload_max_length(64 * 1024);
  svr.set_read_timeout(10, 0);
  svr.set_write_timeout(10, 0);

  svr.set_pre_routing_handler([](const httplib::Request&, httplib::Response& res) {
    t_requestStart = Clock::now();
    res.set_header("X-Content-Type-Options", "nosniff");
    res.set_header("Referrer-Policy", "no-referrer");
    res.set_header("X-Frame-Options", "DENY");
    res.set_header("Content-Security-Policy",
                   "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; "
                   "img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; object-src 'none'; "
                   "frame-ancestors 'none'");
    return httplib::Server::HandlerResponse::Unhandled;
  });
  svr.set_logger([](const httplib::Request& req, const httplib::Response& res) {
    const double ms = std::chrono::duration<double, std::milli>(Clock::now() - t_requestStart).count();
    const std::string backend = req.has_param("backend") ? " backend=" + req.get_param_value("backend") : "";
    logLine("%s %s %d %.1fms%s", req.method.c_str(), req.path.c_str(), res.status, ms, backend.c_str());
  });

  auto sendJson = [](httplib::Response& res, int status, const std::string& body, const char* backend = nullptr) {
    res.status = status;
    res.set_header("Cache-Control", "no-store");
    if (backend) res.set_header("X-SSA-Backend", backend);
    const double ms = std::chrono::duration<double, std::milli>(Clock::now() - t_requestStart).count();
    res.set_header("Server-Timing", "total;dur=" + std::to_string(ms));
    res.set_content(body, "application/json");
  };

  // Resolves ?backend=..., answering 400/503 itself when the choice is invalid or unavailable.
  enum class Backend { Engine, Postgres };
  auto pickBackend = [&](const httplib::Request& req, httplib::Response& res) -> std::optional<Backend> {
    const std::string b = req.has_param("backend") ? req.get_param_value("backend") : "engine";
    if (b == "engine") return Backend::Engine;
    if (b == "postgres") {
      if (havePg) return Backend::Postgres;
      sendJson(res, 503, ssa::api::errorJson("postgres backend not available (server started with --source=generate)"));
      return std::nullopt;
    }
    sendJson(res, 400, ssa::api::errorJson("backend must be 'engine' or 'postgres'"));
    return std::nullopt;
  };

  // Runs a PostgreSQL call, mapping failures to 503 (pool exhausted) or 500 (logged, generic to client).
  auto withPg = [&](httplib::Response& res, auto&& fn) {
    try {
      auto lease = pool->acquire();
      fn(lease.get());
    } catch (const ssa::pg::Error& e) {
      const bool busy = std::string(e.what()).find("database busy") == 0;
      logLine("postgres error: %s", e.what());
      sendJson(res, busy ? 503 : 500, ssa::api::errorJson(busy ? "database busy, try again" : "database error"), "postgres");
    }
  };

  svr.Get("/api/health", [&](const httplib::Request&, httplib::Response& res) {
    bool dbOk = true;
    if (havePg) {
      try {
        auto lease = pool->acquire(std::chrono::milliseconds(500));
        ssa::pg::exec(lease.get(), "SELECT 1");
      } catch (const std::exception&) {
        dbOk = false;
      }
    }
    char body[256];
    std::snprintf(body, sizeof body,
                  R"({"status":"%s","source":"%s","records":%zu,"backends":%s,"database":"%s","loadSeconds":%.3f})",
                  dbOk ? "ok" : "degraded", cfg.source.c_str(), engine.size(), backendsJson.c_str(),
                  havePg ? (dbOk ? "up" : "down") : "disabled", loadSeconds);
    sendJson(res, dbOk ? 200 : 503, body);
  });

  svr.Get("/api/meta", [&](const httplib::Request&, httplib::Response& res) {
    std::string m = ssa::api::meta(engine);
    m.pop_back();  // splice server facts into the engine's meta object
    m += ",\"backends\":" + backendsJson + ",\"source\":\"" + cfg.source + "\",\"server\":true}";
    sendJson(res, 200, m);
  });

  svr.Post("/api/query", [&](const httplib::Request& req, httplib::Response& res) {
    auto backend = pickBackend(req, res);
    if (!backend) return;
    ssa::Query q;
    std::string err;
    if (!ssa::api::parseQuery(req.body, q, err)) return sendJson(res, 400, ssa::api::errorJson(err));
    if (*backend == Backend::Engine) {
      const ssa::QueryResult r = engine.query(q);
      std::vector<ssa::Record> page;
      page.reserve(r.rows.size());
      for (auto row : r.rows) page.push_back(engine.record(row));
      return sendJson(res, 200, ssa::api::queryResponse(r.total, q, r.elapsedMs, page), "engine");
    }
    withPg(res, [&](PGconn* c) {
      auto r = ssa::sql::query(c, q);
      sendJson(res, 200, ssa::api::queryResponse(r.total, q, r.elapsedMs, r.records), "postgres");
    });
  });

  svr.Post("/api/stats", [&](const httplib::Request& req, httplib::Response& res) {
    auto backend = pickBackend(req, res);
    if (!backend) return;
    ssa::Filter f;
    std::string err;
    if (!ssa::api::parseFilter(req.body, f, err)) return sendJson(res, 400, ssa::api::errorJson(err));
    if (*backend == Backend::Engine) return sendJson(res, 200, ssa::api::statsResponse(engine.stats(f)), "engine");
    withPg(res, [&](PGconn* c) { sendJson(res, 200, ssa::api::statsResponse(ssa::sql::stats(c, f)), "postgres"); });
  });

  svr.Get(R"(/api/records/(\d{1,10}))", [&](const httplib::Request& req, httplib::Response& res) {
    auto backend = pickBackend(req, res);
    if (!backend) return;
    const auto id = std::stoull(req.matches[1].str());
    if (id == 0 || id > UINT32_MAX) return sendJson(res, 404, ssa::api::errorJson("no such record"));
    if (*backend == Backend::Engine) {
      if (id > engine.size()) return sendJson(res, 404, ssa::api::errorJson("no such record"), "engine");
      return sendJson(res, 200, ssa::api::get(engine, static_cast<std::uint32_t>(id)), "engine");
    }
    withPg(res, [&](PGconn* c) {
      ssa::Record r;
      if (!ssa::sql::get(c, static_cast<std::uint32_t>(id), r)) return sendJson(res, 404, ssa::api::errorJson("no such record"), "postgres");
      sendJson(res, 200, ssa::api::recordJson(r), "postgres");
    });
  });

  // Unknown /api/* routes get JSON 404s rather than falling through to the static files.
  svr.set_error_handler([&](const httplib::Request& req, httplib::Response& res) {
    if (req.path.rfind("/api/", 0) == 0 && res.body.empty()) sendJson(res, res.status, ssa::api::errorJson("not found"));
  });
  svr.set_exception_handler([&](const httplib::Request&, httplib::Response& res, std::exception_ptr ep) {
    try {
      std::rethrow_exception(ep);
    } catch (const std::exception& e) {
      logLine("unhandled exception: %s", e.what());
    } catch (...) {
      logLine("unhandled non-standard exception");
    }
    sendJson(res, 500, ssa::api::errorJson("internal error"));
  });

  if (!cfg.staticDir.empty()) {
    if (!std::filesystem::is_directory(cfg.staticDir) || !svr.set_mount_point("/", cfg.staticDir)) {
      logLine("static directory '%s' not found; serving API only", cfg.staticDir.c_str());
    } else {
      logLine("serving web UI from %s", cfg.staticDir.c_str());
    }
  }

  std::thread signals([&] {
    int sig = 0;
    sigwait(&sigs, &sig);
    logLine("received signal %d, shutting down", sig);
    svr.stop();
  });

  logLine("listening on http://%s:%d (backends: %s)", cfg.host.c_str(), cfg.port, backendsJson.c_str());
  const bool ok = svr.listen(cfg.host, cfg.port);
  if (!ok) {
    logLine("could not listen on %s:%d", cfg.host.c_str(), cfg.port);
    pthread_kill(signals.native_handle(), SIGTERM);  // release the signal thread
  }
  signals.join();
  logLine("stopped");
  return ok ? 0 : 1;
}
