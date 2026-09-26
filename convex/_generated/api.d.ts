/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agents_prompts from "../agents/prompts.js";
import type * as agents_simple from "../agents/simple.js";
import type * as apiKeys from "../apiKeys.js";
import type * as auth from "../auth.js";
import type * as billing from "../billing.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as lounge from "../lounge.js";
import type * as meter from "../meter.js";
import type * as notion from "../notion.js";
import type * as posthog from "../posthog.js";
import type * as threads from "../threads.js";
import type * as users from "../users.js";
import type * as validators from "../validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "agents/prompts": typeof agents_prompts;
  "agents/simple": typeof agents_simple;
  apiKeys: typeof apiKeys;
  auth: typeof auth;
  billing: typeof billing;
  crons: typeof crons;
  http: typeof http;
  lounge: typeof lounge;
  meter: typeof meter;
  notion: typeof notion;
  posthog: typeof posthog;
  threads: typeof threads;
  users: typeof users;
  validators: typeof validators;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
};
