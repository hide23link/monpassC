import type { JwtPayload } from "./lib/jwt";

export type Variables = {
  payload: JwtPayload;
};

export type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  DOMAIN: string;
  ISSUE_START_DATE: string;
  ISSUE_END_DATE: string;
  MAX_TICKETS: string;
  JWT_SECRET: string;
  ADMIN_ID: string;
  ADMIN_PASSWORD: string;
};
