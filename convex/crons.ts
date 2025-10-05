import { cronJobs } from "convex/server";
import { internal, api } from "./_generated/api";

const crons = cronJobs();

// Generate invoices for the previous month
crons.monthly(
  "Invoices",
  // Wait a day after the new month starts to generate invoices
  { day: 2, hourUTC: 0, minuteUTC: 0 },
  internal.invoicing.generateInvoices,
  {},
);

// crons.daily(
//   "Rate Limits",
//   { hourUTC: 17, minuteUTC: 30 },
//   api.usage.resetLimits,
//   {}
// )

export default crons;
