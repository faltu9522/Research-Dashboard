# Methods called from JavaScript
-keepclassmembers class com.sk.rd.MainActivity$Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
-keepclassmembers class com.sk.rd.BrowserActivity$Reporter {
    @android.webkit.JavascriptInterface <methods>;
}
