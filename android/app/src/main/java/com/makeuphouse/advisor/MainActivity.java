package com.makeuphouse.advisor;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(LocalAIPlugin.class);
        super.onCreate(savedInstanceState);
    }
    @Override public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        if(level>=android.content.ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW)LocalAIPlugin.trimMemory();
    }
}
