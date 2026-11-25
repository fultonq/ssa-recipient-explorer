#pragma once
// Thin RAII layer over libpq: owned connections/results, a bounded connection pool, and parameterized
// queries only (no SQL is ever built by concatenating user input).
#include <libpq-fe.h>

#include <chrono>
#include <condition_variable>
#include <memory>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

namespace ssa::pg {

struct Error : std::runtime_error {
  using std::runtime_error::runtime_error;
};

struct ConnDeleter {
  void operator()(PGconn* c) const noexcept { PQfinish(c); }
};
struct ResultDeleter {
  void operator()(PGresult* r) const noexcept { PQclear(r); }
};
using Conn = std::unique_ptr<PGconn, ConnDeleter>;
using Result = std::unique_ptr<PGresult, ResultDeleter>;

// Connects using `conninfo` (empty = libpq environment: PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE)
// and applies a per-statement timeout so one slow query can never pin a connection forever.
Conn connect(const std::string& conninfo, int statementTimeoutMs);

// Runs a parameterized statement (text params, text results). Throws pg::Error on failure.
Result exec(PGconn* c, const std::string& sql, const std::vector<std::string>& params = {});

class Pool {
 public:
  Pool(std::string conninfo, std::size_t size, int statementTimeoutMs);

  class Lease {
   public:
    Lease(Pool& p, Conn c) : pool_(&p), conn_(std::move(c)) {}
    Lease(Lease&&) = default;
    Lease& operator=(Lease&&) = default;
    ~Lease();
    PGconn* get() const { return conn_.get(); }

   private:
    Pool* pool_;
    Conn conn_;
  };

  // Blocks up to `wait` for a free connection; reconnects broken ones transparently.
  Lease acquire(std::chrono::milliseconds wait = std::chrono::seconds(5));
  std::size_t size() const { return size_; }

 private:
  void release(Conn c);
  std::string conninfo_;
  std::size_t size_;
  int timeoutMs_;
  std::mutex mu_;
  std::condition_variable cv_;
  std::vector<Conn> idle_;
};

}  // namespace ssa::pg
