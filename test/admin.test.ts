import { describe, it, expect } from "vitest";
import Encoding from "encoding-japanese/encoding.js";
import { seedStudent, seedStaff, loginStaff, authedFetch, jsonInit } from "./helpers";

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
