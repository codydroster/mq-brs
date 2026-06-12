import json
import os

LOCATIONS_FILE = os.path.join(os.path.dirname(__file__), "locations.json")

ROWS  = 4
COLS  = 8
SLOTS = 3


def _load():
    try:
        with open(LOCATIONS_FILE) as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def _save(grid):
    with open(LOCATIONS_FILE, "w") as f:
        json.dump(grid, f, indent=2)


def init_grid():
    """Create a fresh empty grid file. Overwrites existing."""
    grid = {f"{r},{c},{s}": None for r in range(1, ROWS+1) for c in range(1, COLS+1) for s in range(1, SLOTS+1)}
    _save(grid)
    return grid


def load_or_init():
    """Load existing grid or create a new one if it doesn't exist."""
    grid = _load()
    if not grid:
        grid = init_grid()
    return grid


def find_bin(barcode):
    """Return (row, col, slot) for a barcode, or None if not found."""
    grid = _load()
    for key, val in grid.items():
        if val == barcode:
            row, col, slot = map(int, key.split(","))
            return (row, col, slot)
    return None


def find_empty_slot():
    """
    Return (row, col, slot) for the first physically insertable slot, or None if full.

    Slots are back-to-front (1 = back, 3 = front) and bins are inserted from the
    front, so the only insertable slot at a position is the one directly in front
    of the frontmost occupied slot (or slot 1 if the position is empty). A deeper
    empty slot behind an occupied one is unreachable.
    """
    grid = _load()
    for r in range(1, ROWS+1):
        for c in range(1, COLS+1):
            deepest_occupied = 0
            for s in range(1, SLOTS+1):
                if grid.get(f"{r},{c},{s}") is not None:
                    deepest_occupied = s
            if deepest_occupied < SLOTS:
                return (r, c, deepest_occupied + 1)
    return None


def place_bin(barcode, row, col, slot):
    """Assign a barcode to a location. Raises if slot is already occupied."""
    grid = _load()
    key = f"{row},{col},{slot}"
    if grid.get(key) is not None:
        raise ValueError(f"Slot {key} is already occupied by {grid[key]}")
    grid[key] = barcode
    _save(grid)


def remove_bin(barcode):
    """Clear a barcode from the grid. Returns its location or None if not found."""
    grid = _load()
    for key, val in grid.items():
        if val == barcode:
            grid[key] = None
            _save(grid)
            row, col, slot = map(int, key.split(","))
            return (row, col, slot)
    return None


def find_bin_at(row, col, slot):
    """Return the barcode at a specific location, or None if empty."""
    grid = _load()
    return grid.get(f"{row},{col},{slot}")


def get_grid():
    """Return the full grid dict."""
    return _load()


def print_grid():
    """Print a human-readable overview of the grid."""
    grid = _load()
    for r in range(1, ROWS+1):
        for c in range(1, COLS+1):
            slots = [grid.get(f"{r},{c},{s}") or "---" for s in range(1, SLOTS+1)]
            print(f"  [{r},{c}] {slots}")
        print()
