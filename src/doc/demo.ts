import { Easings } from './easing';
import { SCHEMA_VERSION, type Doc } from './types';

export const DEMO_SCREENSHOT_ASSET = 'demo-screenshot';

/** The Milestone A document: gradient background, a screenshot, and an animated headline. */
export function createDemoDoc(headline = 'Ship visuals that move'): Doc {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'demo',
    name: 'Untitled',
    comp: {
      width: 1920,
      height: 1080,
      duration: 5,
      fps: 30,
      layers: [
        {
          id: 'bg',
          name: 'Background',
          type: 'background',
          visible: true,
          locked: true,
          opacity: { static: 1 },
          angle: { static: 135 },
          stops: [
            { offset: 0, color: [0.35, 0.2, 0.95, 1] },
            { offset: 0.55, color: [0.85, 0.25, 0.65, 1] },
            { offset: 1, color: [1, 0.6, 0.3, 1] },
          ],
        },
        {
          id: 'shot',
          name: 'Screenshot',
          type: 'image',
          visible: true,
          locked: false,
          assetId: DEMO_SCREENSHOT_ASSET,
          width: 1280,
          height: 760,
          radius: 18,
          shadow: { blur: 60, offsetX: 0, offsetY: 30, color: [0.05, 0.02, 0.15, 0.55] },
          opacity: { track: { keys: [{ t: 0, v: 0, out: Easings.easeOutCubic }, { t: 0.8, v: 1, out: Easings.linear }] } },
          transform: {
            x: { static: 960 },
            y: { track: { keys: [{ t: 0, v: 700, out: Easings.easeOutCubic }, { t: 1, v: 640, out: Easings.linear }] } },
            scale: { track: { keys: [{ t: 0, v: 0.94, out: Easings.easeOutCubic }, { t: 1, v: 1, out: Easings.linear }] } },
            rotation: { static: 0 },
          },
        },
        {
          id: 'headline',
          name: 'Headline',
          type: 'text',
          visible: true,
          locked: false,
          text: headline,
          fontId: 'inter',
          fontSize: 96,
          color: [1, 1, 1, 1],
          align: 'center',
          tracking: -0.02,
          opacity: { static: 1 },
          glow: { track: { keys: [{ t: 0.4, v: 0, out: Easings.easeOutCubic }, { t: 1.6, v: 0.8, out: Easings.easeInOutCubic }, { t: 3, v: 0.25, out: Easings.linear }] } },
          glowColor: [1, 0.85, 1, 1],
          transform: { x: { static: 960 }, y: { static: 150 }, scale: { static: 1 }, rotation: { static: 0 } },
          animator: {
            start: 0.3,
            duration: 0.7,
            stagger: 0.04,
            order: 'forward',
            seed: 7,
            easing: Easings.easeOutBack,
            from: { offsetX: 0, offsetY: 60, scale: 0.4, rotation: -12, opacity: 0 },
          },
        },
      ],
    },
  };
}
