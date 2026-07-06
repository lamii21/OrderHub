"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { CHART_COLORS } from "./colors";

export type OrdersPerDayPoint = { day: string; orders_count: number };

export function OrdersPerDayChart({ data }: { data: OrdersPerDayPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
        <XAxis
          dataKey="day"
          tickFormatter={(value) =>
            new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" })
          }
          tick={{ fill: CHART_COLORS.mutedText, fontSize: 12 }}
          axisLine={{ stroke: CHART_COLORS.axis }}
          tickLine={false}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fill: CHART_COLORS.mutedText, fontSize: 12 }}
          axisLine={{ stroke: CHART_COLORS.axis }}
          tickLine={false}
          width={32}
        />
        <Tooltip
          formatter={(value) => [value, "Orders"]}
          labelFormatter={(value) => new Date(value).toLocaleDateString()}
        />
        <Line
          type="monotone"
          dataKey="orders_count"
          stroke={CHART_COLORS.series}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
