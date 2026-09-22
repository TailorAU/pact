/**
 * Affiliate Engine — ported from @bestprice/affiliate
 *
 * INTEGRITY: Runs POST-ranking. Never influences sort order.
 * The ranking module does not import or depend on this module.
 */

export interface AffiliateConfig {
  retailerSlug: string;
  network: string;
  tag: string;
  urlPattern: (originalUrl: string, tag: string) => string;
}

const affiliateConfigs: AffiliateConfig[] = [
  {
    retailerSlug: "amazon-au",
    network: "Amazon Associates",
    tag: process.env.AMAZON_AFFILIATE_TAG ?? "bestprice-au-22",
    urlPattern: (url, tag) => {
      const u = new URL(url);
      u.searchParams.set("tag", tag);
      return u.toString();
    },
  },
  {
    retailerSlug: "coles",
    network: "Commission Factory",
    tag: process.env.CF_COLES_TAG ?? "",
    urlPattern: (url, tag) =>
      tag ? `https://t.cfjump.com/42498/t/${tag}?Url=${encodeURIComponent(url)}` : url,
  },
  {
    retailerSlug: "woolworths",
    network: "Commission Factory",
    tag: process.env.CF_WOOLWORTHS_TAG ?? "",
    urlPattern: (url, tag) =>
      tag ? `https://t.cfjump.com/42498/t/${tag}?Url=${encodeURIComponent(url)}` : url,
  },
  {
    retailerSlug: "chemist-wh",
    network: "Commission Factory",
    tag: process.env.CF_CHEMIST_TAG ?? "",
    urlPattern: (url, tag) =>
      tag ? `https://t.cfjump.com/42498/t/${tag}?Url=${encodeURIComponent(url)}` : url,
  },
  {
    retailerSlug: "kmart",
    network: "Commission Factory",
    tag: process.env.CF_KMART_TAG ?? "",
    urlPattern: (url, tag) =>
      tag ? `https://t.cfjump.com/42498/t/${tag}?Url=${encodeURIComponent(url)}` : url,
  },
  {
    retailerSlug: "ebay-au",
    network: "eBay Partner Network",
    tag: process.env.EBAY_CAMPAIGN_ID ?? "",
    urlPattern: (url, tag) => {
      if (!tag) return url;
      const u = new URL("https://rover.ebay.com/rover/1/705-53470-19255-0/1");
      u.searchParams.set("campid", tag);
      u.searchParams.set("mpre", url);
      u.searchParams.set("toolid", "10001");
      return u.toString();
    },
  },
];

const configByRetailer = new Map(affiliateConfigs.map((c) => [c.retailerSlug, c]));

export function applyAffiliateTag(retailerSlug: string, originalUrl: string): string {
  const config = configByRetailer.get(retailerSlug);
  if (!config || !config.tag) return originalUrl;
  return config.urlPattern(originalUrl, config.tag);
}

export function tagRankedResults<T extends { retailerSlug: string; productUrl: string }>(
  results: T[]
): (T & { affiliateUrl: string })[] {
  return results.map((r) => ({
    ...r,
    affiliateUrl: applyAffiliateTag(r.retailerSlug, r.productUrl),
  }));
}
