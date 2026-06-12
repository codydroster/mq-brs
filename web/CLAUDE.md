# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project purpose

This is a bin sorting system for a physical warehouse/storage facility. The website interfaces with an autonomous vehicle that physically stores and retrieves bins. MQTT is the primary communication protocol between the web app and the vehicle — commands like store and retrieve are sent over MQTT topics, and the vehicle publishes status updates back.

## Commands

Two separate processes must run concurrently during development:

```bash
# Frontend (React, port 3000)
cd web && npm start

# Backend (Express, port 3001)
cd backend && node server.js
```

## Architecture

This is a bin inventory tracking system with real-time MQTT updates.

### Data model

Bins are JSON objects with fields: `name`, `barcode`, `subcategory`, `status` (`"in"`/`"out"`), `request` (`"yes"`/`"no"`), `store` (`"yes"`/`"no"`). They are persisted as flat JSON arrays in `backend/bins/<category>.json` — one file per category.

### Backend (`backend/`)

- `server.js` — Express REST API on port 3001. CRUD for categories and bins via the file-per-category JSON pattern. All category name inputs are validated with `isValidName()` (alphanumeric/dash/underscore only) to prevent path traversal.
- `mqttClient.js` — Standalone MQTT subscriber (`mqtt://192.168.1.118:1883`). Listens on `bins/status/update` and directly mutates the JSON files on disk when a bin's status/request/store fields change. It is `require()`'d by `server.js` purely as a side-effect to start it.

### Frontend (`src/`)

- `config.js` — Single source of truth for `BASE_URL` and `MQTT_URL`. Import from here, never hardcode.
- `App.js` — Owns `categories`, `selectedCategory`, and `selectedSubcategory` state. Passes `loadCategories` down as `reloadCategories` so children can trigger a refresh. Uses a `ref` to call `refreshExpandedBins()` on the Sidebar imperatively after bin changes.
- `Sidebar.js` — Renders the category/subcategory tree. Fetches bin data for expanded categories and caches it in `binsMap`. Exposes `refreshExpandedBins()` via `useImperativeHandle` to re-fetch all currently expanded categories in parallel.
- `BinList.js` — Renders bins for the selected category/subcategory as draggable cards. Maintains its own MQTT WebSocket connection (`ws://192.168.1.118:1884`) to apply live status updates to local state without a server round-trip. Drag-and-drop (via `@hello-pangea/dnd`) changes a bin's `subcategory` field.

### MQTT topics

| Topic | Direction | Purpose |
|---|---|---|
| `bins/status/update` | broker → app | Updates `status`, `request`, `store` on a bin by barcode |
| `bins/status/request` | app → broker | Published when a user clicks a bin card to toggle `request` |

### Bin card visual states

Border color and flash animation are driven by `getBinBorderColor` / `getBinAnimationClass` in `BinList.js`:
- Green border: in stock, no request
- Red border / flash: out of stock, or in stock with active request
- Green flash: `store === "yes"`

### Style conventions

- Color theme: charcoal `#1e293b`, orange `#f97316`, Arial font
- Static style objects are defined at module scope in a `const S = {...}` object in `Sidebar.js`; inline styles are used elsewhere
- CSS animations for bin flash states are in `src/index.css` (`.flash-red`, `.flash-green`)
