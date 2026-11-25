#include "pg.hpp"

namespace ssa::pg {

Conn connect(const std::string& conninfo, int statementTimeoutMs) {
  Conn c(PQconnectdb(conninfo.c_str()));
  if (!c || PQstatus(c.get()) != CONNECTION_OK) {
    std::string msg = c ? PQerrorMessage(c.get()) : "out of memory";
    throw Error("cannot connect to PostgreSQL: " + msg);
  }
  exec(c.get(), "SELECT set_config('statement_timeout', $1, false)", {std::to_string(statementTimeoutMs)});
  exec(c.get(), "SELECT set_config('application_name', 'ssa_server', false)");
  return c;
}

Result exec(PGconn* c, const std::string& sql, const std::vector<std::string>& params) {
  std::vector<const char*> values;
  values.reserve(params.size());
  for (const auto& p : params) values.push_back(p.c_str());
  Result r(PQexecParams(c, sql.c_str(), static_cast<int>(values.size()), nullptr, values.data(), nullptr,
                        nullptr, 0));
  const auto status = r ? PQresultStatus(r.get()) : PGRES_FATAL_ERROR;
  if (status != PGRES_TUPLES_OK && status != PGRES_COMMAND_OK) {
    throw Error(std::string("query failed: ") + PQerrorMessage(c));
  }
  return r;
}

Pool::Pool(std::string conninfo, std::size_t size, int statementTimeoutMs)
    : conninfo_(std::move(conninfo)), size_(size), timeoutMs_(statementTimeoutMs) {
  for (std::size_t i = 0; i < size_; ++i) idle_.push_back(connect(conninfo_, timeoutMs_));
}

Pool::Lease::~Lease() {
  if (pool_ && conn_) pool_->release(std::move(conn_));
}

Pool::Lease Pool::acquire(std::chrono::milliseconds wait) {
  std::unique_lock lk(mu_);
  if (!cv_.wait_for(lk, wait, [&] { return !idle_.empty(); })) throw Error("database busy: no free connection");
  Conn c = std::move(idle_.back());
  idle_.pop_back();
  lk.unlock();
  if (PQstatus(c.get()) != CONNECTION_OK) {
    try {
      c = connect(conninfo_, timeoutMs_);  // replace a connection the server dropped
    } catch (...) {
      release(std::move(c));               // keep the pool size constant; next caller retries
      throw;
    }
  }
  return Lease(*this, std::move(c));
}

void Pool::release(Conn c) {
  {
    std::lock_guard lk(mu_);
    idle_.push_back(std::move(c));
  }
  cv_.notify_one();
}

}  // namespace ssa::pg
