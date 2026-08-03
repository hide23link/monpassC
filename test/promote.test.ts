import { describe, it, expect } from "vitest";
import { seedStudent, seedStaff, loginStudent, loginStaff, authedFetch, jsonInit } from "./helpers";

describe("promotion flow (/promote/*)", () => {
  it("lets a promoted student reach staff-only routes, and rejects token reuse", async () => {
    const student = await seedStudent();
    const studentToken = await loginStudent(student.id, student.password);
    const staff = await seedStaff({ role: "admin" });
    const staffToken = await loginStaff(staff.id, staff.password);

    const requestRes = await authedFetch("/promote/request", studentToken, jsonInit({}, "POST"));
    expect(requestRes.status).toBe(200);
    const requestBody = (await requestRes.json()) as { promote_token: string; qr_content: string };
    expect(requestBody.qr_content).toContain(requestBody.promote_token);
    expect(requestBody).not.toHaveProperty("qr_image");

    const approveRes = await authedFetch(
      "/promote/approve",
      staffToken,
      jsonInit({ promote_token: requestBody.promote_token }),
    );
    expect(approveRes.status).toBe(200);
    const approveBody = (await approveRes.json()) as { token: string; student_id: string };
    expect(approveBody.student_id).toBe(student.id);

    const [, payloadB64] = approveBody.token.split(".");
    const payload = JSON.parse(atob(payloadB64));
    expect(payload.role).toBe("student");
    expect(payload.promoted).toBe(true);

    // Reusing the same promote_token must fail.
    const reuseRes = await authedFetch(
      "/promote/approve",
      staffToken,
      jsonInit({ promote_token: requestBody.promote_token }),
    );
    expect(reuseRes.status).toBe(409);
    const reuseBody = (await reuseRes.json()) as { detail: string };
    expect(reuseBody.detail).toBe("使用済みの昇格トークンです");

    // The promoted student's token should now pass requireStaffOrAdmin.
    const dashRes = await authedFetch("/promote/list", staffToken);
    expect(dashRes.status).toBe(200);
  });

  it("rejects approval of an unknown token with 400", async () => {
    const staff = await seedStaff({ role: "admin" });
    const staffToken = await loginStaff(staff.id, staff.password);
    const res = await authedFetch(
      "/promote/approve",
      staffToken,
      jsonInit({ promote_token: "bogus-token" }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { detail: string };
    expect(body.detail).toBe("無効な昇格トークンです");
  });

  it("rejects an approval attempt from a plain (non-promoted) student with the promote-specific message", async () => {
    const requester = await seedStudent({ id: "requester" });
    const requesterToken = await loginStudent(requester.id, requester.password);
    const bystander = await seedStudent({ id: "bystander" });
    const bystanderToken = await loginStudent(bystander.id, bystander.password);

    const requestRes = await authedFetch("/promote/request", requesterToken, jsonInit({}, "POST"));
    const { promote_token: promoteToken } = (await requestRes.json()) as { promote_token: string };

    const res = await authedFetch(
      "/promote/approve",
      bystanderToken,
      jsonInit({ promote_token: promoteToken }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { detail: string };
    expect(body.detail).toBe("昇格承認権限がありません");
  });

  it("/promote/list is admin-only (a plain staff account is rejected)", async () => {
    const staff = await seedStaff({ role: "staff" });
    const staffToken = await loginStaff(staff.id, staff.password);
    const res = await authedFetch("/promote/list", staffToken);
    expect(res.status).toBe(403);
  });
});

describe("GET /promote/status (polling handoff to the requesting device)", () => {
  it("reports unapproved, then hands back a promoted token once a staff member approves elsewhere", async () => {
    const student = await seedStudent();
    const studentToken = await loginStudent(student.id, student.password);
    const staff = await seedStaff({ role: "admin" });
    const staffToken = await loginStaff(staff.id, staff.password);

    const requestRes = await authedFetch("/promote/request", studentToken, jsonInit({}, "POST"));
    const requestBody = (await requestRes.json()) as { promote_token: string; session_id: string };

    // Before approval: not yet approved, no token leaked.
    const pendingRes = await authedFetch(
      `/promote/status?session_id=${requestBody.session_id}`,
      studentToken,
    );
    expect(pendingRes.status).toBe(200);
    const pendingBody = (await pendingRes.json()) as { approved: boolean; token?: string };
    expect(pendingBody).toMatchObject({ approved: false });
    expect(pendingBody.token).toBeUndefined();

    // A staff member approves from a *different* device/session.
    await authedFetch(
      "/promote/approve",
      staffToken,
      jsonInit({ promote_token: requestBody.promote_token }),
    );

    // The original requester's device polls and gets its own usable promoted token.
    const approvedRes = await authedFetch(
      `/promote/status?session_id=${requestBody.session_id}`,
      studentToken,
    );
    const approvedBody = (await approvedRes.json()) as { approved: boolean; token: string };
    expect(approvedBody.approved).toBe(true);
    const [, payloadB64] = approvedBody.token.split(".");
    const payload = JSON.parse(atob(payloadB64));
    expect(payload.sub).toBe(student.id);
    expect(payload.promoted).toBe(true);
  });

  it("rejects a session_id belonging to another student", async () => {
    const requester = await seedStudent({ id: "sessionowner" });
    const requesterToken = await loginStudent(requester.id, requester.password);
    const bystander = await seedStudent({ id: "sessionsnooper" });
    const bystanderToken = await loginStudent(bystander.id, bystander.password);

    const requestRes = await authedFetch("/promote/request", requesterToken, jsonInit({}, "POST"));
    const { session_id: sessionId } = (await requestRes.json()) as { session_id: string };

    const res = await authedFetch(`/promote/status?session_id=${sessionId}`, bystanderToken);
    expect(res.status).toBe(404);
  });

  it("returns 404 for an unknown session_id", async () => {
    const student = await seedStudent();
    const studentToken = await loginStudent(student.id, student.password);
    const res = await authedFetch("/promote/status?session_id=no-such-session", studentToken);
    expect(res.status).toBe(404);
  });
});
