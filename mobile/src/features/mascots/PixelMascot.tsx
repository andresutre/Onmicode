import { View } from "react-native";

import { BULB, PIXEL_GRID, pixelLayers, type PixelRect } from "./pixelMascots";
import { useFrameToggle } from "./useFrameToggle";

/** What a mascot's agent is doing, as on desktop. */
export type MascotStatus = "idle" | "working" | "needs-you";

function Rects({ rects, unit }: { rects: readonly PixelRect[]; unit: number }) {
  return (
    <>
      {rects.map(({ x, y, w, h, fill }, i) => (
        <View
          key={i}
          style={{
            position: "absolute",
            left: x * unit,
            top: y * unit,
            width: w * unit,
            height: h * unit,
            backgroundColor: fill,
          }}
        />
      ))}
    </>
  );
}

/**
 * Shaded pixel mascot, the native take on the desktop PixelMascot.
 * Drawn with Views from the same rects, so there is no SVG dependency. Swaps
 * frames while working and shows the bulb when it needs you.
 */
export function PixelMascot({
  name,
  color,
  status = "idle",
  size = 22,
}: {
  name: string;
  color: string;
  status?: MascotStatus;
  size?: number;
}) {
  const talking = useFrameToggle(status === "working");
  const layers = pixelLayers(name, color, talking);
  const unit = size / PIXEL_GRID;

  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden>
      <Rects rects={layers.body} unit={unit} />
      <Rects rects={layers.open} unit={unit} />
      {status === "needs-you" ? (
        <View style={{ position: "absolute", left: 12.5 * unit, top: -2.5 * unit }}>
          <Rects rects={BULB} unit={unit} />
        </View>
      ) : null}
    </View>
  );
}
