import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS only reads apple-touch-icon for "Add to Home Screen" (never the
// regular favicon in app/icon.jpg), so without this file iOS falls back to
// its own generic letter-tile placeholder.
//
// public/logo.jpeg is a 1424x752 landscape file: the horse/arrow emblem sits
// in a roughly-square region near the top-center, with "DOUBLE K RANCH" and
// Hebrew text below it and wide blank margins left/right. Satori (the engine
// behind ImageResponse) doesn't honor object-fit/object-position as a real
// browser would - it renders the whole image letterboxed instead of
// cropping - so the crop below is done manually: render the source at a
// scale where a known 400x400px source region (empirically chosen to
// exactly frame the emblem, verified by visual inspection) lines up with the
// icon's origin, clipped by the container's overflow:hidden.
const SOURCE_WIDTH = 1424;
const SOURCE_HEIGHT = 752;
const CROP_LEFT = 512;
const CROP_TOP = 0;
const CROP_SIDE = 400;
const SCALE = size.width / CROP_SIDE;

export default function AppleIcon() {
  const logo = readFileSync(join(process.cwd(), "public", "logo.jpeg")).toString("base64");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          overflow: "hidden",
          position: "relative",
          background: "#ffffff",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse (Satori) only supports plain <img>, not next/image */}
        <img
          src={`data:image/jpeg;base64,${logo}`}
          width={SOURCE_WIDTH * SCALE}
          height={SOURCE_HEIGHT * SCALE}
          alt=""
          style={{
            position: "absolute",
            left: -CROP_LEFT * SCALE,
            top: -CROP_TOP * SCALE,
          }}
        />
      </div>
    ),
    { ...size }
  );
}
