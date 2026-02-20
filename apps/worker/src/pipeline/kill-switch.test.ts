import assert from "node:assert/strict";
import test from "node:test";
import {
  EnvKillSwitchStore,
  KillSwitchService,
  type KillSwitchGlobalControls,
  type KillSwitchStore,
  type KillSwitchTenantControls
} from "./kill-switch";

class StaticStore implements KillSwitchStore {
  constructor(
    private readonly global: KillSwitchGlobalControls,
    private readonly tenantById: Record<string, KillSwitchTenantControls> = {}
  ) {}

  async getGlobalControls(): Promise<KillSwitchGlobalControls> {
    return this.global;
  }

  async getTenantControls(tenantId: string): Promise<KillSwitchTenantControls> {
    return this.tenantById[tenantId] ?? {};
  }
}

test("global env kill forces writeback and labels disabled", async () => {
  const service = new KillSwitchService({
    store: new StaticStore({ writebackEnabled: true, labelsEnabled: true }),
    refreshMs: 30_000,
    env: {
      MAILBOX_KILL_WRITEBACK: "1",
      MAILBOX_KILL_LABELS: "1"
    }
  });
  await service.refreshNow();

  const writeback = await service.getWritebackDecision("tenant-a");
  const labels = await service.getLabelsDecision("tenant-a");

  assert.equal(writeback.enabled, false);
  assert.equal(writeback.reason, "env_global_kill");
  assert.equal(labels.enabled, false);
  assert.equal(labels.reason, "env_global_kill");
});

test("tenant kill env list disables only specified tenant", async () => {
  const service = new KillSwitchService({
    store: new StaticStore({ writebackEnabled: true, labelsEnabled: true }),
    refreshMs: 30_000,
    env: {
      MAILBOX_TENANT_KILL_WRITEBACK: "tenant-a",
      MAILBOX_TENANT_KILL_LABELS: "tenant-b"
    }
  });
  await service.refreshNow();

  const tenantAWriteback = await service.getWritebackDecision("tenant-a");
  const tenantBWriteback = await service.getWritebackDecision("tenant-b");
  const tenantBLabels = await service.getLabelsDecision("tenant-b");

  assert.equal(tenantAWriteback.enabled, false);
  assert.equal(tenantAWriteback.reason, "env_tenant_kill");
  assert.equal(tenantBWriteback.enabled, true);
  assert.equal(tenantBLabels.enabled, false);
  assert.equal(tenantBLabels.reason, "env_tenant_kill");
});

test("global env kill takes precedence over tenant allow from store", async () => {
  const service = new KillSwitchService({
    store: new StaticStore(
      { writebackEnabled: true, labelsEnabled: true },
      {
        "tenant-a": { writebackEnabled: true, labelsEnabled: true }
      }
    ),
    refreshMs: 30_000,
    env: {
      MAILBOX_KILL_WRITEBACK: "1"
    }
  });
  await service.refreshNow();

  const decision = await service.getWritebackDecision("tenant-a");
  assert.equal(decision.enabled, false);
  assert.equal(decision.reason, "env_global_kill");
});

test("fail-closed disables controls when store read fails", async () => {
  const failingStore: KillSwitchStore = {
    async getGlobalControls() {
      throw new Error("boom");
    },
    async getTenantControls() {
      return {};
    }
  };

  const service = new KillSwitchService({
    store: failingStore,
    refreshMs: 30_000
  });
  await service.refreshNow();

  const writeback = await service.getWritebackDecision("tenant-a");
  const labels = await service.getLabelsDecision("tenant-a");

  assert.equal(writeback.enabled, false);
  assert.equal(writeback.reason, "store_error_fail_closed");
  assert.equal(labels.enabled, false);
  assert.equal(labels.reason, "store_error_fail_closed");
});

test("refresh picks up updated store values", async () => {
  let enabled = true;
  const mutableStore: KillSwitchStore = {
    async getGlobalControls() {
      return {
        writebackEnabled: enabled,
        labelsEnabled: enabled
      };
    },
    async getTenantControls() {
      return {};
    }
  };

  const service = new KillSwitchService({
    store: mutableStore,
    refreshMs: 30_000
  });

  await service.refreshNow();
  const first = await service.getWritebackDecision("tenant-a");
  assert.equal(first.enabled, true);

  enabled = false;
  await service.refreshNow();
  const second = await service.getWritebackDecision("tenant-a");
  assert.equal(second.enabled, false);
  assert.equal(second.reason, "store_global_disabled");
});

test("env-backed store maps global and tenant controls", async () => {
  const store = new EnvKillSwitchStore({
    MAILBOX_GLOBAL_WRITEBACK_ENABLED: "0",
    MAILBOX_GLOBAL_LABELS_ENABLED: "1",
    MAILBOX_TENANT_KILL_WRITEBACK: "tenant-a",
    MAILBOX_TENANT_KILL_LABELS: "tenant-b"
  });

  const global = await store.getGlobalControls();
  const tenantA = await store.getTenantControls("tenant-a");
  const tenantB = await store.getTenantControls("tenant-b");

  assert.equal(global.writebackEnabled, false);
  assert.equal(global.labelsEnabled, true);
  assert.equal(tenantA.writebackEnabled, false);
  assert.equal(tenantB.labelsEnabled, false);
});
