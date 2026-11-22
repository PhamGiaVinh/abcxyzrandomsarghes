// Bake the table's orthographic view once. The browser paints seats, chips and
// cards independently so that all of their labels and hit targets remain crisp.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const directory = new URL('../../src/assets/tracker-table/', import.meta.url);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM_CHANNEL
  ? { channel: process.env.CHROMIUM_CHANNEL }
  : {});
try {
  const page = await browser.newPage();
  for (const [name, width, height] of [['landscape', 1280, 674], ['portrait', 720, 1152]]) {
    const image = await page.evaluate(({ width, height }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      const frame = ctx.createImageData(width, height);
      const mask = ctx.createImageData(width, height);
      // Concentric elliptical cross-sections of the pedestal, leather rail,
      // brass piping and sunken speed cloth. Height moves the ellipse along
      // the projected vertical axis; the lower lip is visible in the foreground.
      const profile = [
        { radius: .977, elevation: -.033, material: 'foot' },
        { radius: .985, elevation: -.011, material: 'apron' },
        { radius: .980, elevation: .012, material: 'brass' },
        { radius: .974, elevation: .018, material: 'edge' },
        { radius: .968, elevation: .022, material: 'padding' },
        { radius: .922, elevation: .022, material: 'brass' },
        { radius: .914, elevation: .018, material: 'bevel' },
        { radius: .902, elevation: .004, material: 'cloth' },
      ];
      let seed = 61513;
      const nextGrain = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 0x100000000 - .5;
      };
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const u = (x + .5) / width * 2 - 1;
          const v = (y + .5) / height * 2 - 1;
          let ring;
          let distance;
          for (const section of profile) {
            // A mildly squared ellipse seats nine without pinching the corners.
            const r = (Math.abs(u) ** 2.55 + Math.abs(v + section.elevation) ** 2.55) ** (1 / 2.55);
            if (r <= section.radius) { ring = section; distance = r; }
          }
          if (!ring) continue;
          const noise = nextGrain();
          const light = .70 - .23 * u - .24 * v;
          let color;
          let alpha = 255;
          switch (ring.material) {
            case 'cloth': {
              // Transparent neutral texture keeps the club's chosen cloth hue.
              const weave = (((x + y) % 3) - 1) * 1.6;
              const innerLine = Math.abs(distance - .853) < 1.25 / Math.min(width, height);
              const shading = 18 - 10 * v - 42 * (distance / .902) ** 3 + noise * 15 + weave;
              const tone = innerLine ? 230 : Math.max(0, 60 + shading * 1.9);
              color = [tone, tone, tone];
              alpha = innerLine ? 60 : 28;
              break;
            }
            case 'brass':
              color = [183 * light, 145 * light, 90 * light];
              alpha = 188;
              break;
            case 'padding': {
              const t = Math.min(1, Math.max(0, (ring.radius - distance) / .046));
              const angle = Math.atan2(v, u);
              // Directional grain follows the rounded rail. Small brass sights
              // are baked into the wood and never cover a bet or touch target.
              const grain = 3 * Math.sin(2500 * distance + 3 * Math.sin(angle * 17)) + noise * 9;
              const crown = Math.sin(Math.PI * t);
              const wood = 65 + 55 * light + 48 * crown + grain;
              const sight = Math.abs(t - .48) * 7 +
                Math.abs(Math.sin(angle * 15 + Math.PI / 2)) * 20 < 1;
              color = sight ? [229, 202, 139] : [wood * 1.15, wood * .83, wood * .64];
              alpha = 222;
              break;
            }
            case 'apron': color = [56 * light, 33 * light, 25 * light]; break;
            case 'edge': color = [151 * light, 110 * light, 78 * light]; break;
            case 'bevel': color = [57 * light, 40 * light, 27 * light]; break;
            default: color = [11, 15, 14];
          }
          const offset = (y * width + x) * 4;
          frame.data.set([...color, alpha], offset);
          const maskValue = ring.material === 'cloth' ? 255 : 0;
          mask.data.set([maskValue, maskValue, maskValue, 255], offset);
        }
      }
      ctx.putImageData(frame, 0, 0);
      const surface = canvas.toDataURL('image/webp', .76).split(',')[1];
      ctx.putImageData(mask, 0, 0);
      return { surface, materialMask: canvas.toDataURL('image/webp', .95).split(',')[1] };
    }, { width, height });
    await writeFile(fileURLToPath(new URL(name + '.webp', directory)), Buffer.from(image.surface, 'base64'));
    await writeFile(fileURLToPath(new URL(name + '-mask.webp', directory)), Buffer.from(image.materialMask, 'base64'));
  }
} finally {
  await browser.close();
}
