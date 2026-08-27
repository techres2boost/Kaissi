package com.getcapacitor;
import org.json.JSONObject;
import org.json.JSONException;
public class JSObject extends JSONObject {
    @Override public JSObject put(String key, boolean value) { return this; }
    @Override public JSObject put(String key, int value) { return this; }
    @Override public JSObject put(String key, long value) { return this; }
    @Override public JSObject put(String key, double value) { return this; }
    @Override public JSObject put(String key, Object value) { return this; }
    public JSObject put(String key, String value) { return this; }
    public JSObject putSafe(String key, Object value) throws JSONException { return this; }
}
