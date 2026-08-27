package org.json;
public class JSONObject {
    public JSONObject() {}
    public Object opt(String name) { return null; }
    public JSONObject put(String key, boolean value) throws JSONException { return this; }
    public JSONObject put(String key, int value) throws JSONException { return this; }
    public JSONObject put(String key, long value) throws JSONException { return this; }
    public JSONObject put(String key, double value) throws JSONException { return this; }
    public JSONObject put(String key, Object value) throws JSONException { return this; }
}
