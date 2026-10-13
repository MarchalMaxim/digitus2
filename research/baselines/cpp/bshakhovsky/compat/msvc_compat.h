// Force-included when building the MSVC-only BShakhovsky module with MinGW g++:
// MSVC's "abstract" class-key extension and <cfloat>/<cstdint> it pulls in implicitly.
#pragma once
#define abstract
#include <cfloat>
#include <cstdint>
#include <cstdio>
