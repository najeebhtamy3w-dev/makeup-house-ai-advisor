package com.makeuphouse.advisor;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(LocalAIPlugin.class);
        registerPlugin(ProductOCRPlugin.class);
        super.onCreate(savedInstanceState);
        android.view.View content=findViewById(android.R.id.content);
        content.setOnApplyWindowInsetsListener((view,insets)->{
            if(android.os.Build.VERSION.SDK_INT>=30){android.graphics.Insets bars=insets.getInsets(android.view.WindowInsets.Type.systemBars()|android.view.WindowInsets.Type.displayCutout());view.setPadding(bars.left,bars.top,bars.right,bars.bottom);return android.view.WindowInsets.CONSUMED;}
            view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets.consumeSystemWindowInsets();
        });
        content.requestApplyInsets();
    }
    @Override public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        if(level>=android.content.ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW)LocalAIPlugin.trimMemory();
    }
}
