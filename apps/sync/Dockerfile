# ═══════════════════════════════════════════════════════════════════════════
# API de synchronisation Kaissi
# ═══════════════════════════════════════════════════════════════════════════
# Construite depuis la RACINE du monorepo :
#   docker build -f apps/sync/Dockerfile -t kaissi-sync .
#
# Le contexte de build est donc la racine, et c'est pour cela que le
# `railway.json` qui désigne ce fichier vit lui aussi à la racine : Railway
# n'y cherche sa configuration nulle part ailleurs.
#
# Les paquets sont consommés en source TypeScript ; Node 22 les exécute
# directement via `--experimental-strip-types`. Pas d'étape de compilation,
# donc pas de risque que le binaire déployé diverge du code relu.
# ═══════════════════════════════════════════════════════════════════════════

FROM node:22-alpine

RUN corepack enable

WORKDIR /app

# Les manifestes d'abord : cette couche ne change qu'en cas de nouvelle
# dépendance, et l'installation reste en cache le reste du temps.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/sync/package.json ./apps/sync/
COPY packages/domain/package.json ./packages/domain/

RUN pnpm install --frozen-lockfile --filter @kaissi/sync... --prod=false

COPY packages/domain ./packages/domain
COPY apps/sync ./apps/sync

ENV NODE_ENV=production
EXPOSE 8787

# SYNC_PORT n'est volontairement PAS figé ici.
#
# Railway, Render et Fly injectent `PORT` et routent le domaine public
# dessus. Une valeur codée dans l'image l'emporterait sur la leur : le
# service écouterait 8787 pendant que la plateforme enverrait le trafic
# ailleurs. Résultat, un conteneur dont les journaux sont verts derrière un
# domaine qui répond 404 — le symptôme le plus difficile à diagnostiquer.
#
# Le code retient, dans l'ordre : SYNC_PORT, puis PORT, puis 8787.

# Sonde de santé : l'hébergeur redémarre le conteneur si elle échoue.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.SYNC_PORT||process.env.PORT||8787)+'/sante').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Jamais root : une faille dans une dépendance ne doit pas donner le conteneur.
USER node

# Le hook « charger-ts.mjs » fait pointer les imports « .js » vers les
# fichiers « .ts » (convention ESM du dépôt), ce que Node ne fait pas seul.
CMD ["node", "--experimental-strip-types", "--import", "./apps/sync/scripts/charger-ts.mjs", "apps/sync/src/index.ts"]
