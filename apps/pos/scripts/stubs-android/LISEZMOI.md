# Doublures de compilation Android

Ces fichiers ne sont **pas** du code de production et ne partent jamais dans
l'APK. Ce sont des doublures minimales des classes Android et Capacitor
utilisées par `ImprimanteReseau.java` et `MainActivity.java`, qui permettent
de compiler le plugin natif avec un simple `javac`, **sans SDK Android**.

## Pourquoi

Le plugin d'impression est le seul code natif du projet, et c'est celui qu'on
ne peut pas couvrir par les tests TypeScript. Sans ces doublures, la moindre
faute de frappe dans une signature Java ne serait découverte qu'au moment du
`./gradlew assembleDebug`, sur le poste d'un développeur — donc tard, et par
une seule personne.

## Le danger, et comment il est neutralisé

Une doublure ment par construction : si l'API réelle de Capacitor change, la
doublure continuerait de compiler et la vérification deviendrait du théâtre.

C'est pourquoi `verifier-plugin-natif.mjs` **relit les sources réelles** de
Capacitor dans `node_modules/@capacitor/android/` et refuse de valider si une
signature déclarée ici n'y figure plus. Les doublures ne peuvent donc pas
dériver en silence.

## Provenance

`PluginMethod.java`, `annotation/CapacitorPlugin.java` et
`annotation/Permission.java` sont les fichiers **réels** de Capacitor (licence
MIT), copiés tels quels : une annotation recopiée à la main pourrait diverger
sans qu'on s'en aperçoive. Les autres fichiers sont des doublures écrites pour
ce dépôt, réduites aux seuls membres que le plugin appelle.

## Ce que cette vérification ne prouve pas

Elle prouve que le Java est cohérent et que le pont Capacitor trouvera bien
`ImprimanteReseau`. Elle ne remplace ni un vrai build Gradle (ressources,
manifeste fusionné, désucrage, R8) ni un test sur une imprimante réelle.
Voir `docs/tester-mode-avion.md` § 9 et § 10.
