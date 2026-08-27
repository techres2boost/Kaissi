package com.getcapacitor;
import android.os.Bundle;
import androidx.appcompat.app.AppCompatActivity;
import java.util.List;
public class BridgeActivity extends AppCompatActivity {
    @Override protected void onCreate(Bundle savedInstanceState) {}
    public void registerPlugin(Class<? extends Plugin> plugin) {}
    public void registerPlugins(List<Class<? extends Plugin>> plugins) {}
}
