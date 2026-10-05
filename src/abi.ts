// BEP-677 on BSC adopts EIP-8056 (Scaled UI Amount) and adds IERC8056Scheduled.
// Note that balanceOf and totalSupply stay RAW by spec; the share count users
// should see is raw * uiMultiplier / 1e18.
export const bep677Abi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },

  { type: "function", name: "uiMultiplier", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "newUIMultiplier", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "effectiveAt", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "toUIAmount", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "fromUIAmount", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOfUI", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalSupplyUI", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "pendingMultiplier",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "multiplier", type: "uint256" }, { name: "effectiveAt", type: "uint256" }],
  },
  { type: "function", name: "hasPendingMultiplier", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "supportsInterface", stateMutability: "view", inputs: [{ type: "bytes4" }], outputs: [{ type: "bool" }] },

  {
    type: "event",
    name: "UIMultiplierUpdated",
    inputs: [
      { name: "oldMultiplier", type: "uint256", indexed: false },
      { name: "newMultiplier", type: "uint256", indexed: false },
      { name: "effectiveAtTimestamp", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TransferWithUIAmount",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "uiAmount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "UIMultiplierChangeOverwritten",
    inputs: [
      { name: "overwrittenMultiplier", type: "uint256", indexed: false },
      { name: "overwrittenEffectiveAt", type: "uint256", indexed: false },
      { name: "newMultiplier", type: "uint256", indexed: false },
      { name: "newEffectiveAt", type: "uint256", indexed: false },
    ],
  },
] as const;

// For a single-function interface the ERC-165 id is just that function's
// selector, which is why IScaledUIAmount and uiMultiplier() share a value.
export const INTERFACE_IDS = {
  IScaledUIAmount: "0xa60bf13d",
  IScaledUIAmountNewUIMultiplier: "0x4bd27648",
  IScaledUIAmountConversion: "0x57854fc3",
  IScaledUIAmountBalances: "0xd890fd71",
  IERC8056Scheduled: "0xeb0093dd",
} as const;
