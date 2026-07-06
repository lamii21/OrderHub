"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { CHART_COLORS } from "./colors";

export type RevenueByCityPoint = { city: string; orders_count: number; revenue: number };

export function RevenueByCityChart({ data }: { data: RevenueByCityPoint[] }) {
  const height = Math.max(280, data.length * 36);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
        <CartesianGrid horizontal={false} stroke={CHART_COLORS.grid} />
        <XAxis
          type="number"
          tickFormatter={(value) => Number(value).toLocaleString()}
          tick={{ fill: CHART_COLORS.mutedText, fontSize: 12 }}
          axisLine={{ stroke: CHART_COLORS.axis }}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="city"
          width={100}
          tick={{ fill: CHART_COLORS.mutedText, fontSize: 12 }}
          axisLine={{ stroke: CHART_COLORS.axis }}
          tickLine={false}
        />
        <Tooltip formatter={(value) => [Number(value).toFixed(2), "Revenue"]} />
        <Bar dataKey="revenue" fill={CHART_COLORS.series} radius={[0, 4, 4, 0]} barSize={20} />
      </BarChart>
    </ResponsiveContainer>
  );
}
