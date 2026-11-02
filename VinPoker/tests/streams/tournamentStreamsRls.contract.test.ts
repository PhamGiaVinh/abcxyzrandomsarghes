import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ownerWriteMigration = readFileSync(
  resolve(process.cwd(), "supabase/migration-archive/historical-never-replay/20270110000009_tournament_streams_owner_write_policy.sql"),
  "utf8",
);
const customStreamMigration = readFileSync(
  resolve(process.cwd(), "supabase/migration-archive/historical-never-replay/20270110000010_owner_custom_stream_authorization.sql"),
  "utf8",
);
const streamLinkManager = readFileSync(resolve(process.cwd(), "src/components/admin/StreamLinkManager.tsx"), "utf8");
const adminStreamManager = readFileSync(resolve(process.cwd(), "src/components/admin/AdminStreamManager.tsx"), "utf8");

describe("tournament_streams owner write policy", () => {
  it("restores only authenticated insert, update, and delete policies", () => {
    expect(ownerWriteMigration).toContain('DROP POLICY IF EXISTS "Admin or club owner manage streams"');
    expect(ownerWriteMigration).toMatch(/CREATE POLICY "Tournament stream managers insert"[\s\S]*FOR INSERT[\s\S]*TO authenticated/);
    expect(ownerWriteMigration).toMatch(/CREATE POLICY "Tournament stream managers update"[\s\S]*FOR UPDATE[\s\S]*TO authenticated/);
    expect(ownerWriteMigration).toMatch(/CREATE POLICY "Tournament stream managers delete"[\s\S]*FOR DELETE[\s\S]*TO authenticated/);
    expect(ownerWriteMigration).not.toMatch(/FOR ALL/);
    expect(ownerWriteMigration).not.toMatch(/TO\s+(?:anon|public)/i);
  });

  it("requires a super-admin or ownership of the stream tournament for every linked write", () => {
    const writePolicies = ownerWriteMigration.slice(ownerWriteMigration.indexOf('CREATE POLICY "Tournament stream managers insert"'));

    expect(writePolicies.match(/public\.has_role\(\(select auth\.uid\(\)\), 'super_admin'::public\.app_role\)/g)).toHaveLength(4);
    expect(writePolicies.match(/tournament\.id = tournament_streams\.tournament_id/g)).toHaveLength(4);
    expect(writePolicies.match(/\bclub\.owner_id = \(select auth\.uid\(\)\)/g)).toHaveLength(4);
  });

  it("checks both the old and replacement tournament scope for an update", () => {
    const updatePolicy = ownerWriteMigration.slice(
      ownerWriteMigration.indexOf('CREATE POLICY "Tournament stream managers update"'),
      ownerWriteMigration.indexOf('CREATE POLICY "Tournament stream managers delete"'),
    );

    expect(updatePolicy).toContain("USING (");
    expect(updatePolicy).toContain("WITH CHECK (");
  });

  it("makes created_by server-owned and immutable", () => {
    expect(ownerWriteMigration).toContain("CREATE OR REPLACE FUNCTION public.enforce_tournament_stream_creator()");
    expect(ownerWriteMigration).toContain("NEW.created_by := auth.uid();");
    expect(ownerWriteMigration).toContain("NEW.created_by IS DISTINCT FROM OLD.created_by");
    expect(ownerWriteMigration).toContain("ERRCODE = '42501'");
    expect(ownerWriteMigration).toContain("CREATE TRIGGER trg_tournament_streams_creator_guard");
  });

  it("does not alter existing rows, public read access, or RLS enablement", () => {
    expect(ownerWriteMigration).not.toMatch(/(?:INSERT\s+INTO|UPDATE\s+public\.tournament_streams|DELETE\s+FROM)/i);
    expect(ownerWriteMigration).not.toMatch(/(?:DISABLE|ENABLE)\s+ROW LEVEL SECURITY/i);
  });

  it("does not send a browser-controlled creator and rejects zero-row mutations", () => {
    expect(streamLinkManager).not.toMatch(/created_by\s*:/);
    expect(adminStreamManager).not.toMatch(/created_by\s*:/);
    expect(streamLinkManager.match(/\.select\("id"\)/g)).toHaveLength(3);
    // Four stream mutations plus the manual tournament counter update return proof.
    expect(adminStreamManager.match(/\.select\("id"\)/g)).toHaveLength(5);
    expect(streamLinkManager).toContain("changedExactlyOneStream(data)");
    expect(adminStreamManager).toContain("changedExactlyOneStream(data)");
  });

  it("allows a club owner to create and manage only their own custom stream", () => {
    const writePolicies = customStreamMigration.slice(customStreamMigration.indexOf('CREATE POLICY "Tournament stream managers insert"'));

    expect(customStreamMigration).toContain('DROP POLICY IF EXISTS "Tournament stream managers insert"');
    expect(writePolicies.match(/tournament_streams\.tournament_id IS NULL/g)).toHaveLength(4);
    expect(writePolicies.match(/tournament_streams\.created_by = \(select auth\.uid\(\)\)/g)).toHaveLength(4);
    expect(writePolicies.match(/owner_club\.owner_id = \(select auth\.uid\(\)\)/g)).toHaveLength(4);
    expect(writePolicies.match(/tournament\.id = tournament_streams\.tournament_id/g)).toHaveLength(4);
    expect(writePolicies.match(/\bclub\.owner_id = \(select auth\.uid\(\)\)/g)).toHaveLength(4);
    expect(writePolicies.match(/public\.has_role\(\(select auth\.uid\(\)\), 'super_admin'::public\.app_role\)/g)).toHaveLength(4);
    expect(customStreamMigration).not.toMatch(/(?:INSERT\s+INTO|UPDATE\s+public\.tournament_streams|DELETE\s+FROM)/i);
    expect(customStreamMigration).not.toMatch(/(?:DISABLE|ENABLE)\s+ROW LEVEL SECURITY/i);
  });

  it("offers an external custom-stream path without a browser-controlled creator", () => {
    expect(streamLinkManager).toContain('const CUSTOM_STREAM_VALUE = "__custom_stream__"');
    expect(streamLinkManager).toContain("tournament_id: isCustom ? null : tourId");
    expect(streamLinkManager).toContain('custom_tournament_name: isCustom ? customName.trim() || "Stream tùy chỉnh" : null');
    expect(streamLinkManager).toContain("Stream tùy chỉnh của bạn (không gắn giải)");
    expect(streamLinkManager).toContain("Dán link phát từ bên ngoài; stream này không cần giải đấu và chỉ bạn có thể quản lý.");
    expect(streamLinkManager).not.toMatch(/created_by\s*:/);
  });
});
