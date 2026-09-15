// Test-only stand-in for src/scan/scan-worker.js: simulates "a crafted
// file that stalls a stubbed analyser" by busy-looping synchronously
// forever, so it never posts a message back. Used only to prove
// scanWithTimeout() actually terminates a worker that genuinely cannot
// be interrupted any other way (a Promise-based timeout cannot preempt
// a synchronous loop that never yields) -- see scan-timeout.test.js.
// Deliberately never requires src/scan/scan.js or touches the
// filesystem: this is exercising the timeout/termination mechanism
// itself, not the real scan pipeline.

// eslint-disable-next-line no-constant-condition
while (true) {
  // busy-loop: burn CPU without ever returning control to the event
  // loop, so no message is ever posted and no timer in THIS thread
  // could ever fire either -- only Worker#terminate() from the parent
  // thread can end this.
}
