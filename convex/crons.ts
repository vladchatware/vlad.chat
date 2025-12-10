import { cronJobs } from "convex/server";
import { internal, api } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "Trial messages",
  { hourUTC: 17, minuteUTC: 30 },
  internal.users.resetMessages,
  {}
)

crons.weekly(
  "Trial tokens",
  { hourUTC: 17, minuteUTC: 30, dayOfWeek: 'sunday' },
  internal.users.resetTokens,
  {}
)

// Clear old lounge messages daily at 3 AM UTC
crons.daily(
  "Clear lounge messages",
  { hourUTC: 3, minuteUTC: 0 },
  internal.lounge.clearOldMessages,
  {}
)

export default crons;
