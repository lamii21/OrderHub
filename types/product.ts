export type Product = {
  id: number;
  shop_id: number | null;
  name: string;
  sku: string | null;
  description: string | null;
  price: number | null;
  stock_quantity: number | null;
  created_at: string;
  shop_name: string | null;
  platform: string | null;
  total_orders: number | string;
  total_revenue: number | string;
};
