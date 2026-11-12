# 插件测试 fixture

脱敏样本，形状对齐阶段 0 真机响应。

- `new_post_total_data.sample.json`：账号级全部视频聚合，2026-11-12 补全「全部(999)」分组（各来源逐日求和），避免「缺 999」被误读为「只取关注来源」（审查 P2-27）。
- `fans_trend.sample.json`：官方平铺结构（`fansDataByTabtype[].add`），来源趋势解析用例依赖此形状。
