# MQTT Message Structure & Flow

## Overview

The system uses MQTT as the communication layer between the web app and physical hardware (vehicle, sensors, etc).
The backend subscribes to the broker and relays updates to the browser via WebSocket — the browser never
connects to MQTT directly.

```
[Browser] <--WebSocket--> [Backend (port 3001)] <--MQTT--> [Broker (192.168.1.130:1883)]
                                                                      |
                                                              [Vehicle / Hardware]
```

---

## Proposed Topic Structure

Three topics total. Hardware only ever publishes inbound. The app only ever publishes outbound.
No topic does double duty.

```
bins/update      ← hardware → backend → browser   (hardware reports bin state)
bins/command     → browser → backend → hardware   (app tells hardware what to do)
vehicle/status   ← hardware → backend → browser   (vehicle reports its own state)
```

---

## `bins/update`
**Direction:** Hardware → Broker → Backend → Browser
**Purpose:** Hardware reports the current state of a bin after any change.

**Payload:**
```json
{
  "barcode": "ABC123",
  "status": "out",
  "request": "no",
  "store": "no"
}
```

**Field rules:**
| Field | Values | Required |
|---|---|---|
| `barcode` | any string | yes |
| `status` | `"in"` / `"out"` | no |
| `request` | `"yes"` / `"no"` | no |
| `store` | `"yes"` / `"no"` | no |

Only fields present and valid are applied — missing fields are ignored.

**Flow:**
1. Hardware publishes to `bins/update` after acting on a command or detecting a state change
2. Backend receives it, validates fields, updates the JSON file on disk
3. Backend broadcasts the change over WebSocket to all connected browser clients
4. Browser updates the bin card in local state (no page reload)

---

## `bins/command`
**Direction:** Browser → Backend → Broker → Hardware
**Purpose:** App tells hardware to perform an action on a bin. All bin commands go through
this single topic — the `type` field distinguishes what to do.

**Payload:**
```json
{
  "barcode": "ABC123",
  "type": "request",
  "location": "A3"
}
```

**Field rules:**
| Field | Values | Required |
|---|---|---|
| `barcode` | any string | yes |
| `type` | `"request"` / `"store"` / `"retrieve"` | yes |
| `location` | shelf/slot identifier | only for `"store"` |

**Command types:**

| Type | Meaning |
|---|---|
| `request` | User is requesting a bin be retrieved |
| `retrieve` | Explicitly tell the vehicle to retrieve a bin |
| `store` | Tell the vehicle to store a bin at a location |

**Flow:**
1. User performs an action in the browser (click bin, press store, etc.)
2. Browser sends over WebSocket: `{ "topic": "bins/command", "payload": { ... } }`
3. Backend publishes the payload to MQTT topic `bins/command`
4. Hardware receives it, acts, then confirms by publishing back on `bins/update`

The browser never updates local state optimistically — it waits for hardware to confirm
via `bins/update`. This ensures the UI always reflects reality.

---

## `vehicle/status`
**Direction:** Hardware → Broker → Backend → Browser
**Purpose:** Vehicle reports its current state so the UI can show availability, current task, etc.

**Payload:**
```json
{
  "state": "busy",
  "task": "retrieve",
  "barcode": "ABC123",
  "location": "A3"
}
```

**Field rules:**
| Field | Values | Required |
|---|---|---|
| `state` | `"idle"` / `"busy"` / `"error"` | yes |
| `task` | `"retrieve"` / `"store"` / `null` | no |
| `barcode` | bin being acted on | no |
| `location` | current or target location | no |

---

## Message Lifecycle Example

**User requests a bin:**
```
Browser clicks bin
  → WS → backend → MQTT: bins/command { barcode, type: "request" }
    → Vehicle receives command, queues retrieval
      → Vehicle publishes: bins/update { barcode, status: "out", request: "yes" }
        → Backend updates disk, broadcasts over WS
          → Browser card updates to red/flashing
```

**Vehicle finishes retrieving:**
```
Vehicle arrives at pickup
  → MQTT: bins/update { barcode, status: "out", request: "no" }
  → MQTT: vehicle/status { state: "idle", task: null }
    → Backend broadcasts both over WS
      → Browser updates bin card and vehicle indicator
```

---

## Current vs Proposed Topics

| Current | Proposed | Change |
|---|---|---|
| `bins/status/update` | `bins/update` | renamed, hardware-only |
| `bins/status/request` | `bins/command` | renamed, extended to cover store/retrieve |
| _(none)_ | `vehicle/status` | new |

---

## Bin Visual States (driven by `bins/update` data)

| Border | Animation | Condition |
|---|---|---|
| Gray | none | in stock, no request |
| Red | flash-red | out of stock |
| Red | flash-red | in stock + request active |
| Green | flash-green | store === "yes" |

---

## Connection Details

| Parameter | Value |
|---|---|
| Broker host | `192.168.1.130` |
| MQTT port | `1883` (TCP, backend only) |
| WebSocket port | `3001` (browser ↔ backend) |
| Credentials | stored in `backend/.env` only |
