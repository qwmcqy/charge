# Timeline 测试标准输出说明

## 标准输出

```text
Stations: F-001=available F-002=available F-003=fault S-001=fault S-002=available
Departed:25 Paid:25 V3Parked:true
Checks: UnpaidBills:0 ActiveQueueEntries:0
Done
```

## 排队顺序

```text
直充：V1 -> V2 -> V3 -> V4
排队/等候：V5 -> V1故障优先 -> V6 -> V4故障优先 -> V7 -> V8 -> V9 -> V10 -> V11 -> V12 -> V13 -> V14 -> V15 -> V16 -> V17 -> V18 -> V19 -> V20 -> V21 -> V22 -> V23 -> V24 -> V25 -> V26 -> V27 -> V28
```

说明：

- V7、V11 后续取消成功。
- V2 取消失败是预期行为，不算 bug。
- V3 作为停车费演示，保持 parked 状态等待手动离场。

## 结算顺序

```text
V25 -> V21 -> V19 -> V18 -> V2 -> V27 -> V20 -> V9 -> V23 -> V22 -> V5 -> V24 -> V14 -> V26 -> V6 -> V17 -> V28 -> V15 -> V4 -> V10 -> V8 -> V1 -> V16 -> V12 -> V13
```

## 验收结论

符合当前测试用例要求。最新 CSV 只描述操作，实际排队和结算结果以运行时为准；关键验收点是所有非 V3 离场账单支付完成、未付账单为 0、活跃队列为 0，V3 保持停车状态。
