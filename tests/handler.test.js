// This test referenced a root-level handler.js that no longer exists.
// The actual handler is src/handlers/get.js (exported as `main`, not `hello`).
// Skip until a replacement test is written against the real handler.
test.skip("hello handler", () => {});
