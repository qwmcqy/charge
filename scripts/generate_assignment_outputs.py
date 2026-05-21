from __future__ import annotations

import copy
import html
import math
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from xml.etree import ElementTree as ET


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = Path("C:/Users/刘晓雪/Desktop/作业/2025-2026 第六学期/软件工程/第二次作业")
OUT_DIR = PROJECT_ROOT / "文档"
TEMPLATE_XLSX = SOURCE_DIR / "作业验收用例（包含参数说明）.xlsx"


def write_docx(path: Path) -> None:
    paragraphs: list[tuple[str, str]] = []
    tables: list[list[list[str]]] = []

    def p(text: str, style: str = "Normal") -> None:
        paragraphs.append((text, style))

    def table(rows: list[list[str]]) -> None:
        tables.append(rows)
        paragraphs.append(("[[TABLE]]", "Normal"))

    p("智能充电桩调度计费系统概要设计说明书", "Title")
    p("基于 UML 的面向对象建模方法", "Subtitle")
    p("班级_小组：2023211314_G9    组长：齐煜    组员：刘晓雪、张维翰、傅泓浠    日期：2026/05/21")
    p("说明：本文依据项目代码 charge、详细需求文档与验收用例整理，采用 Next.js + Supabase 的分层架构描述。")

    p("1. 软件架构", "Heading1")
    p("1.1 软件架构示意图", "Heading2")
    p(
        "Browser/用户客户端/管理员客户端 -> Next.js App Router 页面层 -> API Route 控制层 -> Service 业务层 -> Model 领域对象层 -> Supabase 数据访问层 -> PostgreSQL/Auth/Storage。"
    )
    p(
        "系统采用前后端同构的 Next.js 架构。页面组件负责展示和收集操作，API Route 作为系统消息入口，Service 类组织调度、充电、计费、故障、监控等业务流程，Model 类封装领域对象状态变化，Supabase 负责认证、数据持久化、行级安全策略与实时数据读取。"
    )
    p("1.2 分层结构说明", "Heading2")
    table(
        [
            ["层次", "对象/文件", "职责"],
            ["界面层", "src/app/**/page.tsx、layout.tsx", "用户登录、提交充电请求、查看队列/账单/通知；管理员查看充电桩、队列、故障、报表。"],
            ["控制层", "src/app/api/**/route.ts", "接收 HTTP 请求，解析参数，调用业务服务并返回 JSON。"],
            ["业务服务层", "ChargingService、QueueService、BillService、PaymentService、FaultService、MonitorService、ConfigService", "实现用例流程、调度策略、费用计算、故障处理、系统配置和统计报表。"],
            ["领域模型层", "User、ChargingOrder、ChargingStation、QueueEntry、Bill、Fault、Notification 等", "封装领域对象属性、状态转换、创建与查询逻辑。"],
            ["数据层", "src/lib/supabase.ts、supabase/migrations/*.sql", "创建 Supabase 客户端，访问 PostgreSQL 表，执行 RLS、索引、触发器和初始化数据。"],
        ]
    )

    p("2. 系统的界面设计", "Heading1")
    table(
        [
            ["界面", "主要区域", "关键操作"],
            ["顾客充电申请界面", "当前账号、充电模式、当前电量、目标电量、提交按钮", "发起快充/慢充请求；校验电量范围；提交后进入直接充电或排队。"],
            ["顾客队列及充电状态查询界面", "排队号码、前车数量、预计等待时间、充电桩编号、实时电压/电流/功率/电量", "刷新队列状态；查看充电进度；取消、暂停、恢复或结束充电。"],
            ["顾客账单和详单界面", "账单编号、充电订单、充电费、停车超时费、总金额、支付状态", "查看详单；支付账单；查看历史订单。"],
            ["管理员监控界面", "充电桩状态卡片、实时指标、当前订单、故障状态", "启停充电桩；查看全部桩状态；处理故障；查看日志。"],
            ["管理员队列/账单/报表界面", "队列列表、等待车辆、账单汇总、日/周/月统计", "调整队列、移除异常车辆、核算账单、导出运营报表。"],
        ]
    )

    p("3. 系统动态结构设计", "Heading1")
    use_cases = [
        (
            "UC_01 顾客车辆充电申请与调度",
            [
                ["requestCharge(userId, mode, batteryLevel, targetLevel)", "{ order, directCharge/queued }", "创建 ChargingOrder；若有可用同类型充电桩则分配并开始充电，否则创建 QueueEntry 进入对应队列或等待队列。"],
                ["assignAndStartCharging(orderId)", "{ order, station }", "ChargingOrder 关联 ChargingStation；订单状态变为 charging；充电桩状态变为 charging。"],
                ["dispatchNext(queueType)", "next assignment/null", "充电完成或释放桩后，按队列位置选取下一辆车并分配到可用充电桩。"],
            ],
            "Actor -> API /api/charging/request -> ChargingService.requestCharge -> ChargingOrder.create -> QueueService.tryChargeOrQueue -> ChargingStation.fetchAvailable -> ChargingService.assignAndStartCharging/QueueEntry.create -> Supabase。"
        ),
        (
            "UC_02 顾客队列与充电状态查询",
            [
                ["getUserQueueStatus(userId)", "{ inQueue, position, totalWaiting, estimatedWaitMinutes }", "读取用户 waiting/ready 队列项，计算前车数量和预计等待时间。"],
                ["getChargingProgress(orderId, userId)", "ChargingProgress", "校验订单所属用户；读取订单、用户和充电桩实时指标；返回充电进度。"],
            ],
            "Actor -> /api/queue/status 或 /api/charging/[id] -> QueueService/User/ChargingOrder -> Supabase -> Actor。"
        ),
        (
            "UC_03 管理员充电桩及队列监控",
            [
                ["getDashboardOverview()", "overview", "统计总桩数、空闲桩、充电中桩、故障桩和实时列表。"],
                ["getAllQueuesStatus()", "queue list", "按队列读取等待车辆、车牌、位置和队列长度。"],
                ["updateStation(stationId, data, adminId)", "station", "管理员维护充电桩编号、模式、位置、功率。"],
            ],
            "Admin -> Admin 页面/API -> MonitorService/QueueService/ConfigService -> ChargingStation/QueueEntry -> Supabase。"
        ),
        (
            "UC_04 收费管理：出具账单及详单",
            [
                ["endCharging(orderId, userId)", "order", "计算充电费并结束订单，释放充电桩，生成停车计时单。"],
                ["depart(orderId, userId)", "{ bill, parkingFee, totalAmount }", "车辆离开时计算超时停车费，生成包含充电费和停车费的账单。"],
                ["processPayment(userId, orderId, amount, method)", "PaymentResult", "创建支付订单，模拟支付成功后更新账单状态。"],
            ],
            "Actor -> ChargingService.endCharging/depart -> ParkingFeeOrder.markDeparted -> Bill.generate -> PaymentService.processPayment -> Supabase。"
        ),
        (
            "UC_05 故障处理与恢复",
            [
                ["autoDetectFaults()", "fault list", "读取充电桩实时状态并根据阈值识别过热、电压、电流等异常。"],
                ["handleFault(faultId, adminId, resolution)", "fault", "管理员登记处理结果，故障 resolved_at 赋值，充电桩恢复可用或维修状态。"],
                ["simulateChargingTick(orderId)", "{ completed/fault/stopped }", "模拟充电过程；若检测到故障则停止订单并触发后续调度。"],
            ],
            "Station/Timer -> FaultService/ChargingService -> Fault.report -> ChargingOrder.endCharging(fault_stopped) -> QueueService.dispatchNext。"
        ),
        (
            "UC_06 报表与配置管理",
            [
                ["getReport(startDate, endDate, adminId)", "OperationReport", "统计订单数、电量、充电费、停车费、故障数、利用率和分时分布。"],
                ["updateConfig(config, adminId)", "SystemConfig", "维护费率、队列长度、宽限时间、平均等待时长等系统参数。"],
            ],
            "Admin -> /api/admin/reports/config -> ConfigService/Administrator -> charging_orders/bills/faults/system_configs。"
        ),
    ]
    for name, rows, seq in use_cases:
        p(name, "Heading2")
        table([["消息名称", "返回值", "操作契约的后置条件"], *rows])
        p("对象设计与交互图（文字版）：" + seq)

    p("4. 系统静态结构设计", "Heading1")
    p("4.1 系统级类图（PlantUML 文本）", "Heading2")
    p(
        "@startuml\nUser --> ChargingOrder\nChargingOrder --> ChargingStation\nChargingOrder --> QueueEntry\nQueueEntry --> Queue\nChargingOrder --> Bill\nChargingOrder --> ParkingFeeOrder\nChargingStation --> Fault\nUser --> Notification\nAdministrator --> ChargingStation\nAdministrator --> Fault\nAdministrator --> Bill\nChargingService --> ChargingOrder\nChargingService --> QueueService\nQueueService --> QueueEntry\nBillService --> Bill\nMonitorService --> ChargingStation\n@enduml",
        "Code",
    )
    table(
        [
            ["类", "类型", "属性/方法", "说明"],
            ["User", "领域对象", "id、name、vehiclePlate；fetchById、getChargingProgress、payBill", "车主信息及用户侧查询/支付能力。"],
            ["ChargingOrder", "领域对象", "mode、status、energyConsumed、chargingFee；create、assignStation、startCharging、endCharging", "充电订单生命周期。"],
            ["ChargingStation", "领域对象", "stationNumber、mode、status、currentPower；fetchAvailable、startCharging、stopCharging、detectFault", "充电桩状态和实时数据。"],
            ["QueueEntry/Queue", "领域对象", "position、estimatedWaitMinutes、status；create、fetchByType", "排队条目与快充/慢充/等待队列。"],
            ["Bill/PaymentOrder", "领域对象", "chargingFee、parkingFee、totalAmount、status；generate、markPaid", "账单和支付订单。"],
            ["Fault", "领域对象", "type、severity、resolution；report、resolve", "故障记录和处理结果。"],
            ["ChargingService", "控制/服务对象", "requestCharge、endCharging、depart、simulateChargingTick", "组织车辆充电主流程。"],
            ["QueueService", "控制/服务对象", "tryChargeOrQueue、dispatchNext、promoteFromWaiting", "组织排队和调度。"],
            ["MonitorService/ConfigService", "控制/服务对象", "getDashboardOverview、getReport、updateConfig", "管理员监控、报表和系统参数维护。"],
        ]
    )

    p("5. 数据库与部署支持", "Heading1")
    table(
        [
            ["项目", "需要内容"],
            ["Supabase URL", "NEXT_PUBLIC_SUPABASE_URL=https://dnqpbaevpfjuxgeqyndb.supabase.co（客户端 SDK 使用项目根 URL，不带 /rest/v1）"],
            ["Anon Key", "NEXT_PUBLIC_SUPABASE_ANON_KEY，需要从 Supabase Project Settings -> API 获取。"],
            ["Service Role Key", "SUPABASE_SERVICE_ROLE_KEY，后端管理接口/绕过 RLS 操作需要；仅放在服务端环境变量中。"],
            ["数据库迁移", "依次执行 supabase/migrations/001_schema.sql、002_rls_and_seed.sql、003_seed_data.sql、003_fix_missing_rls.sql。"],
            ["认证设置", "若要课堂演示免邮件确认，可在 Supabase Auth Settings 关闭 Confirm email，或预先创建测试账号。"],
        ]
    )

    p("6. 工作量统计", "Heading1")
    table(
        [
            ["成员", "动态设计", "静态设计", "界面/测试", "工作量说明"],
            ["齐煜（组长）", "UC_01、UC_04", "核心领域类", "充电申请、账单流程", "负责主流程、调度与计费设计。"],
            ["刘晓雪", "UC_02、UC_06", "User、QueueEntry、ConfigService", "队列查询、报表配置", "负责用户排队状态、系统参数和验收表整理。"],
            ["张维翰", "UC_03", "ChargingStation、MonitorService", "管理员监控", "负责充电桩监控和队列管理设计。"],
            ["傅泓浠", "UC_05", "Fault、Notification", "故障处理、通知", "负责故障检测、处理、恢复调度和通知设计。"],
        ]
    )

    body = []
    table_iter = iter(tables)
    for text, style in paragraphs:
        if text == "[[TABLE]]":
            body.append(docx_table(next(table_iter)))
        else:
            body.append(docx_paragraph(text, style))

    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        '<w:body>'
        + "".join(body)
        + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1200" w:bottom="1440" w:left="1200" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>'
        '</w:body></w:document>'
    )

    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", CONTENT_TYPES)
        z.writestr("_rels/.rels", ROOT_RELS)
        z.writestr("docProps/app.xml", APP_XML)
        z.writestr("docProps/core.xml", CORE_XML)
        z.writestr("word/document.xml", document_xml)
        z.writestr("word/styles.xml", STYLES_XML)


def docx_paragraph(text: str, style: str = "Normal") -> str:
    style_map = {
        "Title": "Title",
        "Subtitle": "Subtitle",
        "Heading1": "Heading1",
        "Heading2": "Heading2",
        "Code": "Code",
        "Normal": "Normal",
    }
    parts = []
    for line in text.split("\n"):
        run = f"<w:r><w:t xml:space=\"preserve\">{html.escape(line)}</w:t></w:r>"
        if parts:
            parts.append("<w:r><w:br/></w:r>")
        parts.append(run)
    return f'<w:p><w:pPr><w:pStyle w:val="{style_map.get(style, "Normal")}"/></w:pPr>{"".join(parts)}</w:p>'


def docx_table(rows: list[list[str]]) -> str:
    grid_cols = "".join('<w:gridCol w:w="3000"/>' for _ in rows[0])
    tr_xml = []
    for row in rows:
        cells = []
        for cell in row:
            cells.append(
                '<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>'
                + docx_paragraph(cell)
                + "</w:tc>"
            )
        tr_xml.append("<w:tr>" + "".join(cells) + "</w:tr>")
    return (
        '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/>'
        '<w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>'
        '<w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>'
        '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>'
        '<w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>'
        '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/>'
        '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders>'
        '</w:tblPr><w:tblGrid>'
        + grid_cols
        + "</w:tblGrid>"
        + "".join(tr_xml)
        + "</w:tbl>"
    )


CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>"""

ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>"""

APP_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Codex</Application></Properties>"""

CORE_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>智能充电桩调度计费系统概要设计说明书</dc:title><dc:creator>Codex</dc:creator></cp:coreProperties>"""

STYLES_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:eastAsia="宋体" w:ascii="Calibri"/><w:sz w:val="21"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="Consolas" w:eastAsia="等线"/><w:sz w:val="18"/></w:rPr></w:style>
</w:styles>"""


@dataclass
class Vehicle:
    vid: str
    mode: str
    amount: float
    charged: float = 0.0
    fee: float = 0.0
    active_since: float | None = None
    done: bool = False
    note: str = ""

    @property
    def remaining(self) -> float:
        return max(0.0, self.amount - self.charged)


@dataclass
class Pile:
    name: str
    mode: str
    power: float
    queue: list[str] = field(default_factory=list)
    fault_until: float | None = None

    def capacity_left(self) -> int:
        return 0 if self.is_faulted else 3 - len(self.queue)

    @property
    def is_faulted(self) -> bool:
        return self.fault_until is not None


class Simulator:
    def __init__(self) -> None:
        self.time = 6 * 60.0
        self.vehicles: dict[str, Vehicle] = {}
        self.piles = [
            Pile("F1", "F", 30.0),
            Pile("F2", "F", 30.0),
            Pile("F3", "F", 30.0),
            Pile("T1", "T", 10.0),
            Pile("T2", "T", 10.0),
        ]
        self.waiting: list[str] = []
        self.priority: list[str] = []

    def tariff(self, minute: float) -> float:
        h = (minute / 60.0) % 24
        if 10 <= h < 15 or 18 <= h < 21:
            return 1.0
        if 7 <= h < 10 or 15 <= h < 18 or 21 <= h < 23:
            return 0.7
        return 0.4

    def next_tariff_boundary(self, minute: float) -> float:
        day = math.floor(minute / 1440) * 1440
        boundaries = [7 * 60, 10 * 60, 15 * 60, 18 * 60, 21 * 60, 23 * 60, 31 * 60]
        for b in boundaries:
            absolute = day + b
            if absolute > minute + 1e-9:
                return absolute
        return day + 31 * 60

    def active_vehicle(self, pile: Pile) -> Vehicle | None:
        if pile.queue:
            return self.vehicles[pile.queue[0]]
        return None

    def advance_to(self, target: float) -> None:
        while self.time < target - 1e-9:
            next_time = target
            for pile in self.piles:
                vehicle = self.active_vehicle(pile)
                if vehicle and not pile.is_faulted:
                    next_time = min(next_time, self.time + vehicle.remaining / pile.power * 60)
                if pile.fault_until is not None:
                    next_time = min(next_time, pile.fault_until)
            next_time = min(next_time, self.next_tariff_boundary(self.time))
            self.accrue(self.time, next_time)
            self.time = next_time
            for pile in self.piles:
                if pile.fault_until is not None and self.time >= pile.fault_until - 1e-9:
                    pile.fault_until = None
                vehicle = self.active_vehicle(pile)
                if vehicle and vehicle.remaining <= 1e-6:
                    vehicle.done = True
                    pile.queue.pop(0)
            self.dispatch()

    def accrue(self, start: float, end: float) -> None:
        if end <= start:
            return
        for pile in self.piles:
            vehicle = self.active_vehicle(pile)
            if not vehicle or pile.is_faulted:
                continue
            energy = min(vehicle.remaining, pile.power * (end - start) / 60.0)
            vehicle.charged += energy
            vehicle.fee += energy * (self.tariff(start) + 0.8)

    def dispatch(self) -> None:
        changed = True
        while changed:
            changed = False
            for source in (self.priority, self.waiting):
                for vid in list(source):
                    vehicle = self.vehicles[vid]
                    pile = self.best_pile(vehicle.mode)
                    if pile is None:
                        continue
                    source.remove(vid)
                    pile.queue.append(vid)
                    changed = True
                    break
                if changed:
                    break

    def best_pile(self, mode: str) -> Pile | None:
        candidates = [p for p in self.piles if p.mode == mode and p.capacity_left() > 0]
        if not candidates:
            return None
        return min(candidates, key=lambda p: (self.queue_remaining_minutes(p), p.name))

    def queue_remaining_minutes(self, pile: Pile) -> float:
        return sum(self.vehicles[vid].remaining / pile.power * 60 for vid in pile.queue)

    def apply_event(self, event: str) -> None:
        kind, ident, mode, value = parse_event(event)
        if kind == "A" and ident.startswith("V") and value == 0:
            self.cancel(ident)
        elif kind == "A":
            self.vehicles[ident] = Vehicle(ident, mode, value)
            self.waiting.append(ident)
        elif kind == "C":
            self.change(ident, None if mode == "O" else mode, None if value == -1 else value)
        elif kind == "B":
            self.breakdown(ident, value)
        self.dispatch()

    def cancel(self, vid: str) -> None:
        if vid in self.waiting:
            self.waiting.remove(vid)
        if vid in self.priority:
            self.priority.remove(vid)
        for pile in self.piles:
            if vid in pile.queue:
                pile.queue.remove(vid)
        if vid in self.vehicles:
            self.vehicles[vid].done = True

    def change(self, vid: str, mode: str | None, amount: float | None) -> None:
        vehicle = self.vehicles.get(vid)
        if not vehicle or vehicle.done:
            return
        in_waiting = vid in self.waiting or vid in self.priority
        in_pile = any(vid in p.queue for p in self.piles)
        if in_pile:
            vehicle.note = "充电区不允许修改，保持原请求"
            return
        if in_waiting:
            if mode:
                vehicle.mode = mode
                if vid in self.waiting:
                    self.waiting.remove(vid)
                    self.waiting.append(vid)
            if amount is not None:
                vehicle.amount = amount

    def breakdown(self, pile_name: str, duration: float) -> None:
        pile = next(p for p in self.piles if p.name == pile_name)
        stopped = list(pile.queue)
        pile.queue.clear()
        if stopped:
            current = self.vehicles[stopped[0]]
            current.done = True
            current.note = f"{pile.name}故障停止"
            for vid in stopped[1:]:
                self.priority.append(vid)
        pile.fault_until = self.time + duration

    def state_rows(self) -> tuple[list[list[str]], str]:
        rows = [["" for _ in self.piles] for _ in range(3)]
        for c, pile in enumerate(self.piles):
            if pile.is_faulted:
                rows[0][c] = f"{pile.name}故障至{minutes_to_clock(pile.fault_until or self.time)}"
            for r, vid in enumerate(pile.queue[:3]):
                v = self.vehicles[vid]
                rows[r][c] = f"({v.vid},{v.charged:.1f},{v.fee:.2f})"
        waiting_items = []
        for vid in self.priority + self.waiting:
            v = self.vehicles[vid]
            waiting_items.append(f"({v.vid},{v.mode},{v.amount:g})")
        waiting = "；".join(waiting_items) if waiting_items else "空"
        return rows, waiting


def parse_event(text: str) -> tuple[str, str, str, float]:
    parts = [p.strip() for p in text.strip("()").split(",")]
    return parts[0], parts[1], parts[2], float(parts[3])


def excel_fraction_to_minutes(value: float) -> float:
    return value * 24 * 60


def minutes_to_clock(minute: float) -> str:
    h = int(minute // 60) % 24
    m = int(round(minute % 60))
    if m == 60:
        h = (h + 1) % 24
        m = 0
    return f"{h:02d}:{m:02d}"


def read_events_from_xlsx(path: Path) -> list[tuple[int, float, str]]:
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with zipfile.ZipFile(path) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall("m:si", ns):
                shared.append("".join(t.text or "" for t in si.findall(".//m:t", ns)))
        sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
        result = []
        for row in sheet.findall(".//m:sheetData/m:row", ns):
            r = int(row.attrib["r"])
            a = get_cell_value(row, "A", shared, ns)
            b = get_cell_value(row, "B", shared, ns)
            if a and b and b.startswith("("):
                result.append((r, excel_fraction_to_minutes(float(a)), b))
        return result


def get_cell_value(row: ET.Element, col: str, shared: list[str], ns: dict[str, str]) -> str:
    for c in row.findall("m:c", ns):
        if re.match(fr"{col}\d+$", c.attrib.get("r", "")):
            v = c.find("m:v", ns)
            if v is not None:
                text = v.text or ""
                return shared[int(text)] if c.attrib.get("t") == "s" else text
            inline = c.find("m:is", ns)
            if inline is not None:
                return "".join(t.text or "" for t in inline.findall(".//m:t", ns))
    return ""


def fill_xlsx(src: Path, dst: Path) -> None:
    events = read_events_from_xlsx(src)
    sim = Simulator()
    output: dict[str, str] = {}
    for row, minute, event in events:
        sim.advance_to(minute)
        sim.apply_event(event)
        pile_rows, waiting = sim.state_rows()
        for offset in range(3):
            for idx, col in enumerate(["C", "D", "E", "F", "G"]):
                output[f"{col}{row + offset}"] = pile_rows[offset][idx]
        output[f"H{row}"] = waiting

    ns_uri = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    ET.register_namespace("", ns_uri)
    ns = {"m": ns_uri}

    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "xl/worksheets/sheet1.xml":
                root = ET.fromstring(data)
                sheet_data = root.find("m:sheetData", ns)
                assert sheet_data is not None
                rows = {int(r.attrib["r"]): r for r in sheet_data.findall("m:row", ns)}
                for ref, value in output.items():
                    row_num = int(re.findall(r"\d+", ref)[0])
                    col = re.findall(r"[A-Z]+", ref)[0]
                    row_el = rows[row_num]
                    set_inline_cell(row_el, ref, value, ns_uri)
                    sort_cells(row_el)
                data = ET.tostring(root, encoding="utf-8", xml_declaration=True)
            zout.writestr(item, data)


def set_inline_cell(row_el: ET.Element, ref: str, value: str, ns_uri: str) -> None:
    cell = None
    for c in row_el.findall(f"{{{ns_uri}}}c"):
        if c.attrib.get("r") == ref:
            cell = c
            break
    if cell is None:
        cell = ET.Element(f"{{{ns_uri}}}c", {"r": ref})
        row_el.append(cell)
    for child in list(cell):
        cell.remove(child)
    cell.attrib["t"] = "inlineStr"
    is_el = ET.SubElement(cell, f"{{{ns_uri}}}is")
    t_el = ET.SubElement(is_el, f"{{{ns_uri}}}t")
    t_el.text = value


def sort_cells(row_el: ET.Element) -> None:
    cells = list(row_el)
    cells.sort(key=lambda c: col_number(re.findall(r"[A-Z]+", c.attrib.get("r", "A"))[0]))
    row_el[:] = cells


def col_number(col: str) -> int:
    n = 0
    for ch in col:
        n = n * 26 + ord(ch) - 64
    return n


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    write_docx(OUT_DIR / "智能充电桩调度计费系统概要设计说明书_已填写.docx")
    fill_xlsx(TEMPLATE_XLSX, OUT_DIR / "作业验收用例（包含参数说明）_已填写.xlsx")
    print(OUT_DIR)


if __name__ == "__main__":
    main()
