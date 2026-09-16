import ConvexMobile

// Convex documents its Rust-backed client as safe across concurrency domains,
// but version 0.8.1 does not declare Swift 6 Sendable conformance yet.
extension ConvexClientWithAuth: @retroactive @unchecked Sendable where T: Sendable {}
