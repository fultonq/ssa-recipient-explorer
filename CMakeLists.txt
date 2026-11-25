# SSA Recipient Explorer - top-level build. Open this folder in CLion or VS Code (CMake Tools);
# both pick up CMakePresets.json. Presets: debug, release, asan (AddressSanitizer + UBSan).
cmake_minimum_required(VERSION 3.20)
project(ssa_recipient_explorer VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)  # for clangd / VS Code IntelliSense
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES AND NOT EMSCRIPTEN)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

option(SSA_BUILD_SERVER "Build ssa_server (requires libpq)" ON)
option(SSA_SANITIZE "Build with AddressSanitizer + UndefinedBehaviorSanitizer" OFF)

if(SSA_SANITIZE)
  add_compile_options(-fsanitize=address,undefined -fno-omit-frame-pointer -fno-sanitize-recover=all)
  add_link_options(-fsanitize=address,undefined)
endif()

enable_testing()
add_subdirectory(engine)
if(SSA_BUILD_SERVER AND NOT EMSCRIPTEN)
  add_subdirectory(server)
endif()
