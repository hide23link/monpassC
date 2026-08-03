import type { Bindings } from "../env";

// Mirrors main.py's get_config(). LOGIN_MAX_FAILURES/LOGIN_LOCKOUT_MINUTES
// are plain Worker `vars` (strings), parsed to numbers here.
export type Config = {
  jwtSecret: string;
  domain: string;
  loginMaxFailures: number;
  loginLockoutMinutes: number;
  issueStartDate: string;
  issueEndDate: string;
  maxTickets: number;
};

export function getConfig(env: Bindings): Config {
  return {
    jwtSecret: env.JWT_SECRET,
    domain: env.DOMAIN,
    loginMaxFailures: parseInt(env.LOGIN_MAX_FAILURES, 10),
    loginLockoutMinutes: parseInt(env.LOGIN_LOCKOUT_MINUTES, 10),
    issueStartDate: env.ISSUE_START_DATE,
    issueEndDate: env.ISSUE_END_DATE,
    maxTickets: parseInt(env.MAX_TICKETS, 10),
  };
}
