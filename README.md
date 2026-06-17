# Navigating Small Island Research Realities

Static GitHub Pages decision navigator for planning research under small island constraints. The public interface reads `flowgraph.dot` at runtime and presents the graph as a compact yes/no path.

Version: `0.1.0`.

## Repository Structure

- `index.html`: root-served public page for GitHub Pages.
- `styles.css`: responsive visual system using SISSTEM identity assets.
- `app.js`: DOT parsing, navigation state, history, and path summary.
- `flowgraph.dot`: canonical decision-flow source.
- `scripts/validate-graph.mjs`: graph integrity validation.
- `assets/`: public abstract hero asset.
- `sisstem-logo.svg`: public SISSTEM mark.

## Local Verification

```sh
npm run check
```

Runtime DOT loading requires HTTP(S). A local static server can verify the browser flow:

```sh
python3 -m http.server 4173
```

Then open `http://localhost:4173/`.

## GitHub Pages

GitHub Pages can serve this site from the repository root on the `main` branch. Required repository setup after GitHub publication:

1. Add a GitHub remote.
2. Push `main`.
3. Enable Pages with source `Deploy from a branch`, branch `main`, folder `/`.

## Citation

Suggested citation:

Lacle, F., & Sultan, S. (2026). *Navigating Small Island Research Realities*. GitHub repository.

## License And Assets

Code is licensed under the MIT License. The SISSTEM mark remains with its respective owner and is included for this public research-navigation site.
