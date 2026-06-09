# Deco Planner

In-browser scuba decompression planning using **Buhlmann ZHL-B with Gradient Factors** and **VPM-B**. No install, no backend.

Live at **<https://deco-planner.archisgore.com/>** (also runs as a static page — clone the repo and open `index.html` directly).

## What it does

- Multi-gas, multi-level dive planning with Buhlmann or VPM-B
- Configurable gradient factors, deco ppO₂, max END
- Generates a full deco schedule with stops, gas switches, and running time

## Stack

- **Engine**: a browserified build of [nyxtom/dive](https://github.com/nyxtom/dive) — pure JavaScript implementation of Buhlmann GF + VPM-B
- **UI**: vanilla JavaScript + Tailwind CSS via the Play CDN. No framework, no build step
- **Hosting**: GitHub Pages with a custom domain (see `CNAME`)

## Files

```
index.html                       # the page
src/deco-planner.js              # vanilla-JS UI controller
src/scuba-dive.browserified.js   # the deco engine (browser bundle)
src/scuba-dive.js                # the deco engine (Node module source)
CNAME                            # GitHub Pages custom domain
```

## Disclaimer

This is decompression *modeling*, not dive planning. Cross-check every plan against your trusted desktop planner or printed tables. Never deviate from your training. The math, the inputs, or both can be wrong.

## Credits

- [nyxtom/dive](https://github.com/nyxtom/dive) — the Buhlmann + VPM-B engine
- Erik Baker — for the original VPM-B reference implementation
- Buhlmann, Workman — for the underlying physiology
