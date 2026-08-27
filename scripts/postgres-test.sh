#!/usr/bin/env bash
#
# Prépare un PostgreSQL jetable pour les tests de synchronisation.
#
# Pourquoi un VRAI PostgreSQL : ces tests vérifient RLS, les contraintes et
# l'idempotence — c'est-à-dire ce que fait la BASE, pas ce que fait notre
# code. Une base simulée validerait notre idée du SQL, pas le SQL.
#
# Le schéma appliqué est celui de PRODUCTION, sans une ligne de différence :
# amorce-supabase.sql se contente d'ajouter les rôles et le schéma « auth »
# que Supabase fournit et qu'un PostgreSQL nu n'a pas.
#
#   pnpm db:test        démarre et applique le schéma
#   pnpm db:test:stop   supprime tout
#
# Toujours lancé par « bash » via package.json : PowerShell ne sait pas
# exécuter un .sh, et répondait « './scripts/...' is not recognized ».
#
set -euo pipefail

PORT=5433
CONTENEUR=kaissi-pg-test
RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DONNEES=/tmp/kaissi-pg-test

# Sur Debian/Ubuntu, initdb et pg_ctl ne sont PAS dans le PATH : ils vivent
# dans /usr/lib/postgresql/<version>/bin. Chercher « initdb » sans le savoir
# fait conclure à tort que PostgreSQL n'est pas installé.
for repertoire in /usr/lib/postgresql/*/bin /usr/pgsql-*/bin \
                  /opt/homebrew/opt/postgresql@*/bin /usr/local/opt/postgresql@*/bin; do
  [ -x "$repertoire/initdb" ] && PATH="$PATH:$repertoire"
done
export PATH

arreter() {
  if command -v docker > /dev/null 2>&1 && docker ps -aq -f "name=^${CONTENEUR}$" 2>/dev/null | grep -q .; then
    docker rm -f "$CONTENEUR" > /dev/null
    echo "Conteneur $CONTENEUR supprimé."
  fi
  if [ -d "$DONNEES" ]; then
    pg_ctl -D "$DONNEES" stop > /dev/null 2>&1 || true
    rm -rf "$DONNEES"
    echo "Cluster local $DONNEES supprimé."
  fi
}

if [ "${1:-}" = "--stop" ]; then
  arreter
  exit 0
fi

# ── Démarrage : Docker si disponible, sinon cluster local ───────────────────
if command -v docker > /dev/null 2>&1 && docker info > /dev/null 2>&1; then
  echo "→ PostgreSQL 16 dans Docker, port $PORT"
  docker rm -f "$CONTENEUR" > /dev/null 2>&1 || true
  docker run -d --name "$CONTENEUR" \
    -e POSTGRES_HOST_AUTH_METHOD=trust \
    -p "127.0.0.1:$PORT:5432" \
    postgres:16-alpine > /dev/null
elif command -v initdb > /dev/null 2>&1; then
  if [ "$(id -u)" = 0 ]; then
    echo "✗ PostgreSQL refuse de démarrer en root, et c'est délibéré."
    echo "  Relance ce script depuis un compte utilisateur normal,"
    echo "  ou démarre Docker (chemin préféré, aucun droit requis)."
    exit 1
  fi
  echo "→ Cluster PostgreSQL local, port $PORT"
  arreter
  initdb -D "$DONNEES" -U postgres --auth=trust > /dev/null
  pg_ctl -D "$DONNEES" -o "-p $PORT -c listen_addresses=127.0.0.1" \
    -l /tmp/kaissi-pg.log start > /dev/null
else
  echo "✗ Ni Docker (démon actif) ni initdb sur cette machine."
  echo "  Installe Docker Desktop, ou PostgreSQL 16 :"
  echo "    macOS         brew install postgresql@16"
  echo "    Debian/Ubuntu sudo apt install postgresql-16"
  exit 1
fi

# Un « docker run » rend la main AVANT que Postgres n'accepte les connexions :
# enchaîner tout de suite sur psql échouerait une fois sur deux.
echo -n "→ attente de PostgreSQL"
pret=non
for _ in $(seq 1 60); do
  if psql -h 127.0.0.1 -p "$PORT" -U postgres -c 'select 1' > /dev/null 2>&1; then
    pret=oui
    echo " — prêt."
    break
  fi
  echo -n "."
  sleep 1
done
if [ "$pret" = non ]; then
  echo
  echo "✗ PostgreSQL n'a pas répondu en 60 s. Journal : /tmp/kaissi-pg.log"
  exit 1
fi

export PGHOST=127.0.0.1 PGPORT="$PORT" PGUSER=postgres

echo "→ amorce Supabase (rôles + schéma auth)"
psql -q -v ON_ERROR_STOP=1 -f "$RACINE/apps/sync/test/amorce-supabase.sql"

echo "→ migrations de production"
for fichier in "$RACINE"/supabase/migrations/*.sql; do
  printf '   %s\n' "$(basename "$fichier")"
  psql -q -v ON_ERROR_STOP=1 -f "$fichier"
done

# Joindre pg_class sur le SEUL nom de table croiserait kaissi.tables avec
# information_schema.tables et kaissi.users avec auth.users : le compte des
# tables sans RLS serait faux. Le schéma doit faire partie de la jointure.
lire() { psql -tAc "$1" | tr -d '[:space:]'; }
tables=$(lire "select count(*) from pg_class c
                 join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'kaissi' and c.relkind = 'r'")
sansrls=$(lire "select count(*) from pg_class c
                  join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'kaissi' and c.relkind = 'r'
                   and not c.relrowsecurity")

echo
if [ "$sansrls" != 0 ]; then
  echo "✗ $sansrls table(s) du schéma kaissi sans RLS — le schéma est incomplet."
  exit 1
fi
echo "✓ PostgreSQL prêt sur 127.0.0.1:$PORT — $tables tables, toutes sous RLS"
echo
echo "  pnpm --filter @kaissi/sync test   # tests d'intégration + banc à trois appareils"
echo "  pnpm db:test:stop                 # pour tout supprimer"
