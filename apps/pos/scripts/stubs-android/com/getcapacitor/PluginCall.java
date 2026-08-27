package com.getcapacitor;
public class PluginCall {
    public void resolve(JSObject data) {}
    public void resolve() {}
    public void reject(String msg) {}
    public void reject(String msg, String code) {}
    public void reject(String msg, Exception ex) {}
    public String getString(String name) { return null; }
    public String getString(String name, String defaultValue) { return defaultValue; }
    public Integer getInt(String name) { return null; }
    public Integer getInt(String name, Integer defaultValue) { return defaultValue; }
}
