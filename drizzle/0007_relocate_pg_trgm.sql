-- Supabase advisor 0014 (extension_in_public): keep pg_trgm out of the
-- API-exposed public schema. Relocation is safe — existing trigram indexes
-- reference the operator class by identity, not by schema path.

create schema if not exists extensions;
alter extension pg_trgm set schema extensions;
