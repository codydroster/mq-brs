# MQTT Message Structure & Flow

## Architecture

The browser never connects to the MQTT broker directly. The backend is the only MQTT client —
it relays inbound messages to the browser via WebSocket, and forwards outbound browser messages
to the broker.

```
[Browser] <--WebSocket--> [Backend :3001] <--MQTT--> [Broker 192.168.1.130:1883]
                                                              |
                                                        [Vehicle]
```

---

## Topics

```
bins/update      ← vehicle → backend → browser    vehicle reports bin state changes
bins/command     → browser → backend → vehicle    app sends commands to the vehicle
vehicle/status   ← vehicle → backend → browser    vehicle reports its own state  (planned)
```

---

## `bins/update`

**Direction:** Vehicle → Broker → Backend → Browser

Vehicle publishes this after completing a command or detecting any bin state change.
Backend validates the fields, writes to disk, and broadcasts to all connected browsers.

**Payload:**
```json
{
  "barcode": "08",
  "status": "out-pending"
}
```

| Field | Values | Required |
|---|---|---|
| `barcode` | any string | yes |
| `status` | `"in"` / `"out"` / `"in-pending"` / `"out-pending"` | yes |

| Status | Meaning |
|---|---|
| `in` | Bin is stored |
| `out` | Bin has been retrieved |
| `in-pending` | Vehicle is on its way to store the bin |
| `out-pending` | Vehicle is on its way to retrieve the bin |

---

## `bins/command`

**Direction:** Browser → Backend → Broker → Vehicle

All bin commands use this single topic. The `type` field tells the vehicle what to do.
Barcode is the only identifier — the vehicle owns all location logic internally and
decides where to store or find a bin. The webserver never sends or tracks locations.

**Payload:**
```json
{
  "barcode": "08",
  "type": "retrieve"
}
```

| Field | Values | Required |
|---|---|---|
| `barcode` | any string | yes |
| `type` | `"retrieve"` / `"store"` | yes |

| Type | Triggered by | Meaning |
|---|---|---|
| `retrieve` | User clicks a bin card | Tell the vehicle to bring this bin out |
| `store` | UI store action | Tell the vehicle to put this bin away |

The browser never updates state optimistically. It sends the command and waits for the
vehicle to confirm via `bins/update`.

---

## `vehicle/status` _(planned)_

**Direction:** Vehicle → Broker → Backend → Browser

Vehicle reports what it's currently doing so the UI can show an idle/busy indicator.

**Payload:**
```json
{
  "state": "busy",
  "task": "retrieve",
  "barcode": "08"
}
```

| Field | Values | Required |
|---|---|---|
| `state` | `"idle"` / `"busy"` / `"error"` | yes |
| `task` | `"retrieve"` / `"store"` / `null` | only when busy |
| `barcode` | bin being acted on | only when busy |

---

## Lifecycle Examples

**User retrieves a bin:**
```
User clicks bin card → confirms dialog
  → WS → backend → MQTT: bins/command { barcode: "08", type: "retrieve" }
    → Vehicle begins moving
      → MQTT: bins/update { barcode: "08", status: "out-pending" }   ← card shows "Retrieving…" + red flash
    → Vehicle picks up bin, arrives at pickup point
      → MQTT: bins/update { barcode: "08", status: "out" }           ← card shows "Out" + red border
```

**Vehicle stores a bin:**
```
User triggers store via UI
  → WS → backend → MQTT: bins/command { barcode: "08", type: "store" }
    → Vehicle begins moving
      → MQTT: bins/update { barcode: "08", status: "in-pending" }    ← card shows "Storing…" + green flash
    → Vehicle places bin in slot (vehicle decides where)
      → MQTT: bins/update { barcode: "08", status: "in" }            ← card shows "In Stock" + gray border
```

---

## Bin Visual States

| Border | Animation | Label | Condition |
|---|---|---|---|
| Gray | none | In Stock | `status: "in"` |
| Red | none | Out | `status: "out"` |
| Red | flash-red | Retrieving… | `status: "out-pending"` |
| Green | flash-green | Storing… | `status: "in-pending"` |

---

## Connection Details

| Parameter | Value |
|---|---|
| Broker host | `192.168.1.130` |
| MQTT port | `1883` (TCP, backend only) |
| WebSocket port | `3001` (browser ↔ backend) |
| Credentials | `backend/.env` only — never in browser |
