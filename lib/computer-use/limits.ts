/** Maximum time a live computer-use sandbox may run before provider cleanup. */
export const COMPUTER_USE_MAX_TTL_MS = 30 * 60 * 1000;
/** Preserve passive viewers for full session TTL; provider timeout stops idle compute. */
export const COMPUTER_USE_IDLE_MS = COMPUTER_USE_MAX_TTL_MS;
