import { cronJobs } from "convex/server";
import { internal, api } from "./_generated/api";

const crons = cronJobs();

// crons.daily(
//   "Rate Limits",
//   { hourUTC: 17, minuteUTC: 30 },
//   api.usage.resetLimits,
//   {}
// )

export default crons;
