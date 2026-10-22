/** Market data types — ported from @bestprice/db types.ts
 *  All prices stored as integers in cents to avoid floating point. */

export interface Retailer {
  id: string;
  name: string;
  slug: string;
  baseUrl: string;
  affiliateNetwork: string | null;
  affiliateTag: string | null;
  logoUrl: string | null;
  active: boolean;
  createdAt: Date;
}

export interface Product {
  id: string;
  ean: string | null;
  name: string;
  brand: string | null;
  category: string | null;
  subcategory: string | null;
  unitOfMeasure: string | null;
  unitSize: number | null;
  imageUrl: string | null;
  manufacturerId: string | null;
  originCountry: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PriceObservation {
  id: string;
  productId: string;
  retailerId: string;
  priceCents: number;
  wasPrice: number | null;
  unitPriceCents: number | null;
  unitPriceUnit: string | null;
  inStock: boolean;
  productUrl: string;
  deliveryCents: number | null;
  promotionText: string | null;
  observedAt: Date;
}

export type VerificationLevel = "Inferred" | "Corroborated" | "Confirmed" | "Audited";

export interface Manufacturer {
  id: string;
  name: string;
  country: string | null;
  factoryCity: string | null;
  factoryCountry: string | null;
  abn: string | null;
  acn: string | null;
  gs1Prefix: string | null;
  verificationLevel: VerificationLevel;
  createdAt: Date;
  updatedAt: Date;
}

export interface ManufacturerEvidence {
  id: string;
  manufacturerId: string;
  productId: string | null;
  source: string;
  detail: string;
  evidenceUrl: string | null;
  verificationLevel: VerificationLevel;
  submittedBy: string | null;
  verifiedAt: Date | null;
  createdAt: Date;
}

export interface AffiliateConversion {
  id: string;
  retailerId: string;
  productId: string | null;
  clickedAt: Date;
  convertedAt: Date | null;
  orderValueCents: number | null;
  commissionCents: number | null;
  sessionId: string;
}

export interface RankedPrice {
  productId: string;
  retailerSlug: string;
  retailerName: string;
  priceCents: number;
  deliveryCents: number;
  totalCents: number;
  unitPriceCents: number | null;
  unitPriceUnit: string | null;
  inStock: boolean;
  productUrl: string;
  promotionText: string | null;
}

export type ContributionType =
  | "price_verification"
  | "price_correction"
  | "new_product"
  | "manufacturer_info"
  | "product_review";

export interface MarketAgent {
  id: string;
  externalId: string | null;
  pactAgentId: string | null;
  name: string | null;
  creditsBalance: number;
  totalContributions: number;
  contributorTier: ContributorTier;
  registeredAt: Date;
  lastActiveAt: Date;
}

export type ContributorTier = "anonymous" | "active" | "trusted" | "verified";

export interface AgentContribution {
  id: string;
  agentId: string;
  contributionType: ContributionType;
  productId: string | null;
  retailerId: string | null;
  data: Record<string, unknown>;
  creditsEarned: number;
  createdAt: Date;
}

export interface ProductReview {
  id: string;
  agentId: string;
  productId: string;
  rating: number;
  signal: "excellent" | "good" | "average" | "poor" | "defective";
  comment: string | null;
  createdAt: Date;
}

export type AnalyticsTier = "free" | "pro" | "enterprise";

export interface RetailerAccount {
  id: string;
  retailerId: string;
  contactEmail: string;
  tier: AnalyticsTier;
  apiKeyHash: string | null;
  createdAt: Date;
}

export interface SearchEvent {
  id: string;
  query: string;
  category: string | null;
  resultCount: number;
  winningRetailerId: string | null;
  agentId: string | null;
  createdAt: Date;
}

// Fuel types

export interface FuelPriceResult {
  stationId: string;
  stationName: string;
  brandName: string | null;
  address: string | null;
  suburb: string | null;
  state: string;
  fuelType: string;
  priceCpl: number;
  latitude: number | null;
  longitude: number | null;
  observedAt: Date;
}

export interface FuelStationInput {
  sourceId: string;
  source: string;
  brandName: string | null;
  name: string;
  address: string | null;
  suburb: string | null;
  state: string;
  postcode: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  features: string | null;
}

export interface PriceObservationInput {
  productId: string;
  retailerId: string;
  priceCents: number;
  wasPriceCents: number | null;
  unitPriceCents: number | null;
  unitPriceUnit: string | null;
  inStock: boolean;
  productUrl: string;
  deliveryCents: number | null;
  promotionText: string | null;
}

export interface PriceCandidate {
  productId: string;
  retailerSlug: string;
  retailerName: string;
  priceCents: number;
  deliveryCents: number;
  unitPriceCents: number | null;
  unitPriceUnit: string | null;
  inStock: boolean;
  productUrl: string;
  promotionText: string | null;
}

export interface CartItem {
  productId: string;
  name: string;
  quantity: number;
}

export interface CartSolution {
  retailerOrders: Array<{
    retailerSlug: string;
    retailerName: string;
    items: Array<{
      productId: string;
      name: string;
      quantity: number;
      priceCents: number;
    }>;
    subtotalCents: number;
    deliveryCents: number;
    totalCents: number;
  }>;
  grandTotalCents: number;
  singleRetailerCostCents: number;
  savingsCents: number;
}
