cmake_minimum_required(VERSION 3.20)
project(ssa_engine LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES AND NOT EMSCRIPTEN)
  set(CMAKE_BUILD_TYPE Release)
endif()

set(SSA_SOURCES src/engine.cpp src/api.cpp)

if(EMSCRIPTEN)
  # ---- WebAssembly build: emcmake cmake -B build-wasm && cmake --build build-wasm
  add_executable(ssa_engine ${SSA_SOURCES} src/capi.cpp)
  target_include_directories(ssa_engine PRIVATE include)
  target_compile_options(ssa_engine PRIVATE -O3 -Wall -Wextra)
  target_link_options(ssa_engine PRIVATE
    -O3
    --no-entry
    -sMODULARIZE=1
    -sEXPORT_NAME=createSsaEngine
    -sENVIRONMENT=web,worker
    -sALLOW_MEMORY_GROWTH=1
    -sINITIAL_MEMORY=268435456       # 256 MB; ~100 MB of that is 5M records
    -sMAXIMUM_MEMORY=2147483648
    -sSTACK_SIZE=1048576
    "-sEXPORTED_FUNCTIONS=['_ssa_init','_ssa_meta','_ssa_query','_ssa_stats','_ssa_get','_malloc','_free']"
    "-sEXPORTED_RUNTIME_METHODS=['cwrap','ccall','UTF8ToString','stringToUTF8','lengthBytesUTF8','stackSave','stackAlloc','stackRestore']")
  # Emit straight into the frontend's public/ folder.
  set_target_properties(ssa_engine PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/../web/public/wasm
    SUFFIX ".js")
else()
  # ---- Native build: library, tests, benchmark
  add_library(ssa_core STATIC ${SSA_SOURCES})
  target_include_directories(ssa_core PUBLIC include)
  target_compile_options(ssa_core PRIVATE -Wall -Wextra -Wpedantic)

  add_executable(ssa_tests tests/test_engine.cpp)
  target_link_libraries(ssa_tests PRIVATE ssa_core)

  add_executable(ssa_bench bench/bench.cpp)
  target_link_libraries(ssa_bench PRIVATE ssa_core)

  add_executable(ssa_cli tools/ssa_cli.cpp)
  target_link_libraries(ssa_cli PRIVATE ssa_core)

  add_executable(ssa_export tools/ssa_export.cpp)
  target_link_libraries(ssa_export PRIVATE ssa_core)

  # capi.cpp is compiled natively too so the export surface can't silently rot.
  add_library(ssa_capi OBJECT src/capi.cpp)
  target_link_libraries(ssa_capi PRIVATE ssa_core)

  enable_testing()
  add_test(NAME ssa_tests COMMAND ssa_tests)
endif()
