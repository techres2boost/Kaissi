-- ═══════════════════════════════════════════════════════════════════════════
-- Kaissi — 0008 · Durcissement : search_path figé sur toutes les fonctions
-- ═══════════════════════════════════════════════════════════════════════════
-- Une fonction sans `search_path` figé peut être détournée : un appelant
-- crée un schéma dans son propre chemin de recherche et y place une fonction
-- homonyme. Le linter Supabase le signale à juste titre. On fige tout.
-- ═══════════════════════════════════════════════════════════════════════════

alter function kaissi.uuid_v7()               set search_path = '';
alter function kaissi.serialise_audit(text, uuid, uuid, uuid, uuid, uuid, text, text, uuid, text)
                                              set search_path = '';
alter function kaissi.protege_referentiel(text)     set search_path = '';
alter function kaissi.protege_transactionnel(text)  set search_path = '';

-- `uuid_v7` appelle gen_random_bytes : la référence doit être qualifiée.
create or replace function kaissi.uuid_v7()
returns uuid
language plpgsql
volatile
parallel safe
set search_path = ''
as $$
declare
  ms        bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  aleatoire bytea  := extensions.gen_random_bytes(10);
  octets    bytea;
begin
  octets := set_byte(set_byte(set_byte(set_byte(set_byte(set_byte(
              '\x000000000000'::bytea,
              0, ((ms >> 40) & 255)::int),
              1, ((ms >> 32) & 255)::int),
              2, ((ms >> 24) & 255)::int),
              3, ((ms >> 16) & 255)::int),
              4, ((ms >>  8) & 255)::int),
              5, ( ms        & 255)::int);
  octets := octets || aleatoire;
  octets := set_byte(octets, 6, (get_byte(octets, 6) & 15) | 112);
  octets := set_byte(octets, 8, (get_byte(octets, 8) & 63) | 128);
  return encode(octets, 'hex')::uuid;
end;
$$;

-- Les générateurs de politiques ne doivent JAMAIS être appelables par un
-- rôle applicatif : ce sont des outils de migration.
revoke execute on function kaissi.protege_referentiel(text) from public;
revoke execute on function kaissi.protege_transactionnel(text) from public;
revoke execute on function kaissi.journalise_changement() from public;
revoke execute on function kaissi.chaine_audit() from public;
revoke execute on function kaissi.interdit_modification() from public;
revoke execute on function kaissi.touche_updated_at() from public;
