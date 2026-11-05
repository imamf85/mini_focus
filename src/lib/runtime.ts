import { loadAppConfig, loadGoogleEnv, loadSessionSecret } from "./config";
import { createGoogleClient } from "./sheets/google";
import { Store } from "./store";
import { Dispatch } from "./service";
import { LoginThrottle } from "./throttle";

interface Runtime {
  dispatch: Dispatch;
  throttle: LoginThrottle;
}

const g = globalThis as unknown as { __miniFocus?: Runtime };

/** Singleton per instance (bertahan antar request, dan antar HMR di dev). */
export function getRuntime(): Runtime {
  if (!g.__miniFocus) {
    const config = loadAppConfig();
    const env = loadGoogleEnv();
    const client = createGoogleClient({
      email: env.email,
      privateKey: env.privateKey,
      spreadsheetId: env.spreadsheetId,
    });
    g.__miniFocus = { dispatch: new Dispatch(new Store(client, config), config), throttle: new LoginThrottle() };
  }
  return g.__miniFocus;
}

export const getSessionSecret = () => loadSessionSecret();
