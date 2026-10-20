import { lazySurface } from "../../../shared/ui/lazySurface";

/** Loads on first open, so the welcome stays out of the startup graph. */
export const WelcomeDialog = lazySurface(async () => {
  const module = await import("./WelcomeDialog");
  return { default: module.WelcomeDialog };
});
