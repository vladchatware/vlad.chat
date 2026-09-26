import type { ComputerHandoffReason } from "./types";

const PAYMENT_RE =
  /\b(pay now|place order|confirm purchase|buy now|submit payment|complete payment|charge (my|the) card|apple pay|google pay)\b/i;
const SIGNING_RE =
  /\b(sign (the )?contract|sign (and )?submit|authorize transaction|approve wire|seed phrase|private key|connect wallet|sign message)\b/i;

export function looksLikePaymentOrSigning(text: string): boolean {
  return PAYMENT_RE.test(text) || SIGNING_RE.test(text);
}

export function handoffMessage(reason: ComputerHandoffReason): string {
  switch (reason) {
    case "payment":
      return "Payment requires explicit same-turn user confirmation. Do not complete checkout.";
    case "signing":
      return "Signing / wallet approval requires the user. Never sign autonomously.";
    case "sso":
      return "SSO / OAuth login needs the user in the browser session.";
    case "2fa":
      return "2FA / OTP needs the user. Do not guess codes.";
    case "captcha":
      return "Captcha likely. Hand off for the user to solve.";
    default:
      return "Human handoff required before continuing.";
  }
}
