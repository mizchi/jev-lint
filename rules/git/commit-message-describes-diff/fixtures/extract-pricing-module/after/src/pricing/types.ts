export interface CartItem {
  sku: string;
  priceCents: number;
  quantity: number;
  taxable: boolean;
}

export interface Address {
  country: string;
  region: string;
}
