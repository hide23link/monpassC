import type { Bindings } from "../env";

// 生のBindings(Workerの`vars`はすべて文字列で届くため数値/真偽値型を持たない)を
// 薄くラップする型。各ルートは`c.env.MAX_TICKETS`を直接読むのではなく、ハンドラの
// 冒頭で一度`getConfig(c.env)`を呼ぶ形にしているので、parseInt()の処理が1箇所に
// まとまる。
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
