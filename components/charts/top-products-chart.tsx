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

export type TopProductPoint = { product: string; quantity_sold: number; revenue: number };

export function TopProductsChart({ data }: { data: TopProductPoint[] }) {
  const height = Math.max(280, data.length * 36);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
        <CartesianGrid horizontal={false} stroke={CHART_COLORS.grid} />
        <XAxis
          type="number"
          allowDecimals={false}
          tick={{ fill: CHART_COLORS.mutedText, fontSize: 12 }}
          axisLine={{ stroke: CHART_COLORS.axis }}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="product"
          width={120}
          tick={{ fill: CHART_COLORS.mutedText, fontSize: 12 }}
          axisLine={{ stroke: CHART_COLORS.axis }}
          tickLine={false}
        />
        <Tooltip formatter={(value) => [value, "Units sold"]} />
        <Bar dataKey="quantity_sold" fill={CHART_COLORS.series} radius={[0, 4, 4, 0]} barSize={20} />
      </BarChart>
    </ResponsiveContainer>
  );
}
