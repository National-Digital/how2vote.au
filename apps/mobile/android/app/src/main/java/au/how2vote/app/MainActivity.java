package au.how2vote.app;

import com.getcapacitor.BridgeActivity;

// No app-local plugins.
//
// Any plugin added here must ALSO be registered on iOS, which does NOT discover CAPPlugin
// subclasses in the app target: it needs a CAPBridgeViewController subclass calling
// registerPluginInstance from capacitorDidLoad(). Registering on Android only leaves the
// plugin silently inert on iOS.
public class MainActivity extends BridgeActivity {}
