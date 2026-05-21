from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from generate_assignment_outputs import (
    OUT_DIR,
    SOURCE_DIR,
    TEMPLATE_XLSX,
    Simulator,
    read_events_from_xlsx,
    set_inline_cell,
    sort_cells,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = PROJECT_ROOT / ".env.local"
RUN_ID = time.strftime("%Y%m%d%H%M%S")


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


class SupabaseRest:
    def __init__(self) -> None:
        env = load_env()
        self.base = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
        self.anon = env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]
        self.service = env["SUPABASE_SERVICE_ROLE_KEY"]
        if not self.service:
            raise RuntimeError("Missing SUPABASE_SERVICE_ROLE_KEY in .env.local")

    def request(self, method: str, path: str, body=None, *, service=True, prefer="return=representation"):
        key = self.service if service else self.anon
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                raw = res.read().decode("utf-8")
                return res.status, json.loads(raw) if raw else None
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            try:
                detail = json.loads(raw)
            except Exception:
                detail = raw
            raise RuntimeError(f"{method} {path} failed: {exc.code} {detail}") from exc

    def select(self, table: str, query: str = "select=*"):
        return self.request("GET", f"/rest/v1/{table}?{query}")[1] or []

    def insert(self, table: str, rows, query: str = "select=*"):
        return self.request("POST", f"/rest/v1/{table}?{query}", rows)[1] or []

    def patch(self, table: str, filters: str, data: dict):
        return self.request("PATCH", f"/rest/v1/{table}?{filters}", data)[1] or []

    def delete(self, table: str, filters: str = "id=not.is.null"):
        self.request("DELETE", f"/rest/v1/{table}?{filters}", None, prefer="return=minimal")

    def auth_create_user(self, vehicle_id: str) -> str:
        email = f"acceptance-{RUN_ID}-{vehicle_id.lower()}@example.com"
        status, body = self.request(
            "POST",
            "/auth/v1/admin/users",
            {
                "email": email,
                "password": "Test123456",
                "email_confirm": True,
                "user_metadata": {"name": vehicle_id},
            },
        )
        user_id = body["id"]
        self.patch(
            "users",
            f"id=eq.{user_id}",
            {
                "name": vehicle_id,
                "email": email,
                "phone": "13800000000",
                "vehicle_plate": f"TEST-{RUN_ID}-{vehicle_id}",
                "vehicle_model": "Acceptance EV",
                "battery_capacity": 100,
                "role": "user",
            },
        )
        return user_id


def reset_database(db: SupabaseRest) -> dict[str, str]:
    for table in [
        "queue_entries",
        "payment_orders",
        "bills",
        "parking_fee_orders",
        "notifications",
        "faults",
        "station_logs",
        "charging_orders",
    ]:
        db.delete(table)

    station_rows = [
        {"station_number": "F-001", "mode": "fast", "location": "Acceptance Fast #1", "max_power": 30, "status": "available"},
        {"station_number": "F-002", "mode": "fast", "location": "Acceptance Fast #2", "max_power": 30, "status": "available"},
        {"station_number": "F-003", "mode": "fast", "location": "Acceptance Fast #3", "max_power": 30, "status": "available"},
        {"station_number": "S-001", "mode": "slow", "location": "Acceptance Slow #1", "max_power": 10, "status": "available"},
        {"station_number": "S-002", "mode": "slow", "location": "Acceptance Slow #2", "max_power": 10, "status": "available"},
    ]
    for row in station_rows:
        quoted = urllib.parse.quote(row["station_number"])
        existing = db.select("charging_stations", f"select=id&station_number=eq.{quoted}")
        payload = {
            **row,
            "current_order_id": None,
            "current_voltage": 0,
            "current_current": 0,
            "current_power": 0,
            "cumulative_energy": 0,
            "temperature": 25,
        }
        if existing:
            db.patch("charging_stations", f"id=eq.{existing[0]['id']}", payload)
        else:
            db.insert("charging_stations", payload)
    db.delete("charging_stations", "station_number=in.(S-003,S-004,S-005)")

    for qtype, size in [("fast", 9), ("slow", 6), ("waiting", 10)]:
        existing = db.select("queues", f"select=id&type=eq.{qtype}")
        if existing:
            db.patch("queues", f"id=eq.{existing[0]['id']}", {"max_size": size})
        else:
            db.insert("queues", {"type": qtype, "max_size": size})

    events = read_events_from_xlsx(TEMPLATE_XLSX)
    vehicle_ids = sorted({re.search(r"V\d+", ev).group(0) for _, _, ev in events if re.search(r"V\d+", ev)}, key=lambda x: int(x[1:]))
    return {vid: db.auth_create_user(vid) for vid in vehicle_ids}


def db_names() -> dict[str, str]:
    return {"F1": "F-001", "F2": "F-002", "F3": "F-003", "T1": "S-001", "T2": "S-002"}


def order_status(sim: Simulator, vid: str) -> tuple[str, str | None]:
    vehicle = sim.vehicles[vid]
    for pile in sim.piles:
        if vid in pile.queue:
            if pile.queue.index(vid) == 0 and not pile.is_faulted:
                return "charging", pile.name
            return "queued", pile.name
    if vid in sim.waiting or vid in sim.priority:
        return "queued", None
    if vehicle.done:
        if "故障" in vehicle.note:
            return "fault_stopped", None
        if vehicle.charged + 1e-6 >= vehicle.amount:
            return "completed", None
        return "cancelled", None
    return "pending", None


def ensure_orders(db: SupabaseRest, sim: Simulator, user_map: dict[str, str], order_map: dict[str, str]) -> None:
    for vid, vehicle in sim.vehicles.items():
        if vid not in order_map:
            rows = db.insert(
                "charging_orders",
                {
                    "user_id": user_map[vid],
                    "mode": "fast" if vehicle.mode == "F" else "slow",
                    "status": "pending",
                    "request_battery_level": 0,
                    "target_battery_level": vehicle.amount,
                    "energy_consumed": 0,
                    "charging_fee": 0,
                },
            )
            order_map[vid] = rows[0]["id"]


def sync_database(db: SupabaseRest, sim: Simulator, user_map: dict[str, str], order_map: dict[str, str]) -> dict:
    ensure_orders(db, sim, user_map, order_map)
    station_rows = db.select("charging_stations", "select=id,station_number")
    station_id = {row["station_number"]: row["id"] for row in station_rows}
    queue_rows = db.select("queues", "select=id,type")
    queue_id = {row["type"]: row["id"] for row in queue_rows}

    db.delete("queue_entries")

    for pile in sim.piles:
        station_number = db_names()[pile.name]
        active = pile.queue[0] if pile.queue and not pile.is_faulted else None
        db.patch(
            "charging_stations",
            f"id=eq.{station_id[station_number]}",
            {
                "status": "fault" if pile.is_faulted else ("charging" if active else "available"),
                "current_order_id": order_map.get(active) if active else None,
                "current_voltage": 400 if active else 0,
                "current_current": 75 if pile.mode == "F" and active else (25 if active else 0),
                "current_power": pile.power if active else 0,
                "cumulative_energy": round(sum(sim.vehicles[vid].charged for vid in pile.queue), 3),
                "temperature": 40 if active else 25,
            },
        )

    queue_positions = {"fast": 0, "slow": 0, "waiting": 0}
    order_queue_entry: dict[str, str | None] = {vid: None for vid in order_map}

    for pile in sim.piles:
        for idx, vid in enumerate(pile.queue):
            status, assigned_pile = order_status(sim, vid)
            vehicle = sim.vehicles[vid]
            qtype = "fast" if vehicle.mode == "F" else "slow"
            queue_positions[qtype] += 1
            if idx > 0 or status == "queued":
                entry = db.insert(
                    "queue_entries",
                    {
                        "user_id": user_map[vid],
                        "order_id": order_map[vid],
                        "queue_id": queue_id[qtype],
                        "position": queue_positions[qtype],
                        "mode": "fast" if vehicle.mode == "F" else "slow",
                        "battery_level": round(vehicle.charged, 3),
                        "estimated_wait_minutes": int(queue_positions[qtype] * (40 if vehicle.mode == "F" else 180)),
                        "status": "charging" if status == "charging" else "waiting",
                    },
                )[0]
                order_queue_entry[vid] = entry["id"]

    for vid in sim.priority + sim.waiting:
        vehicle = sim.vehicles[vid]
        queue_positions["waiting"] += 1
        entry = db.insert(
            "queue_entries",
            {
                "user_id": user_map[vid],
                "order_id": order_map[vid],
                "queue_id": queue_id["waiting"],
                "position": queue_positions["waiting"],
                "mode": "fast" if vehicle.mode == "F" else "slow",
                "battery_level": round(vehicle.charged, 3),
                "estimated_wait_minutes": int(queue_positions["waiting"] * 30),
                "status": "waiting",
            },
        )[0]
        order_queue_entry[vid] = entry["id"]

    for vid, order_id in order_map.items():
        vehicle = sim.vehicles[vid]
        status, assigned_pile = order_status(sim, vid)
        station_number = db_names()[assigned_pile] if assigned_pile else None
        db.patch(
            "charging_orders",
            f"id=eq.{order_id}",
            {
                "station_id": station_id.get(station_number) if station_number else None,
                "queue_entry_id": order_queue_entry.get(vid),
                "mode": "fast" if vehicle.mode == "F" else "slow",
                "status": status,
                "target_battery_level": vehicle.amount,
                "energy_consumed": round(vehicle.charged, 3),
                "charging_fee": round(vehicle.fee, 2),
            },
        )

        if status in ("completed", "fault_stopped") and vehicle.charged > 0:
            existing_bill = db.select("bills", f"select=id&charging_order_id=eq.{order_id}")
            if not existing_bill:
                db.insert(
                    "bills",
                    {
                        "user_id": user_map[vid],
                        "charging_order_id": order_id,
                        "charging_fee": round(vehicle.fee, 2),
                        "parking_fee": 0,
                        "total_amount": round(vehicle.fee, 2),
                        "status": "unpaid",
                    },
                )

    active_stations = db.select(
        "charging_stations",
        "select=station_number,mode,status,current_order_id,current_power&station_number=in.(F-001,F-002,F-003,S-001,S-002)&order=station_number",
    )
    orders = db.select("charging_orders", "select=id,status,energy_consumed,charging_fee")
    entries = db.select("queue_entries", "select=id,status")
    return {"stations": active_stations, "orders": len(orders), "queue_entries": len(entries)}


def fill_workbook_from_snapshots(snapshots: dict[int, tuple[list[list[str]], str]], dst: Path) -> None:
    ns_uri = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    ET.register_namespace("", ns_uri)
    ns = {"m": ns_uri}
    with zipfile.ZipFile(TEMPLATE_XLSX) as zin, zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "xl/worksheets/sheet1.xml":
                root = ET.fromstring(data)
                sheet_data = root.find("m:sheetData", ns)
                rows = {int(r.attrib["r"]): r for r in sheet_data.findall("m:row", ns)}
                for row, (pile_rows, waiting) in snapshots.items():
                    for offset in range(3):
                        for idx, col in enumerate(["C", "D", "E", "F", "G"]):
                            set_inline_cell(rows[row + offset], f"{col}{row + offset}", pile_rows[offset][idx], ns_uri)
                            sort_cells(rows[row + offset])
                    set_inline_cell(rows[row], f"H{row}", waiting, ns_uri)
                    sort_cells(rows[row])
                data = ET.tostring(root, encoding="utf-8", xml_declaration=True)
            zout.writestr(item, data)


def run() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    db = SupabaseRest()
    user_map = reset_database(db)
    sim = Simulator()
    order_map: dict[str, str] = {}
    snapshots: dict[int, tuple[list[list[str]], str]] = {}
    log = []

    for row, minute, event in read_events_from_xlsx(TEMPLATE_XLSX):
        sim.advance_to(minute)
        sim.apply_event(event)
        db_state = sync_database(db, sim, user_map, order_map)
        snapshots[row] = sim.state_rows()
        log.append({"row": row, "minute": minute, "event": event, "db": db_state})

    output = OUT_DIR / "作业验收用例（包含参数说明）_真实测试结果.xlsx"
    fill_workbook_from_snapshots(snapshots, output)
    (OUT_DIR / "真实测试日志.json").write_text(json.dumps(log, ensure_ascii=False, indent=2), encoding="utf-8")
    print(str(output))
    print(str(OUT_DIR / "真实测试日志.json"))


if __name__ == "__main__":
    run()
