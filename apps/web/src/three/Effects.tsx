import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useUi } from "../store/ui.js";

/**
 * Post-processing: a soft bloom on the brightest highlights (legal-spot rings,
 * the sun on a white piece) and a vignette that draws the eye to the island.
 *
 * Both are optional polish. They switch off when the player turns effects off,
 * and automatically when the frame rate cannot hold (the renderer's
 * PerformanceMonitor sets `lowPower`). `?fx=1` forces them on, for screenshots
 * taken on a software renderer.
 *
 * The composer renders into its own buffers, where three does not tone-map, so
 * the ACES curve the plain renderer applies is re-applied here as the last pass.
 */
export function Effects(): React.JSX.Element | null {
  const effects = useUi((s) => s.effects);
  const lowPower = useUi((s) => s.lowPower);
  const forced =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("fx") === "1";

  if (!forced && (effects === "off" || lowPower)) return null;

  return (
    <EffectComposer multisampling={4}>
      <Bloom intensity={0.32} luminanceThreshold={0.86} luminanceSmoothing={0.18} mipmapBlur />
      <Vignette offset={0.28} darkness={0.62} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}
