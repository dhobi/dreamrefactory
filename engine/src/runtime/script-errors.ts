/**
 * What the engines say when a script fails.
 *
 * Every error a statement raises is a small number handed back up the chain
 * (interp.ts {@link ScriptError}), and the first one is latched (TI.EXE 0x407220,
 * tl.exe the same code, DF.EXE 0x42f300). TI.EXE and Timelapse's tl.exe then put
 * it in front of the player on the main loop's next pass (TI.EXE 0x406536 ->
 * 0x407260, tl.exe 0x43c296 -> 0x43cfc0):
 *
 *     LoadString(0x44c + 0x3c)          the sentence below, ending in " ["
 *     LoadString(0x44c + code)          what went wrong — the table here
 *     "]"                               (0x45b2b4)
 *     MessageBox(…, MB_YESNO | MB_ICONQUESTION | MB_TASKMODAL)   0x420a57
 *
 * and "No" (0x420a71: anything but IDYES) raises the same quit flag `quit()`
 * does ([0x460b48], 0x4072e5 against quit's 0x4157dc). While an error waits to be
 * shown the loop takes no other event (the `cmp [0x4602cc], 0` in front of every
 * case of 0x406270).
 *
 * DF.EXE has the same strings and never shows them: its pass (0x42eb73 ->
 * 0x42f340) only clears the latch. Dust's errors end their chain in silence.
 *
 * The strings are resources 1100 + code. Six of the seven Titanic trees carry
 * them in English — the German, Dutch, Japanese and Russian builds included —
 * and the French one translates them; the demo's executable has the codes' texts
 * but not the sentence (no 1160).
 */

const EN: ReadonlyMap<number, string> = new Map([
  [0x1, "Bad name."],
  [0x2, "Expected paren '(' or ')'."],
  [0x3, "Expression too complex."],
  [0x4, "No such handler."],
  [0x5, "Commands can't return a value."],
  [0x6, "Functions must return a value."],
  [0x7, "Too many walks."],
  [0x8, "Too many balls."],
  [0x9, "No such variable."],
  [0xa, "No such object."],
  [0xb, "Stage lib open/close error."],
  [0xc, "No such actor read property."],
  [0xd, "No such prop read property."],
  [0xe, "Bad argument type."],
  [0xf, "No such visual effect."],
  [0x10, "Expected equal sign '='."],
  [0x11, "No such stage write property."],
  [0x12, "No such actor write property."],
  [0x13, "No such prop write property."],
  [0x14, "Can't set actor frame."],
  [0x15, "Can't set actor direction."],
  [0x16, "Bad direction name."],
  [0x17, "No such command."],
  [0x18, "Expected end quote '\"'."],
  [0x19, "Expected operator '+', '&', etc."],
  [0x1a, "String length too big."],
  [0x1b, "Expected return '\r'."],
  [0x1c, "Expected comma ','."],
  [0x1d, "Bad 'if' count balance."],
  [0x1e, "Bad 'for' count balance."],
  [0x1f, "Bad 'switch' count balance."],
  [0x20, "Expected 'to'."],
  [0x21, "Expected 'step'."],
  [0x22, "No such star."],
  [0x23, "Too many loops."],
  [0x24, "Expected period '.'."],
  [0x25, "Expected 'endwhile'."],
  [0x26, "Tokenization error."],
  [0x27, "Sound lib open/close error."],
  [0x28, "Scene lib open/close error."],
  [0x29, "Not enough memory error."],
  [0x2a, "Can't find file error."],
  [0x2b, "Resource not found."],
  [0x2c, "Too much recursion."],
  [0x2d, "A puppet is already open."],
  [0x2e, "Puppet bevel full."],
  [0x2f, "Runtime user error."],
  [0x30, "Wrong type of file."],
  [0x31, "File already open."],
  [0x32, "Set lib open/close error."],
  [0x33, "Plug-in returned error."],
  [0x34, "Must use 8.3 filenames."],
  [0x35, "Programmer keyboard abort."],
  [0x36, "String library exhausted."],
  [0x37, "Divide by zero."],
  [0x38, "Must use DF 4.0 files."],
  [0x39, "Bad master width or height."],
  [0x3a, "Network error."],
  [0x3b, "Bad volume name."],
  [0x3c, 'A scripting error has occured.  Choose "Yes" to try ignoring the error, or "No" to quit.  ['],
]);

/** the French tree's TI.EXE (gamefiles/fr/titanic1/install/bin) — it has no 0x34 */
const FR: ReadonlyMap<number, string> = new Map([
  [0x1, "Nom incorrect."],
  [0x2, "Parenthèse manquante '(' or ')'."],
  [0x3, "Expression trop complexe."],
  [0x4, "Descripteur inexistant."],
  [0x5, "Les commandes ne peuvent pas restituer une valeur."],
  [0x6, "Les fonctions doivent restituer une valeur."],
  [0x7, "Trop de cheminements."],
  [0x8, "Trop de commandes."],
  [0x9, "Variable inexistante."],
  [0xa, "Objet inexistant."],
  [0xb, "Erreur d'ouverture/fermeture de scène."],
  [0xc, "Lecture acteur impossible."],
  [0xd, "Lecture prop impossible."],
  [0xe, "Argument incorrect."],
  [0xf, "Effet visuel inexistant."],
  [0x10, "Signe d'égalité manquant '='."],
  [0x11, "Ecriture scène impossible."],
  [0x12, "Ecriture acteur impossible."],
  [0x13, "Ecriture prop impossible."],
  [0x14, "Définition du cadre de l'acteur impossible."],
  [0x15, "Définition de la direction de l'acteur impossible."],
  [0x16, "Nom de direction incorrect."],
  [0x17, "Commande inexistante."],
  [0x18, "Parenthèse de fin manquante '\"'."],
  [0x19, "Opérateur manquant '+', '&', etc."],
  [0x1a, "Chaîne trop longue."],
  [0x1b, "Retour chariot manquant '\r'."],
  [0x1c, "Virgule manquante ','."],
  [0x1d, "Résultat 'if' incorrect."],
  [0x1e, "Résultat 'for' incorrect."],
  [0x1f, "Résultat 'switch' incorrect."],
  [0x20, "Instruction 'to' manquante."],
  [0x21, "Instruction 'step' manquante."],
  [0x22, "Fichier Star inexistant."],
  [0x23, "Trop de boucles."],
  [0x24, "Point manquant '.'."],
  [0x25, "Instruction 'endwhile' manquante."],
  [0x26, "Erreur de token."],
  [0x27, "Erreur d'ouverture/fermeture de bibliothèque sonore."],
  [0x28, "Erreur d'ouverture/fermeture de bibliothèque."],
  [0x29, "Erreur de mémoire."],
  [0x2a, "Erreur de localisation d'un fichier."],
  [0x2b, "Fichier source introuvable."],
  [0x2c, "Trop de récursions."],
  [0x2d, "Fichier Puppet déjà ouvert."],
  [0x2e, "Puppet bevel déjà plein."],
  [0x2f, "Erreur Runtime utilisateur."],
  [0x30, "Type de fichier incorrect."],
  [0x31, "Fichier déjà ouvert."],
  [0x32, "Erreur d'ouverture/fermeture de bibliothèque."],
  [0x33, "Erreur Plug-in détectée."],
  [0x35, "Annulation de programmation du clavier."],
  [0x36, "Erreur de chaîne de bibliothèque."],
  [0x37, "Division par zéro."],
  [0x38, "Noms de fichiers de type DF 4.0 obligatoires."],
  [0x39, "Largeur ou hauteur du master incorrecte."],
  [0x3a, "Erreur de réseau."],
  [0x3b, "Nom de volume incorrect."],
  [0x3c, 'Erreur de script. Cliquez sur "Oui" pour que le programme tente d\'ignorer l\'erreur, ou sur "Non" pour quitter.  ['],
]);

/** the text of error `code` (resource 1100 + code; "" where the build has none, as LoadString gives) */
export function scriptErrorName(code: number, language = "en"): string {
  return (language === "fr" ? FR : EN).get(code) ?? "";
}

/** the whole message box, as 0x407260 assembles it */
export function scriptErrorBoxText(code: number, language = "en"): string {
  return `${scriptErrorName(0x3c, language)}${scriptErrorName(code, language)}]`;
}
