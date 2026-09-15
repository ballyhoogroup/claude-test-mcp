export type Industry = "fintech" | "agtech" | "martech" | "femtech";

export interface Company {
  /** Unique identifier for the company record. */
  id: string;
  name: string;
  industry: Industry;
  valuationUsd: number;
  location: string;
}

/** 100 fictional companies used as demo data for this MCP server. */
export const companies: Company[] = [
  {
    id: "co-001",
    name: "CashGrid",
    industry: "fintech",
    valuationUsd: 840000000,
    location: "Boston, USA"
  },
  {
    id: "co-002",
    name: "CoinWave",
    industry: "fintech",
    valuationUsd: 8310000000,
    location: "Sydney, Australia"
  },
  {
    id: "co-003",
    name: "PayLoop",
    industry: "fintech",
    valuationUsd: 301000000,
    location: "Stockholm, Sweden"
  },
  {
    id: "co-004",
    name: "CashWave",
    industry: "fintech",
    valuationUsd: 66900000,
    location: "Amsterdam, Netherlands"
  },
  {
    id: "co-005",
    name: "BankLy",
    industry: "fintech",
    valuationUsd: 64600000,
    location: "Lagos, Nigeria"
  },
  {
    id: "co-006",
    name: "VaultLy",
    industry: "fintech",
    valuationUsd: 79300000,
    location: "Paris, France"
  },
  {
    id: "co-007",
    name: "CapitalPath",
    industry: "fintech",
    valuationUsd: 85700000,
    location: "Paris, France"
  },
  {
    id: "co-008",
    name: "CapitalLoop",
    industry: "fintech",
    valuationUsd: 74400000,
    location: "Tokyo, Japan"
  },
  {
    id: "co-009",
    name: "CoinHub",
    industry: "fintech",
    valuationUsd: 38230000000,
    location: "Denver, USA"
  },
  {
    id: "co-010",
    name: "FundBridge",
    industry: "fintech",
    valuationUsd: 540000000,
    location: "Chicago, USA"
  },
  {
    id: "co-011",
    name: "CreditBridge",
    industry: "fintech",
    valuationUsd: 71500000,
    location: "Sydney, Australia"
  },
  {
    id: "co-012",
    name: "BankLoop",
    industry: "fintech",
    valuationUsd: 32800000,
    location: "Amsterdam, Netherlands"
  },
  {
    id: "co-013",
    name: "CreditSphere",
    industry: "fintech",
    valuationUsd: 27900000,
    location: "Shanghai, China"
  },
  {
    id: "co-014",
    name: "WireBridge",
    industry: "fintech",
    valuationUsd: 990000000,
    location: "Seattle, USA"
  },
  {
    id: "co-015",
    name: "FundGrid",
    industry: "fintech",
    valuationUsd: 58500000,
    location: "London, UK"
  },
  {
    id: "co-016",
    name: "WireWave",
    industry: "fintech",
    valuationUsd: 491000000,
    location: "Stockholm, Sweden"
  },
  {
    id: "co-017",
    name: "BankBridge",
    industry: "fintech",
    valuationUsd: 459000000,
    location: "Amsterdam, Netherlands"
  },
  {
    id: "co-018",
    name: "LedgerPath",
    industry: "fintech",
    valuationUsd: 14420000000,
    location: "Zurich, Switzerland"
  },
  {
    id: "co-019",
    name: "FundFlow",
    industry: "fintech",
    valuationUsd: 592000000,
    location: "Bangalore, India"
  },
  {
    id: "co-020",
    name: "PaySphere",
    industry: "fintech",
    valuationUsd: 37300000,
    location: "London, UK"
  },
  {
    id: "co-021",
    name: "BankHub",
    industry: "fintech",
    valuationUsd: 68200000,
    location: "Denver, USA"
  },
  {
    id: "co-022",
    name: "PayGrid",
    industry: "fintech",
    valuationUsd: 70500000,
    location: "Berlin, Germany"
  },
  {
    id: "co-023",
    name: "CapitalFlow",
    industry: "fintech",
    valuationUsd: 36200000,
    location: "New York, USA"
  },
  {
    id: "co-024",
    name: "VaultLoop",
    industry: "fintech",
    valuationUsd: 287000000,
    location: "Zurich, Switzerland"
  },
  {
    id: "co-025",
    name: "LedgerStack",
    industry: "fintech",
    valuationUsd: 741000000,
    location: "São Paulo, Brazil"
  },
  {
    id: "co-026",
    name: "TerraNest",
    industry: "agtech",
    valuationUsd: 15000000,
    location: "Austin, USA"
  },
  {
    id: "co-027",
    name: "CropVerde",
    industry: "agtech",
    valuationUsd: 31600000,
    location: "Seoul, South Korea"
  },
  {
    id: "co-028",
    name: "CropSprout",
    industry: "agtech",
    valuationUsd: 605000000,
    location: "Shanghai, China"
  },
  {
    id: "co-029",
    name: "HarvestGrow",
    industry: "agtech",
    valuationUsd: 43700000,
    location: "Amsterdam, Netherlands"
  },
  {
    id: "co-030",
    name: "TerraSprout",
    industry: "agtech",
    valuationUsd: 83000000,
    location: "Singapore"
  },
  {
    id: "co-031",
    name: "RootSprout",
    industry: "agtech",
    valuationUsd: 93000000,
    location: "Mexico City, Mexico"
  },
  {
    id: "co-032",
    name: "SoilGrow",
    industry: "agtech",
    valuationUsd: 54700000,
    location: "Nairobi, Kenya"
  },
  {
    id: "co-033",
    name: "FieldWorks",
    industry: "agtech",
    valuationUsd: 29080000000,
    location: "Bangalore, India"
  },
  {
    id: "co-034",
    name: "GrainFresh",
    industry: "agtech",
    valuationUsd: 13790000000,
    location: "Zurich, Switzerland"
  },
  {
    id: "co-035",
    name: "PastureAg",
    industry: "agtech",
    valuationUsd: 23540000000,
    location: "Seoul, South Korea"
  },
  {
    id: "co-036",
    name: "HarvestLoop",
    industry: "agtech",
    valuationUsd: 591000000,
    location: "Shanghai, China"
  },
  {
    id: "co-037",
    name: "BloomSprout",
    industry: "agtech",
    valuationUsd: 32430000000,
    location: "Berlin, Germany"
  },
  {
    id: "co-038",
    name: "GrainYield",
    industry: "agtech",
    valuationUsd: 701000000,
    location: "Nairobi, Kenya"
  },
  {
    id: "co-039",
    name: "RootAg",
    industry: "agtech",
    valuationUsd: 890000000,
    location: "Berlin, Germany"
  },
  {
    id: "co-040",
    name: "HarvestYield",
    industry: "agtech",
    valuationUsd: 17940000000,
    location: "Amsterdam, Netherlands"
  },
  {
    id: "co-041",
    name: "RootGrow",
    industry: "agtech",
    valuationUsd: 853000000,
    location: "Mumbai, India"
  },
  {
    id: "co-042",
    name: "FarmNest",
    industry: "agtech",
    valuationUsd: 29350000000,
    location: "Seattle, USA"
  },
  {
    id: "co-043",
    name: "CropNest",
    industry: "agtech",
    valuationUsd: 94500000,
    location: "Zurich, Switzerland"
  },
  {
    id: "co-044",
    name: "SoilNest",
    industry: "agtech",
    valuationUsd: 64800000,
    location: "Tel Aviv, Israel"
  },
  {
    id: "co-045",
    name: "BloomFresh",
    industry: "agtech",
    valuationUsd: 743000000,
    location: "Chicago, USA"
  },
  {
    id: "co-046",
    name: "SoilLoop",
    industry: "agtech",
    valuationUsd: 38000000000,
    location: "Singapore"
  },
  {
    id: "co-047",
    name: "CropWorks",
    industry: "agtech",
    valuationUsd: 165000000,
    location: "Zurich, Switzerland"
  },
  {
    id: "co-048",
    name: "FarmSense",
    industry: "agtech",
    valuationUsd: 28690000000,
    location: "Stockholm, Sweden"
  },
  {
    id: "co-049",
    name: "FarmWorks",
    industry: "agtech",
    valuationUsd: 654000000,
    location: "Sydney, Australia"
  },
  {
    id: "co-050",
    name: "GrainSense",
    industry: "agtech",
    valuationUsd: 139000000,
    location: "Chicago, USA"
  },
  {
    id: "co-051",
    name: "ReachIQ",
    industry: "martech",
    valuationUsd: 26400000,
    location: "Barcelona, Spain"
  },
  {
    id: "co-052",
    name: "PixelLoop",
    industry: "martech",
    valuationUsd: 19280000000,
    location: "Zurich, Switzerland"
  },
  {
    id: "co-053",
    name: "Brandify",
    industry: "martech",
    valuationUsd: 52900000,
    location: "New York, USA"
  },
  {
    id: "co-054",
    name: "Signalify",
    industry: "martech",
    valuationUsd: 15910000000,
    location: "Stockholm, Sweden"
  },
  {
    id: "co-055",
    name: "SparkMetrics",
    industry: "martech",
    valuationUsd: 53400000,
    location: "New York, USA"
  },
  {
    id: "co-056",
    name: "CampaignHub",
    industry: "martech",
    valuationUsd: 158000000,
    location: "São Paulo, Brazil"
  },
  {
    id: "co-057",
    name: "ReachWave",
    industry: "martech",
    valuationUsd: 27970000000,
    location: "Dubai, UAE"
  },
  {
    id: "co-058",
    name: "Campaignify",
    industry: "martech",
    valuationUsd: 60800000,
    location: "Singapore"
  },
  {
    id: "co-059",
    name: "BrandIQ",
    industry: "martech",
    valuationUsd: 561000000,
    location: "Zurich, Switzerland"
  },
  {
    id: "co-060",
    name: "TrendStack",
    industry: "martech",
    valuationUsd: 619000000,
    location: "San Francisco, USA"
  },
  {
    id: "co-061",
    name: "ReachStack",
    industry: "martech",
    valuationUsd: 103000000,
    location: "Seoul, South Korea"
  },
  {
    id: "co-062",
    name: "PixelIQ",
    industry: "martech",
    valuationUsd: 41200000,
    location: "Sydney, Australia"
  },
  {
    id: "co-063",
    name: "SparkBoost",
    industry: "martech",
    valuationUsd: 12440000000,
    location: "Mumbai, India"
  },
  {
    id: "co-064",
    name: "AudienceStack",
    industry: "martech",
    valuationUsd: 19950000000,
    location: "New York, USA"
  },
  {
    id: "co-065",
    name: "BrandPulse",
    industry: "martech",
    valuationUsd: 545000000,
    location: "Dublin, Ireland"
  },
  {
    id: "co-066",
    name: "ReachLoop",
    industry: "martech",
    valuationUsd: 778000000,
    location: "Boston, USA"
  },
  {
    id: "co-067",
    name: "Pixelify",
    industry: "martech",
    valuationUsd: 636000000,
    location: "Mexico City, Mexico"
  },
  {
    id: "co-068",
    name: "TrendIQ",
    industry: "martech",
    valuationUsd: 20650000000,
    location: "San Francisco, USA"
  },
  {
    id: "co-069",
    name: "SparkWave",
    industry: "martech",
    valuationUsd: 3550000000,
    location: "Barcelona, Spain"
  },
  {
    id: "co-070",
    name: "PixelPulse",
    industry: "martech",
    valuationUsd: 714000000,
    location: "Singapore"
  },
  {
    id: "co-071",
    name: "SignalWave",
    industry: "martech",
    valuationUsd: 867000000,
    location: "Tokyo, Japan"
  },
  {
    id: "co-072",
    name: "ReachMetrics",
    industry: "martech",
    valuationUsd: 41160000000,
    location: "Shanghai, China"
  },
  {
    id: "co-073",
    name: "ClickMetrics",
    industry: "martech",
    valuationUsd: 40250000000,
    location: "Dubai, UAE"
  },
  {
    id: "co-074",
    name: "FunnelWave",
    industry: "martech",
    valuationUsd: 16000000,
    location: "Shanghai, China"
  },
  {
    id: "co-075",
    name: "FunnelScope",
    industry: "martech",
    valuationUsd: 52200000,
    location: "Lagos, Nigeria"
  },
  {
    id: "co-076",
    name: "AuraWell",
    industry: "femtech",
    valuationUsd: 21600000,
    location: "Berlin, Germany"
  },
  {
    id: "co-077",
    name: "VitaPath",
    industry: "femtech",
    valuationUsd: 21740000000,
    location: "Shanghai, China"
  },
  {
    id: "co-078",
    name: "CycleCare",
    industry: "femtech",
    valuationUsd: 66700000,
    location: "Mumbai, India"
  },
  {
    id: "co-079",
    name: "MiraGlow",
    industry: "femtech",
    valuationUsd: 11270000000,
    location: "Mexico City, Mexico"
  },
  {
    id: "co-080",
    name: "LunaLife",
    industry: "femtech",
    valuationUsd: 93100000,
    location: "Berlin, Germany"
  },
  {
    id: "co-081",
    name: "BrightCare",
    industry: "femtech",
    valuationUsd: 451000000,
    location: "Denver, USA"
  },
  {
    id: "co-082",
    name: "VitaHealth",
    industry: "femtech",
    valuationUsd: 93000000,
    location: "Mumbai, India"
  },
  {
    id: "co-083",
    name: "BloomPath",
    industry: "femtech",
    valuationUsd: 53900000,
    location: "Amsterdam, Netherlands"
  },
  {
    id: "co-084",
    name: "MiraLife",
    industry: "femtech",
    valuationUsd: 259000000,
    location: "Bangalore, India"
  },
  {
    id: "co-085",
    name: "CycleGlow",
    industry: "femtech",
    valuationUsd: 28020000000,
    location: "Singapore"
  },
  {
    id: "co-086",
    name: "CyclePath",
    industry: "femtech",
    valuationUsd: 25080000000,
    location: "Nairobi, Kenya"
  },
  {
    id: "co-087",
    name: "BloomLife",
    industry: "femtech",
    valuationUsd: 668000000,
    location: "Dublin, Ireland"
  },
  {
    id: "co-088",
    name: "BrightWell",
    industry: "femtech",
    valuationUsd: 694000000,
    location: "Mumbai, India"
  },
  {
    id: "co-089",
    name: "LunaPath",
    industry: "femtech",
    valuationUsd: 256000000,
    location: "San Francisco, USA"
  },
  {
    id: "co-090",
    name: "CycleBridge",
    industry: "femtech",
    valuationUsd: 444000000,
    location: "Berlin, Germany"
  },
  {
    id: "co-091",
    name: "AuraLife",
    industry: "femtech",
    valuationUsd: 19300000,
    location: "Tokyo, Japan"
  },
  {
    id: "co-092",
    name: "MiraBloom",
    industry: "femtech",
    valuationUsd: 11900000,
    location: "Dublin, Ireland"
  },
  {
    id: "co-093",
    name: "NovaPath",
    industry: "femtech",
    valuationUsd: 223000000,
    location: "Sydney, Australia"
  },
  {
    id: "co-094",
    name: "BloomVita",
    industry: "femtech",
    valuationUsd: 33100000,
    location: "Mumbai, India"
  },
  {
    id: "co-095",
    name: "BrightCircle",
    industry: "femtech",
    valuationUsd: 39500000,
    location: "Mumbai, India"
  },
  {
    id: "co-096",
    name: "BloomCircle",
    industry: "femtech",
    valuationUsd: 834000000,
    location: "Austin, USA"
  },
  {
    id: "co-097",
    name: "BrightBloom",
    industry: "femtech",
    valuationUsd: 39100000,
    location: "Lagos, Nigeria"
  },
  {
    id: "co-098",
    name: "AuraPath",
    industry: "femtech",
    valuationUsd: 40070000000,
    location: "Dublin, Ireland"
  },
  {
    id: "co-099",
    name: "BrightBridge",
    industry: "femtech",
    valuationUsd: 67500000,
    location: "Mumbai, India"
  },
  {
    id: "co-100",
    name: "NestCircle",
    industry: "femtech",
    valuationUsd: 39550000000,
    location: "Stockholm, Sweden"
  }
];
