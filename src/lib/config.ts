import type { Bindings } from "../env";

// Mirrors main.py's get_config().
export type Config = {
  jwtSecret: string;
  domain: string;
  issueStartDate: string;
  issueEndDate: string;
  maxTickets: number;
};

export function getConfig(env: Bindings): Config {
  return {
    jwtSecret: env.JWT_SECRET,
    domain: env.DOMAIN,
    issueStartDate: env.ISSUE_START_DATE,
    issueEndDate: env.ISSUE_END_DATE,
    maxTickets: parseInt(env.MAX_TICKETS, 10),
  };
}
