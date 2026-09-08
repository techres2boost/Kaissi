// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

/**
 * Les règles qui attrapent CE QUI A DÉJÀ CASSÉ ici.
 *
 * ── Pourquoi une configuration courte plutôt qu'un préréglage complet ─────
 *
 * Un linter qui signale trois cents choses ne signale rien : on le lance une
 * fois, on est submergé, on le désactive. Chaque règle activée ci-dessous
 * correspond à une panne réelle de ce dépôt, ou à une contrainte de son
 * exécution. Le reste — style, longueur de ligne, ordre des imports — est
 * volontairement absent : le formatage n'a jamais cassé une caisse.
 *
 * Les règles typées (`no-floating-promises`) exigent le service de types de
 * TypeScript, donc `projectService`. C'est plus lent, et c'est le prix de la
 * seule catégorie de règles qui trouve de vrais bogues.
 */
export default tseslint.config(
  {
    // Ce qu'on ne lit jamais : sorties de build, dépendances, projets natifs.
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/public-web/**',
      'apps/pos/android/**',
      'apps/pos/ios/**',
      '**/*.d.ts',
      // Configurations de test : hors de tout `tsconfig`, donc hors de portée
      // des règles typées. Les y forcer demanderait un projet TypeScript de
      // plus, pour zéro bogue attrapé.
      '**/vitest.config.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      /*
       * ── La promesse abandonnée ─────────────────────────────────────────
       *
       * PANNE RÉELLE : le bouton « Suspendre » appelait son action serveur
       * sans lire ce qu'elle rendait. Quand elle échouait — et elle échouait,
       * faute d'un privilège de colonne — il ne se passait STRICTEMENT RIEN
       * à l'écran. On presse trois fois, puis on conclut que le logiciel est
       * cassé.
       *
       * C'est la règle la plus rentable de ce fichier.
       */
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      /*
       * ── Le typage ──────────────────────────────────────────────────────
       *
       * `any` désactive le compilateur exactement là où on en a le plus
       * besoin. Il n'y en a qu'UN dans tout le code ; l'avertissement suffit
       * donc à empêcher le second sans bloquer une refonte en cours.
       */
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      // `catch (e) { ... }` sans utiliser `e` est un idiome légitime ici :
      // on veut souvent juste « si ça échoue, tant pis ».
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrors: 'none', varsIgnorePattern: '^_' },
      ],
      // Une union `string | undefined` concaténée dans un gabarit est
      // fréquente et lisible ; la règle produit surtout du bruit.
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',

      /*
       * ── Ce qui est éteint, et pourquoi ─────────────────────────────────
       *
       * Ces règles de `recommendedTypeChecked` produisaient 143 des 186
       * signalements du premier passage, et pas un seul bogue. Un linter qui
       * signale trois cents choses ne signale rien : on le lance une fois, on
       * est submergé, on le désactive — et ce jour-là on perd aussi les
       * règles qui trouvaient quelque chose.
       */
      // Une assertion redondante est du bruit, pas un défaut (84 cas).
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      // Une fonction `async` sans `await` est souvent volontaire : elle se
      // conforme à une interface (24 cas).
      '@typescript-eslint/require-await': 'off',
      // Passer une méthode en référence est un idiome courant ici, et le
      // `this` n'est jamais utilisé dans les cas signalés (3 cas).
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',

      /*
       * ── Signalé, pas bloquant ──────────────────────────────────────────
       *
       * `String(donnees.get(champ))` : un `FormDataEntryValue` peut être un
       * `File`, qui deviendrait la chaîne « [object File] » — en base, en
       * silence. Aucun cas actuel n'est un vrai champ de fichier, mais le
       * jour où un formulaire en gagnera un, ce sera exactement ce défaut-là.
       * En avertissement pour rester visible sans bloquer une correction en
       * cours.
       */
      '@typescript-eslint/no-base-to-string': 'warn',
    },
  },

  /*
   * ── Ce que le « type stripping » de Node interdit — DANS LE SERVICE ──
   *
   * `apps/sync` exécute son TypeScript SANS le compiler :
   * `node --experimental-strip-types` efface les annotations, il ne
   * transforme rien. Une propriété de paramètre (`constructor(private x: T)`),
   * un `enum` ou un `namespace` exigent une transformation — Node refuse
   * alors le fichier, et LE SERVICE NE DÉMARRE PAS.
   *
   * La règle est portée ICI et pas globalement : le POS passe par Vite, le
   * back-office par Next, et tous deux compilent. L'appliquer partout
   * signalait 13 constructions parfaitement valides pour 1 vrai défaut —
   * c'est ainsi qu'on apprend à ignorer un linter.
   *
   * Le dépôt documentait déjà cette contrainte à trois endroits, en
   * commentaire. Elle a quand même été enfreinte en écrivant le limiteur de
   * débit, et c'est un test d'intégration de vingt secondes qui l'a
   * rattrapée. Une règle la refuse maintenant à la frappe.
   */
  {
    files: ['apps/sync/**/*.ts'],
    rules: {
      '@typescript-eslint/parameter-properties': ['error', { prefer: 'class-property' }],
      '@typescript-eslint/no-namespace': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSEnumDeclaration',
          message:
            "`enum` n'est pas effaçable : le « type stripping » de Node le refuse et le " +
            'service ne démarre pas. Utiliser une union de littéraux, ou un objet `as const`.',
        },
      ],
    },
  },

  /*
   * ── React ────────────────────────────────────────────────────────────
   *
   * Les règles des hooks, et rien d'autre. Une dépendance d'effet oubliée
   * produit un écran qui ne se rafraîchit pas — un bogue qu'on attribue au
   * réseau pendant des jours.
   */
  {
    files: ['**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  /*
   * ── Ce qui est livré à un NAVIGATEUR ─────────────────────────────────
   *
   * `console.log` dans le POS ou le back-office finit dans la console d'un
   * client. Un `console.error` reste légitime : il sert au support quand un
   * gérant ouvre les outils de développement à notre demande.
   */
  {
    files: ['apps/pos/src/**/*.ts', 'apps/pos/src/**/*.tsx', 'apps/backoffice/src/**/*.ts', 'apps/backoffice/src/**/*.tsx'],
    rules: {
      'no-console': ['warn', { allow: ['error', 'warn'] }],
    },
  },

  /*
   * ── Tests et scripts ─────────────────────────────────────────────────
   *
   * Un test a le droit d'être direct : `!` sur une valeur qu'on vient
   * d'insérer, une assertion de type pour fabriquer un cas limite. Lui
   * imposer les règles du code de production le rendrait moins lisible, donc
   * moins utile.
   */
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/test/**', '**/tests/**', '**/scripts/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      'no-console': 'off',
      /*
       * La contrainte du « type stripping » ne concerne PAS les tests, même
       * ceux de `apps/sync` : vitest compile ce qu'il exécute. L'y appliquer
       * signalerait une construction qui ne peut pas casser la production.
       */
      '@typescript-eslint/parameter-properties': 'off',
    },
  },

  /*
   * Les fichiers `.mjs` et `.js` du dépôt — scripts de build, configuration —
   * ne sont pas dans un projet TypeScript : les règles typées ne peuvent pas
   * s'y appliquer.
   */
  {
    files: ['**/*.mjs', '**/*.js', '**/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
    rules: { ...tseslint.configs.disableTypeChecked.rules, 'no-undef': 'off' },
  },
)
