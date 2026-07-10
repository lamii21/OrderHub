export type Order = {
  id: number;
  shop_id: number | null;
  order_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_city: string | null;
  customer_address: string | null;
  customer_email: string | null;
  product: string | null;
  product_id: number | null;
  quantity: number | null;
  price: number | null;
  status: string;
  tags: string[];
  archived_at: string | null;
  created_at: string;
  shops: { name: string; platform: string } | null;
};
