/**
 * Lecture minimale d'un fichier `.class` : les annotations conservées à
 * l'exécution, et sur quel membre elles portent.
 *
 * Pourquoi ne pas simplement appeler `javap` : parce qu'il n'est pas toujours
 * là. Certaines installations Windows n'exposent que `javac`, et le script
 * plantait alors sur un « spawnSync javap ENOENT » qui ne dit rien de ce
 * qu'il fallait faire.
 *
 * Un premier repli cherchait les chaînes attendues dans le fichier brut. Il
 * était FAUX : « ImprimanteReseau » figure de toute façon dans le nom de la
 * classe, si bien qu'une annotation renommée passait le contrôle. Un
 * vérificateur qui affiche ✓ sur un bug est pire que pas de vérificateur.
 *
 * On lit donc réellement le format, qui est simple et figé depuis vingt ans.
 * Référence : JVMS §4, « The class File Format ».
 */

/** Curseur de lecture gros-boutiste sur le tampon de la classe. */
class Lecteur {
  constructor(octets) {
    this.vue = new DataView(octets.buffer, octets.byteOffset, octets.byteLength)
    this.position = 0
  }
  u1() {
    return this.vue.getUint8(this.position++)
  }
  u2() {
    const v = this.vue.getUint16(this.position)
    this.position += 2
    return v
  }
  u4() {
    const v = this.vue.getUint32(this.position)
    this.position += 4
    return v
  }
  octets(n) {
    const v = new Uint8Array(this.vue.buffer, this.vue.byteOffset + this.position, n)
    this.position += n
    return v
  }
}

/** Tailles fixes des entrées du réservoir de constantes, par étiquette. */
const TAILLES = {
  3: 4, // Integer
  4: 4, // Float
  5: 8, // Long   — occupe DEUX emplacements
  6: 8, // Double — occupe DEUX emplacements
  7: 2, // Class
  8: 2, // String
  9: 4, // Fieldref
  10: 4, // Methodref
  11: 4, // InterfaceMethodref
  12: 4, // NameAndType
  15: 3, // MethodHandle
  16: 2, // MethodType
  17: 4, // Dynamic
  18: 4, // InvokeDynamic
  19: 2, // Module
  20: 2, // Package
}

function lireReservoir(lecteur) {
  const nombre = lecteur.u2()
  const constantes = new Array(nombre)
  // Le réservoir est indexé à partir de 1 ; l'entrée 0 n'existe pas.
  for (let i = 1; i < nombre; i += 1) {
    const etiquette = lecteur.u1()
    if (etiquette === 1) {
      const longueur = lecteur.u2()
      constantes[i] = new TextDecoder('utf-8').decode(lecteur.octets(longueur))
      continue
    }
    if (etiquette === 7) {
      // Class : ne porte qu'un index vers l'UTF-8 du nom. On le résout après
      // coup, quand tout le réservoir est lu — il peut pointer vers l'avant.
      constantes[i] = { indexNom: lecteur.u2() }
      continue
    }
    const taille = TAILLES[etiquette]
    if (taille === undefined) throw new Error(`Étiquette de constante inconnue : ${etiquette}`)
    lecteur.position += taille
    // Un Long ou un Double consomme deux emplacements. Une bizarrerie de la
    // JVM, mais l'ignorer décale TOUT le reste du réservoir.
    if (etiquette === 5 || etiquette === 6) i += 1
  }
  return constantes
}

/** Résout un index Class vers le nom de classe, « tn/res2boost/… ». */
function nomDeClasse(constantes, index) {
  const entree = constantes[index]
  return entree && typeof entree === 'object' ? (constantes[entree.indexNom] ?? null) : null
}

/** Saute une valeur d'élément d'annotation, et rend sa valeur si c'est une chaîne. */
function lireValeur(lecteur, constantes) {
  const tag = String.fromCharCode(lecteur.u1())
  if (tag === 's') return constantes[lecteur.u2()]
  if ('BCDFIJSZ'.includes(tag) || tag === 'c') {
    lecteur.position += 2
    return null
  }
  if (tag === 'e') {
    lecteur.position += 4
    return null
  }
  if (tag === '@') {
    lireAnnotation(lecteur, constantes)
    return null
  }
  if (tag === '[') {
    const n = lecteur.u2()
    for (let i = 0; i < n; i += 1) lireValeur(lecteur, constantes)
    return null
  }
  throw new Error(`Type de valeur d'annotation inconnu : « ${tag} »`)
}

function lireAnnotation(lecteur, constantes) {
  const type = constantes[lecteur.u2()]
  const nombrePaires = lecteur.u2()
  const elements = {}
  for (let i = 0; i < nombrePaires; i += 1) {
    const nom = constantes[lecteur.u2()]
    elements[nom] = lireValeur(lecteur, constantes)
  }
  return { type, elements }
}

function lireAttributs(lecteur, constantes) {
  const nombre = lecteur.u2()
  const annotations = []
  for (let i = 0; i < nombre; i += 1) {
    const nom = constantes[lecteur.u2()]
    const longueur = lecteur.u4()
    const fin = lecteur.position + longueur
    // Seules les annotations VISIBLES à l'exécution nous intéressent :
    // c'est exactement ce que Capacitor lit par réflexion.
    if (nom === 'RuntimeVisibleAnnotations') {
      const nombreAnnotations = lecteur.u2()
      for (let a = 0; a < nombreAnnotations; a += 1) {
        annotations.push(lireAnnotation(lecteur, constantes))
      }
    }
    lecteur.position = fin
  }
  return annotations
}

function lireMembres(lecteur, constantes) {
  const nombre = lecteur.u2()
  const membres = []
  for (let i = 0; i < nombre; i += 1) {
    lecteur.u2() // access_flags
    const nom = constantes[lecteur.u2()]
    const descripteur = constantes[lecteur.u2()]
    membres.push({ nom, descripteur, annotations: lireAttributs(lecteur, constantes) })
  }
  return membres
}

/**
 * Analyse un `.class` et rend ce que la JVM y verra à l'exécution.
 *
 * @param {Uint8Array} octets
 * @returns {{ nom: string, annotations: object[], champs: object[], methodes: object[] }}
 */
export function lireClasse(octets) {
  const lecteur = new Lecteur(octets)
  if (lecteur.u4() !== 0xcafebabe) throw new Error("Ce fichier n'est pas une classe Java.")
  lecteur.u2() // minor
  lecteur.u2() // major
  const constantes = lireReservoir(lecteur)

  lecteur.u2() // access_flags
  const indexClasse = lecteur.u2()
  lecteur.u2() // super_class
  const nombreInterfaces = lecteur.u2()
  lecteur.position += nombreInterfaces * 2

  const champs = lireMembres(lecteur, constantes)
  const methodes = lireMembres(lecteur, constantes)
  const annotations = lireAttributs(lecteur, constantes)

  return { nom: nomDeClasse(constantes, indexClasse), annotations, champs, methodes }
}
