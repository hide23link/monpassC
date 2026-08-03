import { describe, it, expect } from "vitest";
import { seedStudent, seedStaff, loginStudent, loginStaff, authedFetch, jsonInit } from "./helpers";

describe("POST /ticket/issue", () => {
  it("issues a ticket without any qr_image/qr_url/qr_content field (PLAN.md section 4)", async () => {
    const student = await seedStudent();
    const token = await loginStudent(student.id, student.password);
    const res = await authedFetch(
      "/ticket/issue",
      token,
      jsonInit({ guest_name: "友人A" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      guest_name: "友人A",
      student_id: student.id,
      remaining: 4,
    });
    expect(body).not.toHaveProperty("qr_image");
    expect(body).not.toHaveProperty("qr_url");
    expect(body).not.toHaveProperty("qr_content");
  });

  it("HTML-escapes the guest name (XSS defense, mirrors test_TC_09_02_002)", async () => {
    const student = await seedStudent();
    const token = await loginStudent(student.id, student.password);
    const res = await authedFetch(
      "/ticket/issue",
      token,
      jsonInit({ guest_name: "<script>alert(1)</script>" }),
    );
    const body = (await res.json()) as { guest_name: string };
    expect(body.guest_name).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("enforces the MAX_TICKETS cap (403 on the 6th ticket)", async () => {
    const student = await seedStudent();
    const token = await loginStudent(student.id, student.password);
    for (let i = 0; i < 5; i++) {
      const r = await authedFetch("/ticket/issue", token, jsonInit({ guest_name: `guest-${i}` }));
      expect(r.status).toBe(200);
    }
    const res = await authedFetch("/ticket/issue", token, jsonInit({ guest_name: "one-too-many" }));
    expect(res.status).toBe(403);
  });

  it("rejects a student_id in the body that doesn't match the authenticated student", async () => {
    const student = await seedStudent();
    const token = await loginStudent(student.id, student.password);
    const res = await authedFetch(
      "/ticket/issue",
      token,
      jsonInit({ guest_name: "友人", student_id: "someone-else" }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { detail: string };
    expect(body.detail).toBe("他の生徒のチケットは発行できません");
  });

  it("rejects an empty guest name with 400", async () => {
    const student = await seedStudent();
    const token = await loginStudent(student.id, student.password);
    const res = await authedFetch("/ticket/issue", token, jsonInit({ guest_name: "   " }));
    expect(res.status).toBe(400);
  });
});

describe("GET /ticket/list", () => {
  it("returns only the authenticated student's own tickets with the expected fields", async () => {
    const studentA = await seedStudent({ id: "listA" });
    const studentB = await seedStudent({ id: "listB" });
    const tokenA = await loginStudent(studentA.id, studentA.password);
    const tokenB = await loginStudent(studentB.id, studentB.password);

    await authedFetch("/ticket/issue", tokenA, jsonInit({ guest_name: "Aの友人" }));
    await authedFetch("/ticket/issue", tokenB, jsonInit({ guest_name: "Bの友人" }));

    const listA = (await (await authedFetch("/ticket/list", tokenA)).json()) as Array<{
      guest_name: string;
      is_valid: number;
      used: number;
      used_at: string | null;
      created_at: string;
      student_name: string;
    }>;
    expect(listA).toHaveLength(1);
    expect(listA[0]).toMatchObject({
      guest_name: "Aの友人",
      is_valid: 1,
      used: 0,
      used_at: null,
      student_name: studentA.name,
    });
    expect(typeof listA[0].created_at).toBe("string");
  });
});

describe("DELETE /ticket/:ticket_id", () => {
  it("lets a student delete their own unused ticket", async () => {
    const student = await seedStudent();
    const token = await loginStudent(student.id, student.password);
    const issueRes = await authedFetch("/ticket/issue", token, jsonInit({ guest_name: "削除対象" }));
    const { ticket_id: ticketId } = (await issueRes.json()) as { ticket_id: string };

    const delRes = await authedFetch(`/ticket/${ticketId}`, token, { method: "DELETE" });
    expect(delRes.status).toBe(200);

    const list = (await (await authedFetch("/ticket/list", token)).json()) as Array<unknown>;
    expect(list).toHaveLength(0);
  });

  it("forbids deleting another student's ticket", async () => {
    const owner = await seedStudent({ id: "ownerX" });
    const other = await seedStudent({ id: "otherX" });
    const ownerToken = await loginStudent(owner.id, owner.password);
    const otherToken = await loginStudent(other.id, other.password);

    const issueRes = await authedFetch("/ticket/issue", ownerToken, jsonInit({ guest_name: "所有者の友人" }));
    const { ticket_id: ticketId } = (await issueRes.json()) as { ticket_id: string };

    const res = await authedFetch(`/ticket/${ticketId}`, otherToken, { method: "DELETE" });
    expect(res.status).toBe(403);
  });

  it("forbids deleting a used ticket", async () => {
    const student = await seedStudent();
    const token = await loginStudent(student.id, student.password);
    const issueRes = await authedFetch("/ticket/issue", token, jsonInit({ guest_name: "入場済み予定" }));
    const { ticket_id: ticketId } = (await issueRes.json()) as { ticket_id: string };

    const staff = await seedStaff();
    const staffToken = await loginStaff(staff.id, staff.password);
    await authedFetch("/ticket/scan", staffToken, jsonInit({ ticket_id: ticketId }));

    const res = await authedFetch(`/ticket/${ticketId}`, token, { method: "DELETE" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { detail: string };
    expect(body.detail).toBe("入場済みチケットは削除できません");
  });

  it("returns 404 for a nonexistent ticket", async () => {
    const student = await seedStudent();
    const token = await loginStudent(student.id, student.password);
    const res = await authedFetch("/ticket/does-not-exist", token, { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

describe("POST /ticket/scan", () => {
  async function issueTicket(): Promise<string> {
    const student = await seedStudent();
    const token = await loginStudent(student.id, student.password);
    const res = await authedFetch("/ticket/issue", token, jsonInit({ guest_name: "友人A" }));
    const body = (await res.json()) as { ticket_id: string };
    return body.ticket_id;
  }

  it("marks a valid unused ticket as used", async () => {
    const ticketId = await issueTicket();
    const staff = await seedStaff();
    const staffToken = await loginStaff(staff.id, staff.password);

    const res = await authedFetch("/ticket/scan", staffToken, jsonInit({ ticket_id: ticketId }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  it("rejects a second scan of the same ticket with 409 (byte-identical message to main.py)", async () => {
    const ticketId = await issueTicket();
    const staff = await seedStaff();
    const staffToken = await loginStaff(staff.id, staff.password);

    await authedFetch("/ticket/scan", staffToken, jsonInit({ ticket_id: ticketId }));
    const res = await authedFetch("/ticket/scan", staffToken, jsonInit({ ticket_id: ticketId }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { detail: string };
    expect(body.detail).toBe("入場済みチケットです (already used)");
  });

  it("returns 404 for a nonexistent ticket", async () => {
    const staff = await seedStaff();
    const staffToken = await loginStaff(staff.id, staff.password);
    const res = await authedFetch(
      "/ticket/scan",
      staffToken,
      jsonInit({ ticket_id: "does-not-exist" }),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { detail: string };
    expect(body.detail).toBe("存在しないチケットです (not found)");
  });

  it("rejects a scan of an admin-invalidated ticket with 400 (byte-identical message to main.py)", async () => {
    const ticketId = await issueTicket();
    const admin = await seedStaff({ id: "invalidator-admin", role: "admin" });
    const adminToken = await loginStaff(admin.id, admin.password);
    const invalidateRes = await authedFetch(
      `/admin/tickets/${ticketId}`,
      adminToken,
      jsonInit({ is_valid: 0 }, "PUT"),
    );
    expect(invalidateRes.status).toBe(200);

    const res = await authedFetch("/ticket/scan", adminToken, jsonInit({ ticket_id: ticketId }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { detail: string };
    expect(body.detail).toBe("無効なチケットです (invalid ticket)");
  });

  it(
    "allows exactly one winner under concurrent scans of the same ticket " +
      "(ports test_TC_13_003_concurrent_scans_no_duplicate_entry — the load-bearing " +
      "correctness test for the BEGIN IMMEDIATE -> conditional UPDATE replacement)",
    async () => {
      const ticketId = await issueTicket();
      const staff = await seedStaff();
      const staffToken = await loginStaff(staff.id, staff.password);

      const responses = await Promise.all(
        Array.from({ length: 10 }, () =>
          authedFetch("/ticket/scan", staffToken, jsonInit({ ticket_id: ticketId })),
        ),
      );
      const statuses = responses.map((r) => r.status).sort();
      const successCount = statuses.filter((s) => s === 200).length;
      const conflictCount = statuses.filter((s) => s === 409).length;

      expect(successCount).toBe(1);
      expect(conflictCount).toBe(9);
    },
  );

  it("un-marks a ticket on cancel, allowing it to be scanned again", async () => {
    const ticketId = await issueTicket();
    const staff = await seedStaff();
    const staffToken = await loginStaff(staff.id, staff.password);

    await authedFetch("/ticket/scan", staffToken, jsonInit({ ticket_id: ticketId }));
    const cancelRes = await authedFetch(
      `/ticket/scan/${ticketId}/cancel`,
      staffToken,
      jsonInit({}, "POST"),
    );
    expect(cancelRes.status).toBe(200);

    const rescan = await authedFetch("/ticket/scan", staffToken, jsonInit({ ticket_id: ticketId }));
    expect(rescan.status).toBe(200);
  });
});

describe("GET /ticket/cache and POST /ticket/sync", () => {
  it("caches valid tickets and syncs an offline queue, detecting conflicts", async () => {
    const student = await seedStudent();
    const studentToken = await loginStudent(student.id, student.password);
    const issueRes = await authedFetch(
      "/ticket/issue",
      studentToken,
      jsonInit({ guest_name: "友人B" }),
    );
    const { ticket_id: ticketId } = (await issueRes.json()) as { ticket_id: string };

    const staff = await seedStaff();
    const staffToken = await loginStaff(staff.id, staff.password);

    const cacheRes = await authedFetch("/ticket/cache", staffToken);
    expect(cacheRes.status).toBe(200);
    const cached = (await cacheRes.json()) as Array<{ ticket_id: string }>;
    expect(cached.some((t) => t.ticket_id === ticketId)).toBe(true);

    const syncRes = await authedFetch(
      "/ticket/sync",
      staffToken,
      jsonInit([
        { ticket_id: ticketId, scanned_at: new Date().toISOString(), session_id: "s1" },
        { ticket_id: ticketId, scanned_at: new Date().toISOString(), session_id: "s2" },
        { ticket_id: "unknown-ticket", scanned_at: new Date().toISOString(), session_id: "s3" },
      ]),
    );
    expect(syncRes.status).toBe(200);
    const results = (await syncRes.json()) as Array<Record<string, unknown>>;
    expect(results[0]).toMatchObject({ conflict: 0, synced: 1 });
    expect(results[1]).toMatchObject({ conflict: 1 });
    expect(results[2]).toMatchObject({ conflict: 0, error: "not found" });
  });

  it("delta cache (?since=) excludes tickets created before the cutoff", async () => {
    const student = await seedStudent();
    const studentToken = await loginStudent(student.id, student.password);
    await authedFetch("/ticket/issue", studentToken, jsonInit({ guest_name: "古いチケット" }));

    const staff = await seedStaff();
    const staffToken = await loginStaff(staff.id, staff.password);

    // A cutoff far in the future should exclude everything created so far.
    const futureCutoff = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const res = await authedFetch(
      `/ticket/cache?since=${encodeURIComponent(futureCutoff)}`,
      staffToken,
    );
    expect(res.status).toBe(200);
    const results = (await res.json()) as Array<unknown>;
    expect(results).toHaveLength(0);
  });
});

describe("GET /ticket/status and /ticket/my-scans", () => {
  it("reflects a scan in both the aggregate status and the scanning staff's own history", async () => {
    const student = await seedStudent();
    const studentToken = await loginStudent(student.id, student.password);
    const issueRes = await authedFetch(
      "/ticket/issue",
      studentToken,
      jsonInit({ guest_name: "友人C" }),
    );
    const { ticket_id: ticketId } = (await issueRes.json()) as { ticket_id: string };

    const staffA = await seedStaff({ id: "staffA" });
    const staffB = await seedStaff({ id: "staffB" });
    const staffAToken = await loginStaff(staffA.id, staffA.password);
    const staffBToken = await loginStaff(staffB.id, staffB.password);

    const beforeStatus = (await (await authedFetch("/ticket/status", staffAToken)).json()) as {
      total_entries: number;
    };

    const scanRes = await authedFetch("/ticket/scan", staffAToken, jsonInit({ ticket_id: ticketId }));
    expect(scanRes.status).toBe(200);

    const afterStatus = (await (await authedFetch("/ticket/status", staffAToken)).json()) as {
      total_entries: number;
    };
    expect(afterStatus.total_entries).toBe(beforeStatus.total_entries + 1);

    const staffAScans = (await (await authedFetch("/ticket/my-scans", staffAToken)).json()) as Array<{
      ticket_id: string;
    }>;
    expect(staffAScans.some((t) => t.ticket_id === ticketId)).toBe(true);

    // A different staff member's own history must not include this scan.
    const staffBScans = (await (await authedFetch("/ticket/my-scans", staffBToken)).json()) as Array<{
      ticket_id: string;
    }>;
    expect(staffBScans.some((t) => t.ticket_id === ticketId)).toBe(false);
  });
});
