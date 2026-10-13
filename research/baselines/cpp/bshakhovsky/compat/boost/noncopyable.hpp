// Minimal stand-in for boost::noncopyable (header-only, same semantics) so the
// BShakhovsky module builds without Boost.
#pragma once
namespace boost {
class noncopyable {
protected:
    noncopyable() = default;
    ~noncopyable() = default;
public:
    noncopyable(const noncopyable&) = delete;
    noncopyable& operator=(const noncopyable&) = delete;
};
}
