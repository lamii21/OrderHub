export type Order = {
  id: number;
  shop_id: number | null;
  order_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_city: string | null;
  customer_address: string | null;
  product: string | null;
  quantity: number | null;
  price: number | null;
  status: string;
  created_at: string;
  shops: { name: string; platform: string } | null;
};
