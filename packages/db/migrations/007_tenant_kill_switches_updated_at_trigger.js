exports.up = (pgm) => {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION set_tenant_kill_switches_updated_at()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$;
  `);

  pgm.sql("DROP TRIGGER IF EXISTS tenant_kill_switches_set_updated_at ON tenant_kill_switches;");
  pgm.sql(`
    CREATE TRIGGER tenant_kill_switches_set_updated_at
    BEFORE UPDATE ON tenant_kill_switches
    FOR EACH ROW
    EXECUTE FUNCTION set_tenant_kill_switches_updated_at();
  `);
};

exports.down = (pgm) => {
  pgm.sql("DROP TRIGGER IF EXISTS tenant_kill_switches_set_updated_at ON tenant_kill_switches;");
  pgm.sql("DROP FUNCTION IF EXISTS set_tenant_kill_switches_updated_at();");
};
