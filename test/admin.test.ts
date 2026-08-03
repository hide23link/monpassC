import { describe, it, expect } from "vitest";
import Encoding from "encoding-japanese/encoding.js";
import { seedStudent, seedStaff, loginStudent, loginStaff, authedFetch, jsonInit } from "./helpers";

async function adminToken() {
  const staff = await seedStaff({ id: "admin1", role: "admin" });
  return loginStaff(staff.id, staff.password);
}

describe("admin student management", () => {
  it("creates, lists, and rejects a duplicate student", async () => {
    const token = await adminToken();
    const create = await authedFetch(
      "/admin/students",
      token,
      jsonInit({ student_id: "1234", name: "花子", class_name: "2-B", password: "initpass1" }),
    );
    expect(create.status).toBe(200);

    const dup = await authedFetch(
      "/admin/students",
      token,
      jsonInit({ student_id: "1234", name: "dup", class_name: "1-A", password: "x" }),
    );
    expect(dup.status).toBe(409);

    const list = await authedFetch("/admin/students", token);
    const students = (await list.json()) as Array<{ id: string }>;
    expect(students.some((s) => s.id === "1234")).toBe(true);
  });

  it("resets a password, auto-generating one when none is supplied", async () => {
    const token = await adminToken();
    const student = await seedStudent();
    const res = await authedFetch(
      `/admin/students/${student.id}/reset-password`,
      token,
      jsonInit({}, "POST"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { password: string };
    expect(body.password).toHaveLength(8);
  });

  it(
    "force-deletes a used ticket and cascades student deletion without hitting D1's " +
      "foreign-key constraint on offline_scan_queue (regression test for the FK bug found " +
      "during manual testing — main.py never enforced FKs, D1 does by default)",
    async () => {
      const token = await adminToken();
      const student = await seedStudent();

      const createTicket = await authedFetch(
        "/admin/tickets",
        token,
        jsonInit({ student_id: student.id, guest_name: "強制作成" }),
      );
      const { ticket_id: ticketId } = (await createTicket.json()) as { ticket_id: string };

      await authedFetch(`/admin/tickets/${ticketId}`, token, jsonInit({ used: 1 }, "PUT"));

      // Simulate an offline sync record referencing this ticket, which is
      // exactly what triggered the FK violation during manual testing.
      const staff = await seedStaff();
      const staffToken = await loginStaff(staff.id, staff.password);
      await authedFetch(
        "/ticket/sync",
        staffToken,
        jsonInit([{ ticket_id: ticketId, scanned_at: new Date().toISOString(), session_id: "s1" }]),
      );

      const deleteRes = await authedFetch(`/admin/tickets/${ticketId}`, token, {
        method: "DELETE",
      });
      expect(deleteRes.status).toBe(200);

      const deleteStudentRes = await authedFetch(`/admin/students/${student.id}`, token, {
        method: "DELETE",
      });
      expect(deleteStudentRes.status).toBe(200);
    },
  );

  it("gets a single student with ticket/entry counts", async () => {
    const token = await adminToken();
    const student = await seedStudent({ id: "getme" });
    await authedFetch(
      "/admin/tickets",
      token,
      jsonInit({ student_id: student.id, guest_name: "友人" }),
    );

    const res = await authedFetch(`/admin/students/${student.id}`, token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; ticket_count: number; entry_count: number };
    expect(body).toMatchObject({ id: student.id, ticket_count: 1, entry_count: 0 });
  });

  it("returns 404 for a nonexistent student", async () => {
    const token = await adminToken();
    const res = await authedFetch("/admin/students/no-such-student", token);
    expect(res.status).toBe(404);
  });

  it("updates a student's name, class, and password", async () => {
    const token = await adminToken();
    const student = await seedStudent({ id: "updateme" });

    const res = await authedFetch(
      `/admin/students/${student.id}`,
      token,
      jsonInit({ name: "新しい名前", class_name: "9-Z" }, "PUT"),
    );
    expect(res.status).toBe(200);

    const after = (await (await authedFetch(`/admin/students/${student.id}`, token)).json()) as {
      name: string;
      class: string;
    };
    expect(after).toMatchObject({ name: "新しい名前", class: "9-Z" });

    // Password update takes effect for login.
    await authedFetch(
      `/admin/students/${student.id}`,
      token,
      jsonInit({ password: "brandnewpass1" }, "PUT"),
    );
    const newToken = await loginStudent(student.id, "brandnewpass1");
    expect(typeof newToken).toBe("string");
  });

  it("rejects a reset-password request with a too-short custom password", async () => {
    const token = await adminToken();
    const student = await seedStudent({ id: "shortpw" });
    const res = await authedFetch(
      `/admin/students/${student.id}/reset-password`,
      token,
      jsonInit({ password: "ab" }, "POST"),
    );
    expect(res.status).toBe(400);
  });

  it("deletes a student with no tickets", async () => {
    const token = await adminToken();
    const student = await seedStudent({ id: "deleteme" });
    const res = await authedFetch(`/admin/students/${student.id}`, token, { method: "DELETE" });
    expect(res.status).toBe(200);

    const list = (await (await authedFetch("/admin/students", token)).json()) as Array<{ id: string }>;
    expect(list.some((s) => s.id === student.id)).toBe(false);
  });
});

describe("admin ticket management", () => {
  it("lists tickets and filters by student_name and status", async () => {
    const token = await adminToken();
    const student = await seedStudent({ id: "filterstu", name: "フィルタ太郎" });
    const studentToken = await loginStudent(student.id, student.password);

    await authedFetch("/ticket/issue", studentToken, jsonInit({ guest_name: "検索対象ゲスト" }));

    const all = (await (await authedFetch("/admin/tickets", token)).json()) as Array<{
      student_name: string;
    }>;
    expect(all.some((t) => t.student_name === "フィルタ太郎")).toBe(true);

    const byName = (await (
      await authedFetch("/admin/tickets?student_name=フィルタ", token)
    ).json()) as Array<{ student_name: string }>;
    expect(byName.length).toBeGreaterThan(0);
    expect(byName.every((t) => t.student_name === "フィルタ太郎")).toBe(true);

    const unused = (await (
      await authedFetch("/admin/tickets?status=unused", token)
    ).json()) as Array<{ used: number }>;
    expect(unused.every((t) => t.used === 0)).toBe(true);
  });

  it("gets, updates, and deletes a single ticket", async () => {
    const token = await adminToken();
    const student = await seedStudent({ id: "ticketops" });
    const createRes = await authedFetch(
      "/admin/tickets",
      token,
      jsonInit({ student_id: student.id, guest_name: "単体操作対象" }),
    );
    const { ticket_id: ticketId } = (await createRes.json()) as { ticket_id: string };

    const getRes = await authedFetch(`/admin/tickets/${ticketId}`, token);
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as { guest_name: string; used: number };
    expect(getBody).toMatchObject({ guest_name: "単体操作対象", used: 0 });

    const putRes = await authedFetch(
      `/admin/tickets/${ticketId}`,
      token,
      jsonInit({ used: 1 }, "PUT"),
    );
    expect(putRes.status).toBe(200);
    const putBody = (await putRes.json()) as { used: number; used_at: string | null };
    expect(putBody.used).toBe(1);
    expect(putBody.used_at).not.toBeNull();

    // used=0 must clear used_at too.
    const revertRes = await authedFetch(
      `/admin/tickets/${ticketId}`,
      token,
      jsonInit({ used: 0 }, "PUT"),
    );
    const revertBody = (await revertRes.json()) as { used: number; used_at: string | null };
    expect(revertBody).toMatchObject({ used: 0, used_at: null });

    const delRes = await authedFetch(`/admin/tickets/${ticketId}`, token, { method: "DELETE" });
    expect(delRes.status).toBe(200);
    const afterDelete = await authedFetch(`/admin/tickets/${ticketId}`, token);
    expect(afterDelete.status).toBe(404);
  });

  it("returns 404 creating a ticket for a nonexistent student", async () => {
    const token = await adminToken();
    const res = await authedFetch(
      "/admin/tickets",
      token,
      jsonInit({ student_id: "no-such-student", guest_name: "誰か" }),
    );
    expect(res.status).toBe(404);
  });

  it("bypasses the 5-ticket cap for admin-created tickets", async () => {
    const token = await adminToken();
    const student = await seedStudent({ id: "capbypass" });
    for (let i = 0; i < 6; i++) {
      const res = await authedFetch(
        "/admin/tickets",
        token,
        jsonInit({ student_id: student.id, guest_name: `admin-guest-${i}` }),
      );
      expect(res.status).toBe(200);
    }
  });
});

describe("admin staff management", () => {
  it("creates, lists, and rejects a duplicate staff id", async () => {
    const token = await adminToken();
    const create = await authedFetch(
      "/admin/staff",
      token,
      jsonInit({ staff_id: "newstaff1", name: "新スタッフ", password: "pw12345678", role: "staff" }),
    );
    expect(create.status).toBe(200);

    const dup = await authedFetch(
      "/admin/staff",
      token,
      jsonInit({ staff_id: "newstaff1", name: "重複", password: "x", role: "staff" }),
    );
    expect(dup.status).toBe(409);

    const list = (await (await authedFetch("/admin/staff", token)).json()) as Array<{
      id: string;
      role: string;
    }>;
    expect(list.find((s) => s.id === "newstaff1")).toMatchObject({ role: "staff" });
  });

  it("deletes a staff account", async () => {
    const token = await adminToken();
    await authedFetch(
      "/admin/staff",
      token,
      jsonInit({ staff_id: "deletestaff", name: "削除対象", password: "pw12345678" }),
    );
    const delRes = await authedFetch("/admin/staff/deletestaff", token, { method: "DELETE" });
    expect(delRes.status).toBe(200);

    const list = (await (await authedFetch("/admin/staff", token)).json()) as Array<{ id: string }>;
    expect(list.some((s) => s.id === "deletestaff")).toBe(false);
  });

  it("exports staff as CSV without passwords", async () => {
    const token = await adminToken();
    await authedFetch(
      "/admin/staff",
      token,
      jsonInit({ staff_id: "exportstaff", name: "エクスポート太郎", password: "pw12345678", role: "staff" }),
    );

    const res = await authedFetch("/admin/staff/export", token);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const text = await res.text();
    expect(text).toContain("エクスポート太郎");
    expect(text).not.toContain("pw12345678");
  });

  it("imports a staff CSV with a header row and default role", async () => {
    const token = await adminToken();
    const csv = "スタッフID,氏名,パスワード,ロール\nimportstaff1,インポート一郎,pw12345678,\nimportstaff2,インポート二郎,pw12345678,admin\n";
    const form = new FormData();
    form.set("file", new File([csv], "staff.csv", { type: "text/csv" }));

    const res = await authedFetch("/admin/staff/import", token, { method: "POST", body: form });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success_count: number; skip_count: number };
    expect(body).toEqual({ success_count: 2, skip_count: 0 });

    const list = (await (await authedFetch("/admin/staff", token)).json()) as Array<{
      id: string;
      role: string;
    }>;
    expect(list.find((s) => s.id === "importstaff1")).toMatchObject({ role: "staff" });
    expect(list.find((s) => s.id === "importstaff2")).toMatchObject({ role: "admin" });
  });
});

describe("admin tickets CSV export", () => {
  it("exports the full ticket list with Japanese status labels", async () => {
    const token = await adminToken();
    const student = await seedStudent({ id: "exportticket", name: "輸出太郎" });
    await authedFetch(
      "/admin/tickets",
      token,
      jsonInit({ student_id: student.id, guest_name: "エクスポート対象ゲスト" }),
    );

    const res = await authedFetch("/admin/export", token);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const text = await res.text();
    expect(text).toContain("輸出太郎");
    expect(text).toContain("エクスポート対象ゲスト");
    expect(text).toContain("未入場");
    expect(text).toContain("有効");
  });
});

describe("admin dashboard", () => {
  it("aggregates entry counts", async () => {
    const token = await adminToken();
    const res = await authedFetch("/admin/dashboard", token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total_entries: number; unused_count: number };
    expect(typeof body.total_entries).toBe("number");
    expect(typeof body.unused_count).toBe("number");
  });
});

describe("admin settings", () => {
  it("round-trips the issue period", async () => {
    const token = await adminToken();
    const put = await authedFetch(
      "/admin/settings",
      token,
      jsonInit({ issue_start: "2026-09-01", issue_end: "2026-09-30" }, "PUT"),
    );
    expect(put.status).toBe(200);

    const get = await authedFetch("/admin/settings", token);
    const body = (await get.json()) as { issue_start: string; issue_end: string };
    expect(body).toEqual({ issue_start: "2026-09-01", issue_end: "2026-09-30" });
  });
});

describe("admin CSV import (encoding detection — PLAN.md risk #3)", () => {
  function csvFile(text: string, to: "UTF8" | "SJIS"): File {
    const unicodeArray = Encoding.stringToCode(text);
    const bytes =
      to === "UTF8"
        ? new Uint8Array(Encoding.convert(unicodeArray, { to: "UTF8", from: "UNICODE" }))
        : new Uint8Array(Encoding.convert(unicodeArray, { to: "SJIS", from: "UNICODE" }));
    return new File([bytes], "students.csv", { type: "text/csv" });
  }

  it("imports a UTF-8 CSV with a Japanese header", async () => {
    const token = await adminToken();
    const csv = "学籍番号,氏名,クラス\n2001,山田太郎,1-A\n2002,佐藤花子,1-B\n";
    const form = new FormData();
    form.set("file", csvFile(csv, "UTF8"));

    const res = await authedFetch("/admin/import", token, { method: "POST", body: form });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success_count: number; skip_count: number };
    expect(body).toEqual({ success_count: 2, skip_count: 0 });

    const list = await authedFetch("/admin/students", token);
    const students = (await list.json()) as Array<{ id: string; name: string }>;
    expect(students.find((s) => s.id === "2001")?.name).toBe("山田太郎");
  });

  it("imports a Shift_JIS-encoded CSV without mojibake", async () => {
    const token = await adminToken();
    const csv = "学籍番号,氏名,クラス\n3001,鈴木一郎,1-C\n";
    const form = new FormData();
    form.set("file", csvFile(csv, "SJIS"));

    const res = await authedFetch("/admin/import", token, { method: "POST", body: form });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success_count: number };
    expect(body.success_count).toBe(1);

    const list = await authedFetch("/admin/students", token);
    const students = (await list.json()) as Array<{ id: string; name: string }>;
    expect(students.find((s) => s.id === "3001")?.name).toBe("鈴木一郎");
  });

  it("exposes the generated passwords via /admin/import/passwords as CSV", async () => {
    const token = await adminToken();
    const csv = "学籍番号,氏名,クラス\n4001,test,1-A\n";
    const form = new FormData();
    form.set("file", csvFile(csv, "UTF8"));
    await authedFetch("/admin/import", token, { method: "POST", body: form });

    const res = await authedFetch("/admin/import/passwords", token);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("4001");
    expect(res.headers.get("Content-Type")).toContain("text/csv");
  });
});
