# ssa_server: HTTP API + web host over the C++ engine and PostgreSQL. Requires libpq (libpq-dev).
find_package(PostgreSQL REQUIRED)
find_package(Threads REQUIRED)

add_library(ssa_server_lib STATIC src/pg.cpp src/pg_loader.cpp src/sql_backend.cpp)
target_include_directories(ssa_server_lib PUBLIC src)
target_include_directories(ssa_server_lib SYSTEM PUBLIC third_party/httplib)  # vendored, warnings off
target_link_libraries(ssa_server_lib PUBLIC ssa_core PostgreSQL::PostgreSQL Threads::Threads)
target_compile_options(ssa_server_lib PRIVATE -Wall -Wextra -Wpedantic)

add_executable(ssa_server src/main.cpp)
target_link_libraries(ssa_server PRIVATE ssa_server_lib)
target_compile_options(ssa_server PRIVATE -Wall -Wextra)

add_executable(ssa_server_tests tests/test_sql.cpp)
target_link_libraries(ssa_server_tests PRIVATE ssa_server_lib)
add_test(NAME ssa_server_tests COMMAND ssa_server_tests)

install(TARGETS ssa_server ssa_export RUNTIME DESTINATION bin)
