export type KillSwitchGlobalControls = {
  writebackEnabled: boolean;
  labelsEnabled: boolean;
};

export type KillSwitchTenantControls = {
  writebackEnabled?: boolean;
  labelsEnabled?: boolean;
};

export interface KillSwitchStore {
  getGlobalControls(): Promise<KillSwitchGlobalControls>;
  getTenantControls(tenantId: string): Promise<KillSwitchTenantControls>;
}

export type KillSwitchReason =
  | "enabled"
  | "env_global_kill"
  | "env_tenant_kill"
  | "store_global_disabled"
  | "store_tenant_disabled"
  | "store_error_fail_closed";

export type KillSwitchDecision = {
  enabled: boolean;
  reason: KillSwitchReason;
};

type CachedTenantControls = {
  controls: KillSwitchTenantControls;
  fetchedAtMs: number;
  hadError: boolean;
};

type KillSwitchLogger = (input: {
  event: string;
  tenantId?: string;
  control?: "writeback" | "labels";
  reason?: KillSwitchReason;
  refreshMs?: number;
  globalKillWriteback?: boolean;
  globalKillLabels?: boolean;
  tenantKillWritebackCount?: number;
  tenantKillLabelsCount?: number;
  error?: string;
  changed?: boolean;
}) => void;

function parseCsvSet(raw: string | undefined): Set<string> {
  if (!raw) {
    return new Set();
  }
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  );
}

function isTruthy(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function parseEnabled(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (value === "1" || value?.toLowerCase() === "true") {
    return true;
  }
  if (value === "0" || value?.toLowerCase() === "false") {
    return false;
  }
  return fallback;
}

export class EnvKillSwitchStore implements KillSwitchStore {
  private readonly env: NodeJS.ProcessEnv;
  private readonly tenantKillWriteback: Set<string>;
  private readonly tenantKillLabels: Set<string>;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.env = env;
    this.tenantKillWriteback = parseCsvSet(env.MAILBOX_TENANT_KILL_WRITEBACK);
    this.tenantKillLabels = parseCsvSet(env.MAILBOX_TENANT_KILL_LABELS);
  }

  async getGlobalControls(): Promise<KillSwitchGlobalControls> {
    return {
      writebackEnabled: parseEnabled(this.env.MAILBOX_GLOBAL_WRITEBACK_ENABLED, true),
      labelsEnabled: parseEnabled(this.env.MAILBOX_GLOBAL_LABELS_ENABLED, true)
    };
  }

  async getTenantControls(tenantId: string): Promise<KillSwitchTenantControls> {
    const controls: KillSwitchTenantControls = {};
    if (this.tenantKillWriteback.has(tenantId)) {
      controls.writebackEnabled = false;
    }
    if (this.tenantKillLabels.has(tenantId)) {
      controls.labelsEnabled = false;
    }
    return controls;
  }
}

export class KillSwitchService {
  private readonly store: KillSwitchStore;
  private readonly refreshMs: number;
  private readonly logger: KillSwitchLogger;
  private readonly env: NodeJS.ProcessEnv;
  private readonly tenantKillWriteback: Set<string>;
  private readonly tenantKillLabels: Set<string>;
  private globalControls: KillSwitchGlobalControls = {
    writebackEnabled: false,
    labelsEnabled: false
  };
  private globalHadError = true;
  private globalLastFetchedAtMs = 0;
  private timer: NodeJS.Timeout | null = null;
  private readonly tenantCache = new Map<string, CachedTenantControls>();
  private readonly lastLoggedDecision = new Map<string, string>();

  constructor(input: {
    store: KillSwitchStore;
    refreshMs: number;
    logger?: KillSwitchLogger;
    env?: NodeJS.ProcessEnv;
  }) {
    this.store = input.store;
    this.refreshMs = input.refreshMs;
    this.logger = input.logger ?? (() => undefined);
    this.env = input.env ?? process.env;
    this.tenantKillWriteback = parseCsvSet(this.env.MAILBOX_TENANT_KILL_WRITEBACK);
    this.tenantKillLabels = parseCsvSet(this.env.MAILBOX_TENANT_KILL_LABELS);
  }

  start(): void {
    this.logger({
      event: "kill_switch.start",
      refreshMs: this.refreshMs,
      globalKillWriteback: isTruthy(this.env.MAILBOX_KILL_WRITEBACK),
      globalKillLabels: isTruthy(this.env.MAILBOX_KILL_LABELS),
      tenantKillWritebackCount: this.tenantKillWriteback.size,
      tenantKillLabelsCount: this.tenantKillLabels.size
    });

    void this.refreshNow();
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.refreshNow();
    }, this.refreshMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async refreshNow(): Promise<void> {
    try {
      const nextGlobal = await this.store.getGlobalControls();
      const changed =
        this.globalControls.writebackEnabled !== nextGlobal.writebackEnabled ||
        this.globalControls.labelsEnabled !== nextGlobal.labelsEnabled ||
        this.globalHadError;

      this.globalControls = nextGlobal;
      this.globalHadError = false;
      this.globalLastFetchedAtMs = Date.now();
      this.tenantCache.clear();

      this.logger({
        event: "kill_switch.refresh",
        changed,
        refreshMs: this.refreshMs
      });
    } catch (error) {
      this.globalControls = {
        writebackEnabled: false,
        labelsEnabled: false
      };
      this.globalHadError = true;
      this.globalLastFetchedAtMs = Date.now();
      this.tenantCache.clear();
      this.logger({
        event: "kill_switch.refresh.error",
        reason: "store_error_fail_closed",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async getWritebackDecision(tenantId: string): Promise<KillSwitchDecision> {
    return this.getDecision(tenantId, "writeback");
  }

  async getLabelsDecision(tenantId: string): Promise<KillSwitchDecision> {
    return this.getDecision(tenantId, "labels");
  }

  async isWritebackEnabled(tenantId: string): Promise<boolean> {
    return (await this.getWritebackDecision(tenantId)).enabled;
  }

  async isLabelsEnabled(tenantId: string): Promise<boolean> {
    return (await this.getLabelsDecision(tenantId)).enabled;
  }

  private async getDecision(tenantId: string, control: "writeback" | "labels"): Promise<KillSwitchDecision> {
    const envGlobalKill =
      control === "writeback"
        ? isTruthy(this.env.MAILBOX_KILL_WRITEBACK)
        : isTruthy(this.env.MAILBOX_KILL_LABELS);
    if (envGlobalKill) {
      return this.trackDecision(tenantId, control, {
        enabled: false,
        reason: "env_global_kill"
      });
    }

    const envTenantKillSet = control === "writeback" ? this.tenantKillWriteback : this.tenantKillLabels;
    if (envTenantKillSet.has(tenantId)) {
      return this.trackDecision(tenantId, control, {
        enabled: false,
        reason: "env_tenant_kill"
      });
    }

    if (this.globalHadError || this.isGlobalStale()) {
      return this.trackDecision(tenantId, control, {
        enabled: false,
        reason: "store_error_fail_closed"
      });
    }

    const globalEnabled =
      control === "writeback" ? this.globalControls.writebackEnabled : this.globalControls.labelsEnabled;
    if (!globalEnabled) {
      return this.trackDecision(tenantId, control, {
        enabled: false,
        reason: "store_global_disabled"
      });
    }

    const tenantControls = await this.getCachedTenantControls(tenantId);
    if (tenantControls.hadError) {
      return this.trackDecision(tenantId, control, {
        enabled: false,
        reason: "store_error_fail_closed"
      });
    }

    const tenantEnabled =
      control === "writeback" ? tenantControls.controls.writebackEnabled : tenantControls.controls.labelsEnabled;
    if (tenantEnabled === false) {
      return this.trackDecision(tenantId, control, {
        enabled: false,
        reason: "store_tenant_disabled"
      });
    }

    return this.trackDecision(tenantId, control, {
      enabled: true,
      reason: "enabled"
    });
  }

  private isGlobalStale(): boolean {
    return Date.now() - this.globalLastFetchedAtMs > this.refreshMs;
  }

  private async getCachedTenantControls(tenantId: string): Promise<CachedTenantControls> {
    const now = Date.now();
    const cached = this.tenantCache.get(tenantId);

    if (cached && now - cached.fetchedAtMs <= this.refreshMs) {
      return cached;
    }

    try {
      const controls = await this.store.getTenantControls(tenantId);
      const next: CachedTenantControls = {
        controls,
        fetchedAtMs: Date.now(),
        hadError: false
      };
      this.tenantCache.set(tenantId, next);
      return next;
    } catch (error) {
      const next: CachedTenantControls = {
        controls: {},
        fetchedAtMs: Date.now(),
        hadError: true
      };
      this.tenantCache.set(tenantId, next);
      this.logger({
        event: "kill_switch.tenant.error",
        tenantId,
        reason: "store_error_fail_closed",
        error: error instanceof Error ? error.message : String(error)
      });
      return next;
    }
  }

  private trackDecision(
    tenantId: string,
    control: "writeback" | "labels",
    decision: KillSwitchDecision
  ): KillSwitchDecision {
    const key = `${tenantId}:${control}`;
    const token = `${decision.enabled}:${decision.reason}`;
    const previous = this.lastLoggedDecision.get(key);
    if (previous !== token) {
      this.lastLoggedDecision.set(key, token);
      if (!decision.enabled) {
        this.logger({
          event: "kill_switch.blocked",
          tenantId,
          control,
          reason: decision.reason
        });
      }
    }
    return decision;
  }
}
