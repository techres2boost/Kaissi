package tn.res2boost.kaissi;

import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Plugin d'impression réseau — socket TCP brut vers le port 9100.
 *
 * Pourquoi ce plugin existe : c'est le SEUL endroit où Capacitor est
 * objectivement plus faible que React Native ou Flutter, et il faut le
 * regarder en face. L'écosystème de plugins pour périphériques POS y est
 * plus pauvre. La mitigation retenue est de normaliser sur les imprimantes
 * RÉSEAU, ce qui réduit le code natif à ce fichier.
 *
 * Pourquoi le réseau plutôt que le Bluetooth : l'imprimante est sur le LAN
 * de l'établissement. Quand Internet tombe — le cas fréquent — le LAN, lui,
 * continue de fonctionner. Le bon de cuisine part quand même.
 *
 * Le travail se fait sur un fil d'exécution séparé : un `connect()` qui
 * expire bloquerait sinon l'interface pendant plusieurs secondes, en plein
 * coup de feu.
 */
@CapacitorPlugin(name = "ImprimanteReseau")
public class ImprimanteReseau extends Plugin {

    /** Délai de connexion. Court : une imprimante du LAN répond en quelques ms. */
    private static final int DELAI_CONNEXION_MS = 4000;

    /** Délai d'écriture, plus large : un long ticket met un peu de temps à sortir. */
    private static final int DELAI_ECRITURE_MS = 8000;

    private final ExecutorService fil = Executors.newSingleThreadExecutor();

    /**
     * Envoie une charge ESC/POS déjà rendue.
     *
     * `charge` est en base64 : le JavaScript ne peut pas passer d'octets
     * bruts au pont Capacitor sans les corrompre.
     */
    @PluginMethod
    public void imprimer(final PluginCall appel) {
        final String hote = appel.getString("hote");
        final int port = appel.getInt("port", 9100);
        final String chargeB64 = appel.getString("charge");

        if (hote == null || hote.trim().isEmpty()) {
            appel.reject("Aucune adresse d'imprimante configurée pour cette station.");
            return;
        }
        if (chargeB64 == null) {
            appel.reject("Charge d'impression absente.");
            return;
        }

        fil.execute(() -> {
            Socket socket = null;
            try {
                final byte[] octets = Base64.decode(chargeB64, Base64.DEFAULT);

                socket = new Socket();
                socket.connect(new InetSocketAddress(hote, port), DELAI_CONNEXION_MS);
                socket.setSoTimeout(DELAI_ECRITURE_MS);
                // Sans TCP_NODELAY, l'algorithme de Nagle retarde les petits
                // envois : un bon de cuisine court peut mettre une demi-seconde
                // de plus à sortir, pour rien.
                socket.setTcpNoDelay(true);

                final OutputStream sortie = socket.getOutputStream();
                sortie.write(octets);
                sortie.flush();

                final JSObject resultat = new JSObject();
                resultat.put("octets", octets.length);
                appel.resolve(resultat);
            } catch (java.net.SocketTimeoutException e) {
                appel.reject("L'imprimante " + hote + ":" + port + " ne répond pas.");
            } catch (java.net.ConnectException e) {
                appel.reject("Connexion refusée par " + hote + ":" + port
                        + ". Vérifiez que l'imprimante est allumée et sur le même réseau.");
            } catch (Exception e) {
                appel.reject("Échec de l'impression sur " + hote + ":" + port
                        + " — " + e.getMessage());
            } finally {
                if (socket != null) {
                    try {
                        socket.close();
                    } catch (Exception ignore) {
                        // La fermeture ne doit jamais masquer l'erreur d'origine.
                    }
                }
            }
        });
    }

    /**
     * Teste la joignabilité d'une imprimante sans rien imprimer.
     * Utilisé par l'écran de configuration : « Tester l'imprimante ».
     */
    @PluginMethod
    public void tester(final PluginCall appel) {
        final String hote = appel.getString("hote");
        final int port = appel.getInt("port", 9100);

        if (hote == null || hote.trim().isEmpty()) {
            appel.reject("Aucune adresse d'imprimante à tester.");
            return;
        }

        fil.execute(() -> {
            Socket socket = null;
            final long debut = System.currentTimeMillis();
            try {
                socket = new Socket();
                socket.connect(new InetSocketAddress(hote, port), DELAI_CONNEXION_MS);
                final JSObject resultat = new JSObject();
                resultat.put("joignable", true);
                resultat.put("dureeMs", System.currentTimeMillis() - debut);
                appel.resolve(resultat);
            } catch (Exception e) {
                final JSObject resultat = new JSObject();
                resultat.put("joignable", false);
                resultat.put("dureeMs", System.currentTimeMillis() - debut);
                resultat.put("erreur", e.getMessage());
                // On RÉSOUT au lieu de rejeter : « injoignable » est une
                // réponse valide à un test, pas une erreur de programmation.
                appel.resolve(resultat);
            } finally {
                if (socket != null) {
                    try {
                        socket.close();
                    } catch (Exception ignore) {
                    }
                }
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        fil.shutdownNow();
        super.handleOnDestroy();
    }
}
