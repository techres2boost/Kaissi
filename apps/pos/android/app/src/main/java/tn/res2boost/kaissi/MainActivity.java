package tn.res2boost.kaissi;

import com.getcapacitor.BridgeActivity;

/**
 * Activité principale du terminal Kaissi.
 *
 * Le bundle web est EMPAQUETÉ dans l'APK (assets/public) : aucune URL
 * distante n'est chargée, l'application s'ouvre en mode avion.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        // Plugin local d'impression réseau (TCP 9100), déclaré avant que le
        // pont ne démarre, sinon le JavaScript ne le trouverait pas.
        registerPlugin(ImprimanteReseau.class);
        super.onCreate(savedInstanceState);
    }
}
