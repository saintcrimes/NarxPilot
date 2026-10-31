export type Role = 'buyer' | 'supplier' | 'admin';
export type Actor = { userId: string; organizationId: string; role: Role };
export type Origin = 'synthetic' | 'live';
export type OrderStatus = 'REQUESTED' | 'QUOTED' | 'RESERVED' | 'SHIPPED' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED' | 'DISPUTED' | 'REJECTED';
export type Snapshot = {
  skuId: string; offerId: string; offerVersion: number; warehouseId: string;
  supplierId: string; quantity: number; unitPrice: string; delivery: string;
  fees: string; total: string; currency: 'UZS'; paymentTerms: 'bank_transfer';
  priceBasis: 'seller_final'; channel: 'B2B'; warranty: string; location: string;
  deliveryDays: number; capturedAt: string;
};
