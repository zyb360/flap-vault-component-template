"use client";

import { useEffect, useRef, useState, type Dispatch, type FormEvent, type ReactNode, type SetStateAction } from "react";
import { AlertCircle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, Check, CheckCircle2, ChevronDown, ChevronRight, CircleUserRound, Clock, Coins, ImageIcon, Info, LayoutGrid, Menu, Minus, Plus, Radio, Rocket, Search, ShieldCheck, Users, Wallet, X, Zap } from "lucide-react";
import { useFlapSdk, useMiniAppSdk, ZERO_ADDRESS, erc20Abi, type FlapChainSdk } from "@/src/sdk";
import { Alert, Button, CopyButton, Input, IpfsImage } from "@/src/ui";
import { bytesToHex, decodeErrorResult, encodeAbiParameters, encodeFunctionData, parseAbiParameters, decodeEventLog, formatUnits, getContractAddress, isAddress, keccak256, parseAbi, parseUnits, toBytes, type Address, type Hex, } from "viem";
import Decimal from "decimal.js";

// Pre-pinned token metadata JSON and the image CID inside its `image` field.
// Clear DEFAULT_LAUNCH_METADATA_CID to build/upload metadata from the form instead.
const DEFAULT_LAUNCH_IMAGE_CID = "bafkreiavpvkx2gd7ahxsnar636lcofuphzjmjszhfm3leh5a7fd6bjhmxm";
const DEFAULT_LAUNCH_METADATA_CID = "bafkreiahnvjggy3y4s6akxmuipw6k3nw7qt4j5t255nfbu6jxtrl7oduv4";
const chainId = 97;
const PORTAL_ADDRESS = "0x000042108465206185A077Edc3F3fd2b49060000" as Address;
const PREPARATION_FACTORY_ADDRESS = "0xBF2Ca33C375A4bF865feA4bc11B570511a5586A8" as Address;
const LAUNCHPAD_ADDRESS = "0xE3254AB9Ae356F1a520640E97b0de0f7a79cc915" as Address;
const STAKE_FARM_ADDRESS = "0xf95fBc44ac4AA8d735473AE3E8040CF1A43807D0" as Address;
const RELATION_ADDRESS = "0x23844242c1FeDB294Ce22F492cD5F9e330F66c38" as Address;
const ENERGY_TOKEN_ADDRESS = "0xF965F2f986F09C06De80c676985a8D63E669795f" as Address;
const REWARD_FACTORY_ADDRESS = "0x84561Bd8cBe19a59E29f6D7C09DEcF59E716Aa91" as Address;
const PREPARATION_FACTORY_ID = "preparation-factory";
const LAUNCHPAD_CONTRACT_ID = "launchpad";
const STAKE_FARM_CONTRACT_ID = "stakefarm";
const RELATION_CONTRACT_ID = "relation";
const REWARD_FACTORY_ID = "reward-distributor-factory";

function launchAddress(sdk: FlapChainSdk, id: string): Address {
  const entry = sdk.context.manifest.walletContracts?.find(item => item.id === id && item.chainId === sdk.context.chainId);
  if (!entry || !isAddress(entry.address) || entry.address.toLowerCase() === ZERO_ADDRESS) throw new Error("launchEnvironmentInvalid");
  return entry.address as Address;
}
const PORTAL_ABI = parseAbi([
  "function SALT_LOCK_FEE() view returns (uint256)",
  "function graduationFloorV2((address quoteToken,uint256 quotePriceUsd,uint256 poolQuote,uint256 poolToken,uint256 totalSupply,address vaultFactory) params) view returns ((bool meetsFloor,uint256 floorUsdWad,uint256 quoteUsdWad,uint16 multiplierBps,bool meetsCreateFloor,uint256 createFloorUsdWad) result)",
  "function launchQuoteConfig(uint8 kind,address quoteToken) view returns (bool enabled,uint256 quotePriceUsd)",
  "function quoteTokenCreationDisabled(address quoteToken) view returns (bool)",
  "function launcherFactoryMultiplier(address factory) view returns (bool enabled,uint16 multiplierBps)",
  "function newLauncher(address launcherFactory,bytes data) payable returns (address launcher)",
]);
const PREPARATION_FACTORY_ABI = parseAbi([
  "function flapTokenCreationCodeHash() view returns (bytes32)",
  "function launchPad() view returns (address)",
  "function portal() view returns (address)",
  "event PreparationCreated(address indexed preparation,address indexed creator)",
]);

type PaymentTokenGroup = "featured" | "stock" | "preIpo";
type PaymentTokenConfig = {
  symbol: string;
  name: string;
  imageCid: string;
  quoteIndex: number;
  decimals: number;
  group: PaymentTokenGroup;
  issuer?: string;
};

// Keep the catalog explicitly typed: optional categories may contain zero rows
// without narrowing their group out of the payment-picker implementation.
const paymentTokens: readonly PaymentTokenConfig[] = [
  { symbol: "BNB", name: "BNB", imageCid: "bafkreigqndf7kfutndj6e6ms2ic6pci7fi3wsch3nvxv5w5m6end6bmmme", quoteIndex: 0, decimals: 18, group: "featured" },
  {
    symbol: "M USDT", name: "Test Tether USD", imageCid: "bafkreie4ytbhfzqh3eaywefdaz4ex2vryoxfzprtcjjnh3uvm4cmvuray4", quoteIndex: 1, decimals: 18, group: "featured"
  },

  // Optional categories can add tokens by their reviewed acceptQuoteTokens index.
];
type PaymentTokenAddresses = Readonly<Record<number, Address>>;
// Optional presentation metadata follows the on-chain StakeFarm pool order.
// The first entry decorates pools()[0]; eligibility also follows pools()[0].
const allTokens = [
  {
    symbol: "SAUCE",
    imageCid: "bafybeic3gjfyagaqzxtylx33bdu7sulzvq4osfrfpvq33jsdt4pgekotb4",
  },
] as const;
const ENERGY_BALANCE_REFRESH_MS = 5_000;
const PROJECT_LIST_REFRESH_MS = 15_000;
const PROJECT_ROWS_PAGE_SIZE = 20;
const STAKE_HISTORY_PAGE_SIZE = 20;
const EXTRA_REWARD_PAGE_SIZE = 8;
const REWARD_DISCOVERY_BATCH_SIZE = 8;

const IDO_HISTORY_PAGE_SIZE = 20;
const IDO_HISTORY_CONCURRENCY = 4;
const MAX_ACCEPT_QUOTE_TOKENS = 128;
// Shared UI limits for token metadata and the corresponding bilingual project copy.
const LAUNCH_NAME_MAX_LENGTH = 24;
const LAUNCH_DESCRIPTION_MAX_LENGTH = 256;
// Two nested ABI-encoded structs are passed through Portal.newLauncher to the Preparation Factory.
const LAUNCHER_CONFIG_ABI = parseAbiParameters("((string name, string symbol, string meta, uint256 totalSupply, bytes32 salt, address quoteToken, uint8 dexId, uint256 poolQuote, uint256 poolToken, uint16 buyTaxRate, uint16 sellTaxRate, uint32 taxDuration, uint32 antiFarmerDuration, (uint8 feeType, uint16 bps, bytes configData)[] feeConfigs, uint8 antiSniperMode, uint32 exemptWindow, address[] exemptAddrs, uint256 creatorBuyQuote, bytes32 extensionID, bytes extensionData, address commissionReceiver) token, (uint256 minOutputAmount, bytes permitData) creatorBuy, (uint256 totalAmount, uint256 unitEnergyPrice, uint256 unitCashPrice, uint256 amountPerUnit, uint128 startTime, uint128 endTime, uint128 purchaseLimit, uint128 totalStock) ido, (string titleZh, string titleEn, string summaryZh, string summaryEn) description) config");
const LAUNCHPAD_ABI = parseAbi([
  "function acceptQuoteTokens(uint256) view returns (address)",
  "function energyToken() view returns (address)",
  "function flapPortal() view returns (address)",
  "function flapSaltLockFee() view returns (uint256)",
  "function isAcceptQuoteToken(address quoteToken) view returns (bool)",
  "function list() view returns (((bytes32 tokenDeploySalt, address tokenAddress, ((string name, string symbol, string meta, uint256 totalSupply, bytes32 salt, address quoteToken, uint8 dexId, uint256 poolQuote, uint256 poolToken, uint16 buyTaxRate, uint16 sellTaxRate, uint32 taxDuration, uint32 antiFarmerDuration, (uint8 feeType, uint16 bps, bytes configData)[] feeConfigs, uint8 antiSniperMode, uint32 exemptWindow, address[] exemptAddrs, uint256 creatorBuyQuote, bytes32 extensionID, bytes extensionData, address commissionReceiver) p, (uint8 target, address strategy, uint128 amount, bytes configData) distribution, (uint256 minOutputAmount, bytes permitData) creatorBuy) poolLaunchParams) project, (uint256 totalAmount, uint256 unitEnergyPrice, uint256 unitCashPrice, uint256 amountPerUnit, uint128 startTime, uint128 endTime, uint128 purchaseLimit, uint128 totalStock) config, (uint128 totalSoldCount, bool isFired) state)[])",
  "function preparationAt(uint256 i) view returns (address)",
  "function preparationFactory() view returns (address)",
  "function preparationIndexPlusOne(address) view returns (uint256)",
  "function preparations() view returns (address[])",
  "function purchaseIDO(uint256 preparationIndex, address idoToken, uint128 count, uint256 amount) payable"
]);
const IDO_PREPARATION_ABI = parseAbi([
  "function claimIDO()",
  "function creator() view returns (address)",
  "function creatorBuyRefunded() view returns (bool)",
  "function factory() view returns (address)",
  "function flapPortal() view returns (address)",
  "function hasClaimed(address) view returns (bool)",
  "function info() view returns (((bytes32 tokenDeploySalt, address tokenAddress, ((string name, string symbol, string meta, uint256 totalSupply, bytes32 salt, address quoteToken, uint8 dexId, uint256 poolQuote, uint256 poolToken, uint16 buyTaxRate, uint16 sellTaxRate, uint32 taxDuration, uint32 antiFarmerDuration, (uint8 feeType, uint16 bps, bytes configData)[] feeConfigs, uint8 antiSniperMode, uint32 exemptWindow, address[] exemptAddrs, uint256 creatorBuyQuote, bytes32 extensionID, bytes extensionData, address commissionReceiver) p, (uint8 target, address strategy, uint128 amount, bytes configData) distribution, (uint256 minOutputAmount, bytes permitData) creatorBuy) poolLaunchParams) project, (uint256 totalAmount, uint256 unitEnergyPrice, uint256 unitCashPrice, uint256 amountPerUnit, uint128 startTime, uint128 endTime, uint128 purchaseLimit, uint128 totalStock) config, (uint128 totalSoldCount, bool isFired) state))",
  "function isCapitalVerified() view returns (bool)",
  "function isRefundable() view returns (bool)",
  "function launchToken()",
  "function projectDescription() view returns (string titleZh, string titleEn, string summaryZh, string summaryEn)",
  "function purchasedOf(address) view returns (uint256 amount, uint256 energyAmount, uint128 count, bool isRedeemed)",
  "function redeemIDO()",
  "function refundCreatorBuy()",
  "function tokenAddress() view returns (address)"
]);
const STAKE_FARM_ABI = parseAbi([
  "function rewardDistributorFactory() view returns (address)",
  "function poolAt(uint256 i) view returns (address)",
  "function energyStakeThreshold() view returns (uint256)",
  "function accountInfoOf(address account, address token) view returns (((uint256 staked, uint256 debt, uint256 totalEarned) staticReward, (uint256 staked, uint256 debt, uint256 totalEarned) teamReward, uint256 totalUsedReward, uint256 rewardBalance, uint256 freezeQuota, bool isActive))",
  "function accountPendingEnergy(address account) view returns (uint256)",
  "function bindParent(address parent)",
  "function mintEnergy(address account) returns (uint256)",
  "function pendingRewardOf(address account, address token) view returns (uint256)",
  "function pools() view returns ((bool isDisable, address token, (uint48 apd, uint256 totalStaked, uint256 rewardPershare, uint256 totalEarnReward) staticState, (uint48 apd, uint256 totalStaked, uint256 rewardPershare, uint256 totalEarnReward) teamState, uint256 lastSettlementTime)[])",
  "function stake(address token, uint256 amount)",
  "function stakeInfoOf(address poolToken, address account) view returns (uint256 userStake, uint256 teamStake, uint256 poolTotal)",
  "function unstaked(address token, uint256 amount)"
]);
const REWARD_FACTORY_ABI = parseAbi([
  "function stakeFarm() view returns (address)",
  "function distributorCount() view returns (uint256)",
  "function distributors(uint256 index) view returns (address)",
]);
const REWARD_DISTRIBUTOR_ABI = parseAbi([
  "function rewardToken() view returns (address)",
  "function rewardTokenInfo() view returns (string name, string symbol, uint8 decimals)",
  "function metaCID() view returns (string)",
  "function startTime() view returns (uint64)",
  "function endTime() view returns (uint64)",
  "function rewardPerDay() view returns (uint256)",
  "function totalWeight() view returns (uint256)",
  "function isFunded() view returns (bool)",
  "function poolInfoOf(address poolToken) view returns (uint256 weight,uint256 rewardPerShare,uint256 accountedReward,uint256 unallocatedReward,uint256 poolRemainder,bool configured,bool finalized)",
  "function pendingRewardOf(address poolToken,address user) view returns (uint256)",
  "function claim(address poolToken) returns (uint256 amount)",
  "event RewardClaimed(address indexed poolToken,address indexed account,uint256 amount)",
]);
const RELATION_ABI = parseAbi([
  "function childrenCount(address parent) view returns (uint256)",
  "function childrenOf(address parent) view returns (address[])",
  "function parentOf(address) view returns (address)",
  "function root() view returns (address)",
  "function timestemp() view returns (uint256)"
]);
// Eligibility follows the first pool returned by StakeFarm; presentation assets
// in allTokens use that same pool order and never pin a token address.
function eligibilityStakePool(live: LiveStakeState): LiveStakePool | undefined {
  return live.status === "ready" ? live.rows[0] : undefined;
}
// Contract thresholds use 18 decimals. Convert only when comparing to a token's raw principal.
// Round the required raw principal UP if a token has fewer than 18 decimals.
function stakeThresholdInTokenUnits(live: LiveStakeState): bigint | null {
  const decimals = eligibilityStakePool(live)?.decimals;
  if (live.energyStakeThreshold === null || decimals == null) return null;
  const wad = 10n ** 18n;
  return (live.energyStakeThreshold * 10n ** BigInt(decimals) + wad - 1n) / wad;
}

async function readLaunchEnvironment(sdk: FlapChainSdk) {
  const portal = PORTAL_ADDRESS;
  const launchpad = LAUNCHPAD_ADDRESS;
  // Bind the configured Factory to the configured Portal and LaunchPad before building or submitting a launch.
  const [codeHash, factoryPortal, factoryLaunchPad] = await Promise.all([
    sdk.readContract<Hex>({ address: PREPARATION_FACTORY_ADDRESS, abi: PREPARATION_FACTORY_ABI, functionName: "flapTokenCreationCodeHash" }),
    sdk.readContract<Address>({ address: PREPARATION_FACTORY_ADDRESS, abi: PREPARATION_FACTORY_ABI, functionName: "portal" }),
    sdk.readContract<Address>({ address: PREPARATION_FACTORY_ADDRESS, abi: PREPARATION_FACTORY_ABI, functionName: "launchPad" }),
  ]);
  if (!/^0x[0-9a-f]{64}$/i.test(codeHash) || /^0x0{64}$/i.test(codeHash)) throw new Error("launchEnvironmentInvalid");
  if (factoryPortal.toLowerCase() !== portal.toLowerCase() || factoryLaunchPad.toLowerCase() !== launchpad.toLowerCase()) throw new Error("launchEnvironmentInvalid");
  return { portal, factory: PREPARATION_FACTORY_ADDRESS, launchpad, codeHash };
}
type Stage = "live" | "soon" | "ended";
type AppPage = "home" | "create" | "staking" | "mine";
type AppPanel = "guide" | "records" | "energy" | "wallet" | "launches";
// The preview package has one source entry point. Keep page views here as each section is migrated.
const menuPages: readonly AppPage[] = ["home", "create", "staking", "mine"];
type Project = { id: number; tokenAddress: Address; name: string; symbol: string; metadataCid: string; description: string; projectTitle: string; imageCid: string | null; stage: Stage; isFired: boolean; energy: bigint; price: bigint; allocation: bigint; sold: bigint; stock: bigint; purchaseLimit: bigint; startTime: bigint; endTime: bigint; quoteSymbol: string; quoteAddress: Address; quoteDecimals: number | null; preparationAddress: Address | null; capitalVerified: boolean; refundable: boolean; creator: Address | null; creatorBuyQuote: bigint; tax: string; failed: boolean };

type ProjectCopy = { preparation: Awaited<ReturnType<FlapChainSdk["resolveContract"]>>; texts: readonly [string, string, string, string] };
type ProjectWritingAction = "subscribe" | "redeemIDO" | "launchToken" | "claimIDO" | "refundCreatorBuy";
async function readProjectCopy(sdk: FlapChainSdk, project: Project, cache: WeakMap<FlapChainSdk, Map<string, Promise<ProjectCopy>>>) {
  let entries = cache.get(sdk);
  if (!entries) { entries = new Map(); cache.set(sdk, entries); }
  const key = `${project.id}:${project.tokenAddress.toLowerCase()}`;
  let pending = entries.get(key);
  if (!pending) {
    pending = (async () => {
      const preparation = await sdk.resolveContract("ido-preparation", [BigInt(project.id)]);
      const texts = await sdk.readContract<readonly [string, string, string, string]>({ contract: preparation, abi: IDO_PREPARATION_ABI, functionName: "projectDescription" });
      return { preparation, texts };
    })();
    entries.set(key, pending);
    void pending.catch(() => { if (entries?.get(key) === pending) entries.delete(key); });
  }
  return pending;
}

// Home banner artwork. Keep both image CIDs here so the desktop and mobile versions can be changed together.
const HOME_BANNER_DESKTOP_CID = "bafybeibxyrna7yvlg4kamdn6xgjs6kisvo2rovdhrhdib6rpxtkmxy4o7i";
const HOME_BANNER_MOBILE_CID = "bafybeicakmmxxrea3l5cwqhdffyfx4gw2alupchkej735yvditc5otuwea";

const ENERGY_TOKEN_CONTRACT_ID = "energy-token";
// Payment catalog decimals are display hints; transaction amounts use the ERC20 decimals read on selection.
// The duration fields are not shown in the form; pass the configured defaults in seconds.
const DEFAULT_TAX_DURATION_SECONDS = 365 * 24 * 60 * 60;
const DEFAULT_ANTI_FARMER_DURATION_SECONDS = 24 * 60 * 60;
// Only for the BNB percentage/MAX shortcut: reserve a conservative Gas budget at the current
// network gas price. This is neither a protocol fee nor the transaction's gas limit.
const CREATOR_BUY_GAS_BUFFER_UNITS = 5_000_000n;
const ZERO_BYTES32: Hex = `0x${"0".repeat(64)}`;


// Resolve an approved quote token for both creation and IDO purchase. Never use catalog addresses as write authorization.
async function resolveLaunchQuoteToken(sdk: FlapChainSdk, tokenAddress: Address) {
  for (let offset = 0; offset < MAX_ACCEPT_QUOTE_TOKENS; offset += 8) {
    const entries = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => sdk.readContract<Address>({ address: LAUNCHPAD_ADDRESS, abi: LAUNCHPAD_ABI, functionName: "acceptQuoteTokens", args: [BigInt(offset + i)] })));
    const match = entries.findIndex(entry => entry.status === "fulfilled" && entry.value.toLowerCase() === tokenAddress.toLowerCase());
    if (match >= 0) {
      const token = await sdk.resolveContract("launch-quote-token", [BigInt(offset + match)]);
      if (token.address.toLowerCase() !== tokenAddress.toLowerCase()) throw new Error("launchQuoteResolveFailed");
      return token;
    }
    if (entries.some(entry => entry.status === "rejected")) break;
  }
  throw new Error("launchQuoteResolveFailed");
}
function usePaymentTokenAddresses(sdk: FlapChainSdk): PaymentTokenAddresses {
  const [addresses, setAddresses] = useState<Record<number, Address>>({ 0: ZERO_ADDRESS });
  useEffect(() => {
    let active = true;
    const load = async () => {
      const resolved = await Promise.all(paymentTokens.filter(token => token.quoteIndex > 0).map(async token => {
        const contract = await sdk.resolveContract("launch-quote-token", [BigInt(token.quoteIndex)]);
        return [token.quoteIndex, contract.address] as const;
      }));
      if (active) setAddresses(Object.fromEntries([[0, ZERO_ADDRESS], ...resolved]));
    };
    void load().catch(cause => console.error("[SAUCE] Quote token catalog read failed", cause));
    return () => { active = false; };
  }, [sdk]);
  return addresses;
}
// Verify the confirmed receipt against the Factory emitter, registration and instance identity.
async function verifyCreatedPreparation(sdk: FlapChainSdk, receipt: Awaited<ReturnType<FlapChainSdk["waitForTx"]>>, token: Address, creator: Address) {
  const factory = launchAddress(sdk, PREPARATION_FACTORY_ID);
  let preparationAddress: Address | null = null;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== factory.toLowerCase()) continue;
    try {
      const event = decodeEventLog({ abi: PREPARATION_FACTORY_ABI, eventName: "PreparationCreated", data: log.data, topics: log.topics });
      if (event.args.creator.toLowerCase() === creator.toLowerCase()) preparationAddress = event.args.preparation;
    } catch { /* Other Factory events are unrelated. */ }
  }
  if (!preparationAddress) throw new Error("launchCreationUnverified");
  const indexPlusOne = await sdk.readContract<bigint>({ address: LAUNCHPAD_ADDRESS, abi: LAUNCHPAD_ABI, functionName: "preparationIndexPlusOne", args: [preparationAddress] });
  if (indexPlusOne <= 0n) throw new Error("launchCreationUnverified");
  const handle = await sdk.resolveContract("ido-preparation", [indexPlusOne - 1n]);
  const [actualToken, actualCreator, actualFactory, verified] = await Promise.all([
    sdk.readContract<Address>({ contract: handle, abi: IDO_PREPARATION_ABI, functionName: "tokenAddress" }),
    sdk.readContract<Address>({ contract: handle, abi: IDO_PREPARATION_ABI, functionName: "creator" }),
    sdk.readContract<Address>({ contract: handle, abi: IDO_PREPARATION_ABI, functionName: "factory" }),
    sdk.readContract<boolean>({ contract: handle, abi: IDO_PREPARATION_ABI, functionName: "isCapitalVerified" }),
  ]);
  if (handle.address.toLowerCase() !== preparationAddress.toLowerCase() || actualToken.toLowerCase() !== token.toLowerCase() || actualCreator.toLowerCase() !== creator.toLowerCase() || actualFactory.toLowerCase() !== factory.toLowerCase() || !verified) throw new Error("launchCreationUnverified");
  return handle.address;
}
// LaunchPad revert decoder. Keep this block separate so it can be removed after debugging.
const LAUNCHPAD_ERROR_ABI = parseAbi([
  "error AddressEmptyCode(address target)",
  "error AlreadyInitialized()",
  "error ERC1967InvalidImplementation(address implementation)",
  "error ERC1967NonPayable()",
  "error FailedCall()",
  "error InsufficientPayment()",
  "error InvalidBinding()",
  "error InvalidInitialization()",
  "error InvalidPreparation()",
  "error IsExistedQuoteToken(address quoteToken)",
  "error NotInitializing()",
  "error OnlyPreparationFactory()",
  "error PreparationAlreadyRegistered(address preparation)",
  "error SafeERC20FailedOperation(address token)",
  "error TokenAddressMismatch()",
  "error UUPSUnauthorizedCallContext()",
  "error UUPSUnsupportedProxiableUUID(bytes32 slot)",
  "error UnExistedQuoteToken(address quoteToken)",
  "error AlreadyClaimed()",
  "error CapitalNotVerified()",
  "error CreatorBuyAlreadyRefunded()",
  "error DescriptionTooLong(uint256 length, uint256 max)",
  "error InsufficientBalance(uint256 balance, uint256 needed)",
  "error InvalidDistribution()",
  "error InvalidFeeConfiguration()",
  "error InvalidIDOConfig()",
  "error InvalidLaunchParams()",
  "error InvalidLaunchResult()",
  "error InvalidProjectDescription()",
  "error NotGuardian(address caller)",
  "error NotHub(address caller)",
  "error NothingToClaim()",
  "error OnlyCreator()",
  "error OnlyFactory()",
  "error QuoteUnavailable()",
  "error ReentrancyGuardReentrantCall()",
  "error TokenAddressVerificationFailed()",
  "error ERC20InsufficientAllowance(address spender,uint256 allowance,uint256 needed)",
  "error ERC20InsufficientBalance(address sender,uint256 balance,uint256 needed)"
]);

function decodeLaunchPadError(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 10 && current && typeof current === "object"; depth++) {
    const item = current as { data?: unknown; details?: unknown; message?: unknown; reason?: unknown; cause?: unknown };
    const text = [item.details, item.message].filter((part): part is string => typeof part === "string").join(" ");
    // A Solidity require("...") reason is often nested in viem's cause rather than return data.
    const reason = typeof item.reason === "string" ? item.reason : text.match(/reverted with reason string ['"]([^'"]+)['"]/i)?.[1];
    if (reason) return reason;
    const fromMessage = text.match(/return data\s*[:]\s*(0x[0-9a-fA-F]{8,})/i)?.[1];
    const data = typeof item.data === "string" && /^0x[0-9a-fA-F]{8,}$/.test(item.data) ? item.data : fromMessage;
    if (data) {
      try {
        const decoded = decodeErrorResult({ abi: LAUNCHPAD_ERROR_ABI, data: data as Hex });
        return `${decoded.errorName}(${decoded.args?.map(arg => String(arg)).join(", ") ?? ""})`;
      } catch { return `0x${data.slice(2, 10)}`; }
    }
    current = item.cause;
  }
  return null;
}

type StakeFarmReward = { staked: bigint; debt: bigint; totalEarned: bigint };
type StakeFarmAccountInfo = {
  staticReward: StakeFarmReward; teamReward: StakeFarmReward;
  totalUsedReward: bigint; rewardBalance: bigint; freezeQuota: bigint; isActive: boolean;
};
type StakeFarmPool = { isDisable: boolean; token: Address; staticState: { apd: bigint; totalStaked: bigint; rewardPershare: bigint; totalEarnReward: bigint }; teamState: { apd: bigint; totalStaked: bigint; rewardPershare: bigint; totalEarnReward: bigint }; lastSettlementTime: bigint };
type LiveStakePool = { pool: StakeFarmPool; poolIndex: number; name: string; symbol: string; decimals: number | null; staked: bigint; totalStaked: bigint | null; teamStaked: bigint; staticTotalEarned: bigint; teamTotalEarned: bigint; isActive: boolean; approved: boolean };
type LiveStakeState = { status: "loading" | "ready" | "error"; rows: LiveStakePool[]; accountPendingEnergy: bigint | null; energyStakeThreshold: bigint | null };
const emptyLiveStake = (): LiveStakeState => ({ status: "loading", rows: [], accountPendingEnergy: null, energyStakeThreshold: null });
// Display only: truncate fractional digits without changing the contract value.
const formatTruncated = (value: Decimal.Value, places = 4) => {
  const [integer, fraction = ""] = new Decimal(value).toDecimalPlaces(places, Decimal.ROUND_DOWN).toFixed(places).split(".");
  const digits = fraction.replace(/0+$/, "");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return digits ? `${grouped}.${digits}` : grouped;
};
const formatEnergy = (value: bigint, places = 4) => formatTruncated(formatUnits(value, 18), places);
// List rows show a bounded preview so arbitrary on-chain text cannot expand or
// clip the responsive grid. The project detail keeps the complete description.
const compactText = (value: string, maxCharacters = 28) => {
  const characters = Array.from(value.trim());
  return characters.length > maxCharacters ? `${characters.slice(0, maxCharacters).join("")}…` : value;
};


function stakeFarmAddress(sdk: FlapChainSdk): Address {
  const contract = sdk.context.manifest.walletContracts?.find(item => item.id === STAKE_FARM_CONTRACT_ID);
  if (!contract || contract.chainId !== sdk.context.chainId || contract.address.toLowerCase() !== STAKE_FARM_ADDRESS.toLowerCase()) {
    throw new Error("StakeFarm is not declared for the selected chain.");
  }
  return STAKE_FARM_ADDRESS;
}

// Resolve pool ERC20s through StakeFarm before reads and approvals.
async function resolveStakePoolToken(sdk: FlapChainSdk, poolIndex: number, expected: Address) {
  const token = await sdk.resolveContract("stake-pool-token", [BigInt(poolIndex)]);
  if (token.address.toLowerCase() !== expected.toLowerCase()) throw new Error("stakeTokenUnavailable");
  return token;
}
async function readStakeFarmPool(sdk: FlapChainSdk, pool: StakeFarmPool, poolIndex: number, account?: Address): Promise<LiveStakePool> {
  let approved = false;
  let symbol = `${pool.token.slice(0, 6)}…${pool.token.slice(-4)}`;
  let name = "";
  let decimals: number | null = null;
  let staked = 0n;
  let teamStaked = 0n;
  let staticTotalEarned = 0n;
  let teamTotalEarned = 0n;
  let isActive = false;
  // Effective energy principal is not the actual pool principal used for extra rewards.
  const principalPromise = sdk.readContract<readonly [bigint, bigint, bigint]>({ address: STAKE_FARM_ADDRESS, abi: STAKE_FARM_ABI, functionName: "stakeInfoOf", args: [pool.token, account ?? ZERO_ADDRESS] }).catch(() => null);
  if (account) {
    const info = await sdk.readContract<StakeFarmAccountInfo>({ address: STAKE_FARM_ADDRESS, abi: STAKE_FARM_ABI, functionName: "accountInfoOf", args: [account, pool.token] });
    staked = info.staticReward.staked;
    teamStaked = info.teamReward.staked;
    staticTotalEarned = info.staticReward.totalEarned;
    teamTotalEarned = info.teamReward.totalEarned;
    isActive = info.isActive;
  }
  try {
    const token = await resolveStakePoolToken(sdk, poolIndex, pool.token);
    const metadata = await Promise.allSettled([
      sdk.readContract<string>({ contract: token, abi: erc20Abi, functionName: "symbol" }),
      sdk.readContract<number>({ contract: token, abi: erc20Abi, functionName: "decimals" }),
      sdk.readContract<string>({ contract: token, abi: erc20Abi, functionName: "name" }),
    ]);
    if (metadata[0].status === "fulfilled") symbol = metadata[0].value;
    if (metadata[2].status === "fulfilled") name = metadata[2].value;
    if (metadata[1].status === "fulfilled") {
      const value = Number(metadata[1].value);
      if (Number.isInteger(value) && value >= 0 && value <= 255) { decimals = value; approved = true; }
    }
  } catch (cause) { console.error("[SAUCE] Pool token resolution failed", pool.token, cause); }
  const principal = await principalPromise;
  return { pool, poolIndex, name: name || symbol, symbol, decimals, staked: principal?.[0] ?? staked, totalStaked: principal?.[2] ?? null, teamStaked, staticTotalEarned, teamTotalEarned, isActive, approved };
}

async function readStakeFarm(sdk: FlapChainSdk, account?: Address) {
  stakeFarmAddress(sdk);
  const [pools, accountPendingEnergy, energyStakeThreshold] = await Promise.all([
    sdk.readContract<readonly StakeFarmPool[]>({ address: STAKE_FARM_ADDRESS, abi: STAKE_FARM_ABI, functionName: "pools" }),
    account ? sdk.readContract<bigint>({ address: STAKE_FARM_ADDRESS, abi: STAKE_FARM_ABI, functionName: "accountPendingEnergy", args: [account] }).catch(() => null) : Promise.resolve(null),
    // The getter is already scaled by 1e18; never apply parseUnits to it again.
    sdk.readContract<bigint>({ address: STAKE_FARM_ADDRESS, abi: STAKE_FARM_ABI, functionName: "energyStakeThreshold" })
      .then(value => { if (typeof value !== "bigint" || value < 0n) throw new Error("Invalid energy stake threshold"); return value; })
      .catch(cause => { console.error("[SAUCE] Stake threshold read failed", cause); return null; }),
  ]);
  const rows = await Promise.all(pools.map((pool, index) => readStakeFarmPool(sdk, pool, index, account)));
  return { rows, accountPendingEnergy, energyStakeThreshold };
}

// StakeFarm.stake requires an ERC20 allowance first. Declare the selected token and its fixed
// approval spender in manifest.json before exposing this prepared write path in the staking form.
async function writeStakeFarm(sdk: FlapChainSdk, token: Address, amount: bigint, action: "stake" | "unstaked") {
  if (!sdk.wallet.address || sdk.wallet.isWrongNetwork || amount <= 0n) {
    throw new Error("StakeFarm wallet, network or amount is not ready.");
  }
  stakeFarmAddress(sdk);
  const prepared = await sdk.simulateContract({ address: STAKE_FARM_ADDRESS, abi: STAKE_FARM_ABI, functionName: action, args: [token, amount], account: sdk.wallet.address });
  const hash = await sdk.writeContract(prepared.request);
  const receipt = await sdk.waitForTx(hash);
  if (receipt.status !== "success") throw new Error("StakeFarm transaction reverted.");
  return receipt;
}
type LaunchPadListRow = {
  project: { tokenAddress: Address; poolLaunchParams: { p: { name: string; symbol: string; meta: string; quoteToken: Address; buyTaxRate: number; sellTaxRate: number; creatorBuyQuote: bigint } } };
  config: { unitEnergyPrice: bigint; unitCashPrice: bigint; amountPerUnit: bigint; startTime: bigint; endTime: bigint; purchaseLimit: bigint; totalStock: bigint };
  state: { totalSoldCount: bigint; isFired: boolean };
};
type LaunchPadPurchase = { amount: bigint; energyAmount: bigint; count: bigint; isRedeemed: boolean; hasClaimed: boolean; creatorBuyRefunded: boolean };
type ProjectPurchaseState = { status: "idle" | "loading" | "ready" | "error"; account: Address | null; tokenKey: string; byToken: Record<string, LaunchPadPurchase> };
const quoteInfo = (address: Address, tokenAddresses: PaymentTokenAddresses) => paymentTokens.find(token => tokenAddresses[token.quoteIndex]?.toLowerCase() === address.toLowerCase());
const projectPercent = (project: Project) => project.stock > 0n ? Number(project.sold * 10000n / project.stock) / 100 : 0;
const projectAmount = (amount: bigint, decimals: number | null = 18) => decimals === null ? "—" : formatTruncated(formatUnits(amount, decimals));
// Transaction refresh: read only the operated Preparation, retaining immutable presentation data.
async function readProjectUpdate(sdk: FlapChainSdk, current: Project, preparation: Awaited<ReturnType<FlapChainSdk["resolveContract"]>>, account: Address, now: number, confirmedInfo?: LaunchPadListRow) {
  const [info, capitalVerified, refundable, purchased, hasClaimed, creatorBuyRefunded] = await Promise.all([
    confirmedInfo ? Promise.resolve(confirmedInfo) : sdk.readContract<LaunchPadListRow>({ contract: preparation, abi: IDO_PREPARATION_ABI, functionName: "info" }),
    sdk.readContract<boolean>({ contract: preparation, abi: IDO_PREPARATION_ABI, functionName: "isCapitalVerified" }),
    sdk.readContract<boolean>({ contract: preparation, abi: IDO_PREPARATION_ABI, functionName: "isRefundable" }),
    sdk.readContract<readonly [bigint, bigint, bigint, boolean]>({ contract: preparation, abi: IDO_PREPARATION_ABI, functionName: "purchasedOf", args: [account] }),
    sdk.readContract<boolean>({ contract: preparation, abi: IDO_PREPARATION_ABI, functionName: "hasClaimed", args: [account] }),
    sdk.readContract<boolean>({ contract: preparation, abi: IDO_PREPARATION_ABI, functionName: "creatorBuyRefunded" }),
  ]);
  if (info.project.tokenAddress.toLowerCase() !== current.tokenAddress.toLowerCase() || purchased.length !== 4) throw new Error("Project refresh identity mismatch");
  const sold = info.state.totalSoldCount, stock = info.config.totalStock;
  const isFired = info.state.isFired;
  const stage: Stage = isFired || (stock > 0n && sold >= stock) ? "ended" : now < Number(info.config.startTime) ? "soon" : now <= Number(info.config.endTime) ? "live" : "ended";
  return {
    project: { ...current, sold, stock, isFired, stage, capitalVerified, refundable, failed: !isFired && refundable && sold < stock },
    purchase: { amount: purchased[0], energyAmount: purchased[1], count: purchased[2], isRedeemed: purchased[3], hasClaimed, creatorBuyRefunded } satisfies LaunchPadPurchase,
  };
}
const isSoldOut = (project: Project) => project.stock > 0n && project.sold >= project.stock;
const isLaunchReady = (project: Project, _now: number) => isSoldOut(project) && !project.isFired;
const hasProjectCountdown = (project: Project, _now: number) => project.stage !== "ended";
const taxPercent = (bps: number) => formatTruncated(new Decimal(bps).div(100), 2);
// Format remaining seconds; the parent advances chain time once per second.
function Countdown({ seconds }: { seconds: number }) {
  const remaining = Math.max(0, seconds);
  const hours = Math.floor(remaining / 3600);
  return <span>{[hours, Math.floor(remaining / 60) % 60, remaining % 60].map(value => String(value).padStart(2, "0")).join(":")}</span>;
}
const goldButton = "normal-case tracking-normal [--ui20-chamfer-bg:#ffda46] [--ui20-chamfer-border:#ffda46] hover:[--ui20-chamfer-bg:#ffe77c] hover:[--ui20-chamfer-border:#ffe77c]";
const stakeAddButtonClass = "gap-1 border border-[#78672b] rounded-md bg-[#2b2818] px-3 min-h-11 md:min-h-10 font-normal normal-case text-[#dac56c] text-[11px] enabled:hover:border-[#ffda46] enabled:hover:bg-[#393216] enabled:hover:text-[#ffda46] disabled:opacity-40 focus-visible:ring-[#ffda46]/45";

// Project artwork uses reviewed IPFS CIDs; the outer track visualizes local launch progress.
function ProjectImage({ sdk, project, alt }: { sdk: FlapChainSdk; project: Project; alt?: string }) {
  const [image, setImage] = useState<{ meta: string; cid: string | null }>({ meta: "", cid: null });
  useEffect(() => {
    let active = true;
    const metaCid = project.metadataCid;
    if (!metaCid || project.imageCid) return;
    void sdk.readIpfsText(metaCid).then(text => {
      const metadata = JSON.parse(text) as { image?: unknown };
      const image = typeof metadata.image === "string" ? metadata.image.trim().replace(/^ipfs:\/\//i, "") : "";
      const cid = /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})$/.test(image) ? image : null;
      if (active) setImage({ meta: metaCid, cid });
    }).catch(cause => { if (active) console.warn("[SAUCE] Project image metadata unavailable", metaCid, cause); });
    return () => { active = false; };
  }, [sdk, project.metadataCid, project.imageCid]);
  return <TokenImage key={project.imageCid || (image.meta === project.metadataCid ? image.cid : null) || project.metadataCid} cid={project.imageCid || (image.meta === project.metadataCid ? image.cid : null)} alt={alt || project.projectTitle || project.name} progress={projectPercent(project)} />;
}

function TokenImage({ cid, alt, progress }: { cid: string | null; alt: string; progress: number }) {
  const [failed, setFailed] = useState(false);
  const percent = Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0;
  const className = "h-full w-full object-cover";
  return <span data-sauce-icon-progress={String(Math.round(percent))} className="block relative w-[60px] h-[60px] shrink-0">
    <span className="block absolute inset-[6px] border-[#aa8d36] bg-[#0b0d10] border rounded-[12px] overflow-hidden">
      {failed || !cid ? <span role="img" aria-label={alt} className="flex justify-center items-center bg-[#292516] w-full h-full font-bold text-[#eac74e] text-sm">{alt.slice(0, 2).toUpperCase()}</span> : <IpfsImage cid={cid} alt={alt} className={className} onError={() => setFailed(true)} />}
    </span>
    <svg viewBox="0 0 60 60" aria-hidden="true" className="absolute inset-0 w-full h-full overflow-visible pointer-events-none">
      <path d="M30 2 H44 A14 14 0 0 1 58 16 V44 A14 14 0 0 1 44 58 H16 A14 14 0 0 1 2 44 V16 A14 14 0 0 1 16 2 H30" fill="none" stroke="#56616d" strokeWidth="3" />
      {percent > 0 ?
        <path d="M30 2 H44 A14 14 0 0 1 58 16 V44 A14 14 0 0 1 44 58 H16 A14 14 0 0 1 2 44 V16 A14 14 0 0 1 16 2 H30" fill="none" stroke="#42b8f5" strokeWidth="3" strokeLinecap="round" pathLength={100} strokeDasharray={`${percent} 100`} /> : null}
      {/* The marker stays at the top of the progress frame and gently breathes. */}
      <circle cx="30" cy="2" r="3.5" fill="#8fdfff" opacity="0.26" className="motion-safe:animate-pulse" />
      <circle cx="30" cy="2" r="1.6" fill="#f8fcff" className="motion-safe:animate-pulse" />
    </svg>
  </span>;
}
function Modal({ title, closeLabel, onClose, children, copyFriendly = false }: { title: string; closeLabel: string; onClose: () => void; children: ReactNode; copyFriendly?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; if (copyFriendly) dialog?.show(); else dialog?.showModal(); return () => dialog?.close(); }, [copyFriendly]);
  return <>{copyFriendly ? <div className="z-[70] fixed inset-0 bg-black/75" onClick={onClose} aria-hidden="true" /> : null}<dialog ref={ref} aria-label={title} onCancel={onClose} onKeyDown={event => { if (copyFriendly && event.key === "Escape") onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }} className={`border-[#49402a] bg-[#14181b] backdrop:bg-black/75 shadow-2xl m-auto p-5 sm:p-7 border rounded-2xl w-[520px] max-w-[calc(100vw-24px)] max-h-[88dvh] text-[#eeeef0] overflow-y-auto ${copyFriendly ? "fixed inset-0 z-[71]" : ""}`}>
    <header className="flex justify-between items-center gap-4 mb-6"><h2 className="font-semibold text-lg">{title}</h2><button type="button" aria-label={closeLabel} onClick={onClose} className="flex justify-center items-center border-[#353b43] hover:border-[#887537] bg-[#171b1e] hover:bg-[#242318] border rounded-lg w-[30px] h-[30px] text-[#b4bbc6] hover:text-[#ffda46] transition-colors shrink-0"><X size={22} /></button></header>{children}
  </dialog></>;
}

// Home banner: the image and eye contours share the original 1942 × 809 coordinate space.
// Keep the cover scale and desktop/mobile crop on this common art layer so the eyes never drift.
const bannerMotes = [
  { left: "5%", top: "17%", size: 3, delay: "-6s", duration: "16s" },
  { left: "8%", top: "67%", size: 3, delay: "-3s", duration: "12s" },
  { left: "18%", top: "29%", size: 5, delay: "-8s", duration: "15s" },
  { left: "22%", top: "55%", size: 4, delay: "-1s", duration: "17s" },
  { left: "29%", top: "78%", size: 3, delay: "-5s", duration: "13s" },
  { left: "34%", top: "18%", size: 3, delay: "-9s", duration: "14s" },
  { left: "41%", top: "42%", size: 2, delay: "-10s", duration: "17s" },
  { left: "47%", top: "64%", size: 4, delay: "-4s", duration: "15s" },
  { left: "52%", top: "89%", size: 4, delay: "-2s", duration: "16s" },
  { left: "57%", top: "34%", size: 3, delay: "-13s", duration: "18s" },
  { left: "63%", top: "21%", size: 3, delay: "-12s", duration: "14s" },
  { left: "68%", top: "52%", size: 4, delay: "-6s", duration: "16s" },
  { left: "72%", top: "74%", size: 5, delay: "-7s", duration: "18s" },
  { left: "79%", top: "12%", size: 3, delay: "-11s", duration: "14s" },
  { left: "84%", top: "37%", size: 2, delay: "-4s", duration: "13s" },
  { left: "88%", top: "59%", size: 4, delay: "-3s", duration: "17s" },
  { left: "93%", top: "82%", size: 4, delay: "-11s", duration: "16s" },
] as const;
function Banner({ children }: { children: ReactNode }) {
  const [imageFailed, setImageFailed] = useState(false);
  const [imageReady, setImageReady] = useState(false);
  const [mobileImageFailed, setMobileImageFailed] = useState(false);
  const [mobileImageReady, setMobileImageReady] = useState(false);
  const [eyesVisible, setEyesVisible] = useState(false);
  const [pointerActive, setPointerActive] = useState(false);
  const [clickRing, setClickRing] = useState<{ x: number; y: number; id: number } | null>(null);
  const clickRingId = useRef(0);
  const bannerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const banner = bannerRef.current;
    if (!banner) return;
    if (typeof IntersectionObserver === "undefined") { setEyesVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => setEyesVisible(entry.isIntersecting), { threshold: 0 });
    observer.observe(banner);
    return () => observer.disconnect();
  }, []);
  const pointerPosition = (event: React.PointerEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
      y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)),
    };
  };
  return <section
    ref={bannerRef}
    data-sauce-banner=""
    data-eyes-visible={eyesVisible ? "true" : "false"}
    data-pointer-active={pointerActive ? "true" : "false"}
    onPointerMove={(event) => {
      if (event.pointerType !== "mouse") return;
      const { x, y } = pointerPosition(event);
      event.currentTarget.style.setProperty("--sauce-pointer-x", `${x}px`);
      event.currentTarget.style.setProperty("--sauce-pointer-y", `${y}px`);
      if (!pointerActive) setPointerActive(true);
    }}
    onPointerLeave={() => setPointerActive(false)}
    onPointerDown={(event) => {
      if (event.pointerType !== "mouse") return;
      const { x, y } = pointerPosition(event);
      clickRingId.current += 1;
      setClickRing({ x, y, id: clickRingId.current });
    }}
    className="relative flex items-start max-md:items-center bg-[#060708] max-md:-mx-4 my-3 max-md:mt-0 max-md:mb-3 px-[5.4%] max-md:px-[6%] py-[45px] max-md:py-4 rounded-xl max-md:rounded-none h-[300px] md:h-[600px] overflow-hidden isolate"
  >
    <style>{`
      [data-sauce-banner] .sauce-eyes-dim,
      [data-sauce-banner] .sauce-eyes-shutter { animation: sauce-eyes-dark 6.4s ease-in-out infinite; }
      [data-sauce-banner] .sauce-eyes-glow { animation: sauce-eyes-light 6.4s ease-in-out infinite; }
      [data-sauce-banner] .sauce-banner-mote { animation: sauce-mote-drift var(--mote-duration) ease-in-out var(--mote-delay) infinite; }
      [data-sauce-banner] .sauce-banner-pointer-glow {
        background: radial-gradient(circle 300px at var(--sauce-pointer-x, 75%) var(--sauce-pointer-y, 50%), rgba(255, 198, 73, .16), rgba(255, 176, 40, .055) 42%, transparent 76%);
        opacity: 0; transition: opacity .22s ease; mix-blend-mode: screen;
      }
      [data-sauce-banner][data-pointer-active="true"] .sauce-banner-pointer-glow { opacity: 1; }
      [data-sauce-banner] .sauce-banner-click-ring { animation: sauce-banner-ring .85s ease-out both; }
      [data-sauce-banner][data-eyes-visible="false"] .sauce-eye-phase,
      [data-sauce-banner][data-eyes-visible="false"] .sauce-banner-mote { animation-play-state: paused; }
      @keyframes sauce-eyes-dark { 0%, 18%, 100% { opacity: 1; } 43%, 68% { opacity: 0; } }
      @keyframes sauce-eyes-light { 0%, 18%, 100% { opacity: 0; } 43%, 68% { opacity: .45; } }
      @keyframes sauce-mote-drift {
        0% { transform: translate3d(-6px, 28px, 0) scale(.65); opacity: 0; }
        24% { opacity: .8; }
        64% { opacity: .55; }
        100% { transform: translate3d(10px, -52px, 0) scale(1.12); opacity: 0; }
      }
      @keyframes sauce-banner-ring {
        from { opacity: .65; transform: translate(-50%, -50%) scale(1); }
        to { opacity: 0; transform: translate(-50%, -50%) scale(7); }
      }
      @media (prefers-reduced-motion: reduce) {
        [data-sauce-banner] .sauce-eye-phase { animation: none; opacity: 0; }
        [data-sauce-banner] .sauce-banner-mote { animation: none; opacity: .55; }
        [data-sauce-banner] .sauce-banner-pointer-glow,
        [data-sauce-banner] .sauce-banner-click-ring { display: none; }
      }
    `}</style>
    <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
      {!imageFailed ? <div data-sauce-banner-art="desktop" className="md:block top-1/2 right-0 absolute hidden -translate-y-1/2" style={{ width: "max(100%, 1440.2966625464px)", aspectRatio: "1942 / 809" }}>
        <IpfsImage cid={HOME_BANNER_DESKTOP_CID} alt="" loading="eager" className="w-full h-full" onLoad={() => setImageReady(true)} onError={() => setImageFailed(true)} />
        {/* Trace the two lens apertures in source-image pixels; feather only their existing bloom. */}
        {imageReady ? <svg data-sauce-banner-eyes="" className="absolute inset-0 w-full h-full overflow-visible" viewBox="0 0 1942 809" aria-hidden="true">
          <g className="sauce-eye-phase sauce-eyes-dim" fill="#080a09" stroke="#080a09" strokeWidth="7" style={{ filter: "blur(5px)" }}>
            <path d="M1111 277 L1117 282 L1137 291 L1141 301 L1137 304 L1120 298 L1114 293 L1111 285 Z" />
            <path d="M1193 280 L1235 263 L1241 267 L1233 283 L1187 299 L1183 294 Z" />
          </g>
          <g className="sauce-eye-phase sauce-eyes-shutter" fill="#1a1c17" stroke="#5c4924" strokeWidth=".5">
            <path d="M1112 278 L1117 282 L1137 291 L1140 300 L1137 302 L1121 297 L1115 292 L1112 285 Z" />
            <path d="M1193 281 L1235 264 L1239 268 L1231 282 L1187 297 L1185 294 Z" />
          </g>
          <g className="sauce-eye-phase sauce-eyes-glow" fill="#fff7d3" style={{ filter: "drop-shadow(0 0 4px #ffe786) drop-shadow(0 0 9px #ffae18)" }}>
            <path d="M1115 282 L1135 292 L1138 299 L1122 295 L1117 291 Z" />
            <path d="M1195 283 L1234 268 L1230 280 L1189 294 Z" />
          </g>
        </svg> : null}
      </div> : null}
      {!mobileImageFailed ? <div data-sauce-banner-art="mobile" className="top-1/2 left-1/2 absolute md:hidden -translate-x-1/2 -translate-y-1/2" style={{ width: "max(100%, 400px)", aspectRatio: "1448 / 1086" }}>
        <IpfsImage cid={HOME_BANNER_MOBILE_CID} alt="" loading="eager" className="w-full h-full" onLoad={() => setMobileImageReady(true)} onError={() => setMobileImageFailed(true)} />
        {/* Mobile artwork has its own lens coordinates in its 1448 × 1086 source pixels. */}
        {mobileImageReady ? <svg data-sauce-banner-eyes="mobile" className="absolute inset-0 w-full h-full overflow-visible" viewBox="0 0 1448 1086" aria-hidden="true">
          <g className="sauce-eye-phase sauce-eyes-dim" fill="#080a09" stroke="#080a09" strokeWidth="8" style={{ filter: "blur(6px)" }}>
            <path d="M265 316 L279 321 L299 333 L315 344 L311 352 L288 340 L270 329 Z" />
            <path d="M381 332 L412 317 L453 303 L451 319 L418 336 L385 344 Z" />
          </g>
          <g className="sauce-eye-phase sauce-eyes-shutter" fill="#1a1c17" stroke="#5c4924" strokeWidth=".6">
            <path d="M266 318 L280 323 L299 334 L313 344 L309 350 L288 338 L271 328 Z" />
            <path d="M383 331 L413 318 L451 305 L449 318 L417 334 L386 341 Z" />
          </g>
          <g className="sauce-eye-phase sauce-eyes-glow" fill="#fff7d3" style={{ filter: "drop-shadow(0 0 5px #ffe786) drop-shadow(0 0 10px #ffae18)" }}>
            <path d="M270 321 L284 327 L301 337 L309 344 L306 347 L288 336 L273 327 Z" />
            <path d="M388 330 L416 318 L448 308 L445 316 L416 331 L391 339 Z" />
          </g>
        </svg> : null}
      </div> : null}
      <div className="absolute inset-0 md:hidden" style={{ background: "linear-gradient(90deg,rgba(3,5,6,.64) 0%,rgba(3,5,6,.34) 48%,rgba(3,5,6,.08) 100%)" }} />
    </div>
    <div aria-hidden="true" data-sauce-bubbles="" className="absolute inset-0 overflow-hidden pointer-events-none">
      {bannerMotes.map((mote, index) => <span key={index} className="absolute bg-[#ffe2a0] shadow-[0_0_12px_3px_#e9ac4690] rounded-full sauce-banner-mote" style={{ left: mote.left, top: mote.top, width: mote.size, height: mote.size, opacity: 0, "--mote-delay": mote.delay, "--mote-duration": mote.duration } as React.CSSProperties} />)}
    </div>
    <div aria-hidden="true" className="z-[1] absolute inset-0 pointer-events-none sauce-banner-pointer-glow" />
    {clickRing ? <span key={clickRing.id} aria-hidden="true" className="z-[1] absolute border-[#ffdb74] border rounded-full sauce-banner-click-ring pointer-events-none size-9" style={{ left: clickRing.x, top: clickRing.y }} /> : null}
    {children}
  </section>;
}

// Launchpad form data stays in App memory. Mini App packages cannot use browser storage.
type PoolLaunchVanity = { salt: Hex; predictedTokenAddress: Address; attempts: number; portal: Address; codeHash: Hex };
type LaunchValues = {
  paymentToken: string; paymentAddress: string;
  name: string; symbol: string; description: string; titleZh: string; titleEn: string; summaryZh: string; summaryEn: string; supply: string;
  totalAmount: string; amountPerUnit: string; unitEnergyPrice: string; unitCashPrice: string; purchaseLimit: string;
  startTime: string; endTime: string; buyTax: number; sellTax: number;
  market: number; burn: number; holder: number; lpRewards: number;
  holderMinShareTokens: string | null;
  liquidityPercent: string; liquidityTokens: string;
  marketAddress: string; website: string; telegram: string; x: string;
  mode: "ido" | "buy"; creatorBuyAmount: string; vanity: PoolLaunchVanity | null;
};
type LaunchSubmission = { hash: Address; token: Address; owner: Address; metadataCid: string; status: "pending" | "success" };
type CreatorBuyFunds = { key: string; status: "loading" | "ready" | "error"; balance: bigint; decimals: number; gasReserve: bigint };
type SaltLockFeeState = { status: "idle" | "loading" | "ready" | "error"; amount: bigint | null };
type GraduationFloorResult = { meetsFloor: boolean; floorUsdWad: bigint; quoteUsdWad: bigint; multiplierBps: number; meetsCreateFloor: boolean; createFloorUsdWad: bigint };
type LaunchFloorPreview = { quoteUsdWad: bigint; createFloorUsdWad: bigint; shortfallUsdWad: bigint; shortfallQuote: bigint };
const ceilDiv = (value: bigint, divisor: bigint) => value / divisor + (value % divisor === 0n ? 0n : 1n);
const initialLaunch: LaunchValues = {
  paymentToken: "BNB", paymentAddress: "", name: "", symbol: "", description: "", titleZh: "", titleEn: "", summaryZh: "", summaryEn: "",
  supply: "1000000000", totalAmount: "100000000", amountPerUnit: "10000", unitEnergyPrice: "100", unitCashPrice: "0.05",
  // The former 1% cap was 1,000 lots at this default supply and lot size.
  purchaseLimit: "1000", startTime: "", endTime: "", buyTax: 3, sellTax: 3,
  market: 25, burn: 25, holder: 25, lpRewards: 25,
  holderMinShareTokens: null,
  liquidityPercent: "100", liquidityTokens: "900000000",
  marketAddress: "", website: "", telegram: "", x: "", mode: "ido", creatorBuyAmount: "", vanity: null,
};
const splitParts = [
  { key: "market", labelKey: "launchSplitmarket", descriptionKey: "launchSplitDescmarket", color: "#ffda46" },
  { key: "burn", labelKey: "launchSplitburn", descriptionKey: "launchSplitDescburn", color: "#aab4c2" },
  { key: "holder", labelKey: "launchSplitholder", descriptionKey: "launchSplitDescholder", color: "#ff9d5b" },
  { key: "lpRewards", labelKey: "launchSplitlpRewards", descriptionKey: "launchSplitDesclpRewards", color: "#d0ad4a" },
] as const;
const paymentCategories = [
  { key: "featured", labelKey: "launchPayfeatured" },
  { key: "all", labelKey: "launchPayall" },
  { key: "stock", labelKey: "launchPaystock" },
  { key: "preIpo", labelKey: "launchPaypreIpo" },
] as const;
const projectDescriptionFields = [
  { key: "titleZh", labelKey: "launchtitleZh" },
  { key: "titleEn", labelKey: "launchtitleEn" },
  { key: "summaryZh", labelKey: "launchsummaryZh" },
  { key: "summaryEn", labelKey: "launchsummaryEn" },
] as const;
const launchLinkFields = [
  { key: "website", labelKey: "launchLinkwebsite" },
  { key: "x", labelKey: "launchLinkx" },
  { key: "telegram", labelKey: "launchLinktelegram" },
] as const;
const launchProcessSteps = [
  { titleKey: "launchProcess1", descriptionKey: "launchProcess1Desc" },
  { titleKey: "launchProcess2", descriptionKey: "launchProcess2Desc" },
  { titleKey: "launchProcess3", descriptionKey: "launchProcess3Desc" },
] as const;
const stakeRuleItems = [
  { titleKey: "stakeRuleAdd", descriptionKey: "stakeRuleAddDesc" },
  { titleKey: "stakeRuleRedeem", descriptionKey: "stakeRuleRedeemDesc" },
  { titleKey: "stakeRuleRestore", descriptionKey: "stakeRuleRestoreDesc" },
] as const;
type SplitKey = typeof splitParts[number]["key"];
type PaymentCategory = typeof paymentCategories[number]["key"];
// Each tax destination can use only the percentage left after the other destinations.
const splitLimit = (values: LaunchValues, key: SplitKey) => Math.max(0, 100 - splitParts.reduce((sum, part) => sum + (part.key === key ? 0 : Number(values[part.key]) || 0), 0));
const units18 = (value: string) => {
  try { return /^\d+(?:\.\d{1,18})?$/.test(value) ? parseUnits(value, 18).toString() : null; } catch { return null; }
};
// Use the smallest allowed token amount until the creator enters a custom holding threshold.
const minimumDividendTokens = (totalSupply: string | null) => {
  if (totalSupply === null) return null;
  const supply = BigInt(totalSupply);
  return supply > 0n ? formatUnits((supply + 99999n) / 100000n, 18) : null;
};
// DIVIDEND encodes a token quantity in base units, bounded by 0.001%–0.1% of supply.
const dividendMinimumBalance = (totalSupply: string | null, tokenAmount: string | null) => {
  if (totalSupply === null) return null;
  try {
    const supply = BigInt(totalSupply);
    const lower = (supply + 99999n) / 100000n;
    const upper = supply / 1000n;
    const amount = tokenAmount?.trim();
    if (amount !== undefined && !/^\d+(?:\.\d{1,18})?$/.test(amount)) return null;
    const requested = amount === undefined ? lower : parseUnits(amount, 18);
    return requested >= lower && requested <= upper ? requested.toString() : null;
  } catch { return null; }
};
// The form's fourth allocation maps to Pool Launch LP_BPS per the launch configuration.
function buildFeeConfigs(values: LaunchValues, totalSupply: string | null, creatorAddress: string) {
  const bps = {
    market: Math.round(values.market * 100), burn: Math.round(values.burn * 100),
    holder: Math.round(values.holder * 100), lpRewards: Math.round(values.lpRewards * 100),
  };
  const issues: string[] = [];
  if (Object.values(bps).some(value => !Number.isInteger(value) || value < 0 || value > 10000) || Object.values(bps).reduce((sum, value) => sum + value, 0) !== 10000) issues.push("feeConfigs.bps");
  const marketingAddress = values.marketAddress.trim() || creatorAddress;
  if (bps.market > 0 && (!isAddress(marketingAddress) || marketingAddress.toLowerCase() === ZERO_ADDRESS)) issues.push("feeConfigs.marketingAddress");
  const minimumShareBalance = dividendMinimumBalance(totalSupply, values.holderMinShareTokens);
  if (bps.holder > 0 && minimumShareBalance === null) issues.push("feeConfigs.minimumShareBalance");
  if (issues.length) return { feeConfigs: null, issues, bps, minimumShareBalance };
  const feeConfigs: { feeType: number; bps: number; "configData": `0x${string}` }[] = [];
  if (bps.market > 0) feeConfigs.push({ feeType: 3, bps: bps.market, "configData": encodeAbiParameters([{ type: "address" }], [marketingAddress as `0x${string}`]) });
  if (bps.burn > 0) feeConfigs.push({ feeType: 1, bps: bps.burn, "configData": "0x" });
  if (bps.holder > 0 && minimumShareBalance !== null) feeConfigs.push({ feeType: 5, bps: bps.holder, "configData": encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [ZERO_ADDRESS, BigInt(minimumShareBalance)]) });
  if (bps.lpRewards > 0) feeConfigs.push({ feeType: 2, bps: bps.lpRewards, "configData": "0x" });
  return { feeConfigs, issues, bps, minimumShareBalance };
}
// datetime-local has no timezone. The form labels it Beijing time, so encode UTC+8 before producing Unix seconds.
const beijingUnixSeconds = (value: string) => {
  if (!value) return null;
  const milliseconds = Date.parse(`${value}+08:00`);
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : null;
};
// CREATE2 uses the Portal deployer and the trusted Factory init-code hash, independent of token metadata.
function predictPoolLaunchAddress(salt: Hex, portal: Address, codeHash: Hex): Address {
  return getContractAddress({ from: portal, salt, bytecodeHash: codeHash, opcode: "CREATE2" });
}
function isValidPoolLaunchVanity(vanity: PoolLaunchVanity | null): vanity is PoolLaunchVanity {
  return !!vanity && /^0x[0-9a-fA-F]{64}$/.test(vanity.salt)
    && vanity.predictedTokenAddress.toLowerCase().endsWith("7777")
    && predictPoolLaunchAddress(vanity.salt, vanity.portal, vanity.codeHash).toLowerCase() === vanity.predictedTokenAddress.toLowerCase();
}
async function minePoolLaunchSalt(sdk: FlapChainSdk): Promise<PoolLaunchVanity> {
  const { portal, codeHash } = await readLaunchEnvironment(sdk);
  const randomSeed = new Uint8Array(32);
  crypto.getRandomValues(randomSeed);
  let salt = bytesToHex(randomSeed);
  for (let attempts = 1; attempts <= 1_000_000; attempts++) {
    const predictedTokenAddress = predictPoolLaunchAddress(salt, portal, codeHash);
    if (predictedTokenAddress.toLowerCase().endsWith("7777")) return { salt, predictedTokenAddress, attempts, portal, codeHash };
    salt = keccak256(salt);
    if (attempts % 2048 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  throw new Error("launchSaltError");
}
// Parse the selected quote token's amount exactly; do not round fractional base units.
function creatorBuyBaseUnits(values: LaunchValues, decimals: number): bigint | null {
  if (values.mode !== "buy") return 0n;
  const amount = values.creatorBuyAmount.trim();
  if (!/^\d+(?:\.\d+)?$/.test(amount) || (amount.split(".")[1]?.length ?? 0) > decimals) return null;
  try { const units = parseUnits(amount, decimals); return units > 0n && units < 2n ** 256n ? units : null; }
  catch { return null; }
}
// The full target raise is poolQuote; creating the launcher pays only the lock fee and optional first buy.
function estimatedPoolQuoteBaseUnits(values: LaunchValues, decimals: number): bigint | null {
  try {
    const allocation = units18(values.totalAmount);
    const perUnit = units18(values.amountPerUnit);
    if (allocation === null || perUnit === null || BigInt(perUnit) <= 0n || BigInt(allocation) % BigInt(perUnit) !== 0n || !/^\d+(?:\.\d+)?$/.test(values.unitCashPrice) || (values.unitCashPrice.split(".")[1]?.length ?? 0) > decimals) return null;
    const amount = (BigInt(allocation) / BigInt(perUnit)) * parseUnits(values.unitCashPrice, decimals);
    return amount > 0n ? amount : null;
  } catch { return null; }
}
// The image CID lives inside the metadata JSON; only the JSON CID becomes p.meta.
function buildTokenMetadata(values: LaunchValues, logoImageCid: string, creatorAddress: string) {
  return {
    name: values.name.trim(), symbol: values.symbol.trim(), image: logoImageCid,
    description: values.description.trim(), website: values.website.trim() || null,
    twitter: values.x.trim() || null, telegram: values.telegram.trim() || null,
    creator: isAddress(creatorAddress) && creatorAddress.toLowerCase() !== ZERO_ADDRESS ? creatorAddress : null,
  };
}
// Build only token and swap parameters. Factory owns the IDO remainder distribution.
function buildLaunchParameters(values: LaunchValues, logoImageCid: string, creatorAddress: string, metadataCid: string | null, vanity: Awaited<ReturnType<typeof minePoolLaunchSalt>>, sourceChainId: number, verifiedQuoteDecimals: number, selectedQuoteAddress: Address | null) {
  const totalSupply = units18(values.supply);
  const poolToken = units18(values.liquidityTokens);
  const creatorBuyQuote = creatorBuyBaseUnits(values, verifiedQuoteDecimals);
  const poolQuote = estimatedPoolQuoteBaseUnits(values, verifiedQuoteDecimals);
  const feeResult = buildFeeConfigs(values, totalSupply, creatorAddress);
  const p = {
    name: values.name.trim(), symbol: values.symbol.trim(), meta: metadataCid,
    totalSupply: totalSupply === null ? null : BigInt(totalSupply), salt: vanity.salt,
    quoteToken: selectedQuoteAddress,
    dexId: 0, poolQuote, poolToken: poolToken === null ? null : BigInt(poolToken),
    buyTaxRate: Math.round(values.buyTax * 100), sellTaxRate: Math.round(values.sellTax * 100),
    taxDuration: DEFAULT_TAX_DURATION_SECONDS, antiFarmerDuration: DEFAULT_ANTI_FARMER_DURATION_SECONDS, feeConfigs: feeResult.feeConfigs,
    antiSniperMode: 0, exemptWindow: 0, exemptAddrs: [],
    creatorBuyQuote, extensionID: ZERO_BYTES32, "extensionData": "0x" as Hex, commissionReceiver: ZERO_ADDRESS,
  };
  return {
    poolLaunch: {
      p, creatorBuy: { minOutputAmount: 0n, "permitData": "0x" as Hex },
      missingFields: Object.entries(p).filter(([, value]) => value === null).map(([key]) => key), feeConfigIssues: feeResult.issues
    }
  };
}
const validPaymentAddress = (value: string) => /^0x[a-fA-F0-9]{40}$/.test(value) && !/^0x0{40}$/i.test(value);
// A custom address can reuse catalog metadata; other addresses remain provisional until the host can verify them.
const configuredPaymentToken = (address: string, tokenAddresses: PaymentTokenAddresses) => paymentTokens.find(token => tokenAddresses[token.quoteIndex]?.toLowerCase() === address.trim().toLowerCase());
// The payment picker is the sole source of quote addresses. Wallet permissions remain in manifest.json.
function selectedPaymentQuote(values: LaunchValues, tokenAddresses: PaymentTokenAddresses): { address: Address; symbol: string; decimals: number } | null {
  if (values.paymentToken === "custom") {
    const address = values.paymentAddress.trim();
    return validPaymentAddress(address) ? { address: address as Address, symbol: configuredPaymentToken(address, tokenAddresses)?.symbol ?? "custom", decimals: configuredPaymentToken(address, tokenAddresses)?.decimals ?? 18 } : null;
  }
  const token = paymentTokens.find(item => item.symbol === values.paymentToken);
  const address = token ? tokenAddresses[token.quoteIndex] : undefined;
  return token && address ? { address, symbol: token.symbol, decimals: token.decimals } : null;
}
const launchInputTone = "border-[#333e49] bg-[#11181d] text-[#f0f0f0] placeholder:text-[#8b96a4] caret-[#ffda46] outline-none focus:border-[#bca139] focus:ring-1 focus:ring-[#bca139]/50 [color-scheme:dark]";
const launchInput = `min-h-11 w-full min-w-0 rounded-lg border px-3 py-2.5 text-sm ${launchInputTone}`;
const launchCompactInput = `min-h-9 w-16 rounded border px-2 py-1 text-right text-xs ${launchInputTone}`;
const launchCard = "rounded-2xl border border-[#333b44] bg-[#0d1114]";
const launchNumber = (value: string | number) => formatTruncated(value || 0);
const formatTokenValue = launchNumber;
const launchDecimal = (value: string) => {
  try {
    const amount = new Decimal(value || 0);
    return amount.isFinite() ? amount : new Decimal(0);
  } catch { return new Decimal(0); }
};
// Keep the draft quotient until display; validate whole lots separately before encoding.
function launchLotQuantity(total: string, perLot: string): Decimal {
  try {
    const amount = new Decimal(total || 0), unit = new Decimal(perLot || 0);
    return amount.isFinite() && unit.isFinite() && amount.greaterThanOrEqualTo(0) && unit.greaterThan(0) ? amount.div(unit) : new Decimal(0);
  } catch { return new Decimal(0); }
}

function LaunchField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="flex flex-col gap-2 min-w-0 text-[#bdc4ce] text-xs"><span>{label}</span>{children}{hint ? <small className="text-[#969fac] text-[11px] leading-relaxed">{hint}</small> : null}</label>;
}
function LaunchSection({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return <section className="border-[#30373f] p-5 sm:p-7 border-b"><h2 className="font-semibold text-xl">{title}</h2>{subtitle ? <p className="mt-2 text-[#9ca7b5] text-xs leading-6">{subtitle}</p> : null}<div className="mt-6">{children}</div></section>;
}

// Payment icons use the image CIDs in the editable catalog above, with a local symbol fallback.
function PaymentTokenIcon({ token, large = false, selected = false }: { token: PaymentTokenConfig; large?: boolean; selected?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  return <span className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full ${selected ? "bg-[#413718] text-[#ffda46]" : "bg-[#252d34] text-[#b4c1cb]"} ${large ? "size-10" : "size-4 sm:size-[30px]"}`}>
    {!loaded || failed ? token.symbol === "BNB" ? <Wallet aria-hidden="true" className={large ? "size-[18px]" : "size-3 sm:size-[18px]"} /> : <Coins aria-hidden="true" className={large ? "size-[18px]" : "size-3 sm:size-[18px]"} /> : null}
    {!failed ? <IpfsImage cid={token.imageCid} alt="" className="absolute inset-0 rounded-full object-cover size-full" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} /> : null}
  </span>;
}

// The configured payment catalog drives the picker and the selected-token summary.
function PaymentPicker({ t, values, setField, onChange, tokenAddresses }: { t: (key: string) => string; values: LaunchValues; setField: <K extends keyof LaunchValues>(key: K, value: LaunchValues[K]) => void; onChange: (next: LaunchValues) => void; tokenAddresses: PaymentTokenAddresses }) {
  const [category, setCategory] = useState<PaymentCategory>("featured");
  const [query, setQuery] = useState("");
  const rows = paymentTokens.filter(token => (category === "all" || token.group === category) && token.symbol.toLowerCase().includes(query.trim().toLowerCase()));
  const selectedToken = values.paymentToken === "custom" ? configuredPaymentToken(values.paymentAddress, tokenAddresses) : paymentTokens.find(token => token.symbol === values.paymentToken);
  const selected = values.paymentToken === "custom" ? validPaymentAddress(values.paymentAddress) ? selectedToken?.symbol ?? t("launchCustomToken") : "" : selectedToken?.symbol ?? "";
  const selectedAddress = values.paymentToken === "custom" ? validPaymentAddress(values.paymentAddress) ? values.paymentAddress : "" : selectedToken ? tokenAddresses[selectedToken.quoteIndex] ?? "" : "";
  const selectedName = selectedToken?.name ?? t("launchMetadataUnavailable");
  return <div>
    <div className="flex items-center gap-2 border-[#39414a] focus-within:border-[#bca139] bg-[#11181d] px-3 border rounded-lg focus-within:ring-1 focus-within:ring-[#bca139]/50 max-w-sm text-[#aeb6c1]"><Search size={17} /><input className="flex-1 border-0 bg-transparent min-w-0 h-11 text-[#f0f0f0] text-sm placeholder:text-[#8b96a4] caret-[#ffda46] outline-none [color-scheme:dark]" aria-label={t("launchPaymentSearch")} placeholder={t("launchPaymentSearch")} value={query} onChange={e => setQuery(e.target.value)} /></div>
    {/* Underlined category tabs and selection cards keep the existing responsive column counts. */}
    <div className="flex gap-4 sm:gap-6 border-[#303a42] mt-4 border-b text-sm sm:text-base" role="group" aria-label={t("launchPaymentCategories")}>
      {paymentCategories.map(item => <button type="button" key={item.key} aria-pressed={category === item.key} className={`-mb-px min-h-12 shrink-0 border-b-2 px-1.5 py-3 whitespace-nowrap outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#ffda46] ${category === item.key ? "border-[#ffda46] text-[#ffda46]" : "border-transparent text-[#a8b1bd] hover:text-[#e7e9ec]"}`} onClick={() => setCategory(item.key)}>{t(item.labelKey)}</button>)}
    </div>
    <div data-sauce-payment-grid="" className={`mt-4 sm:mt-5 grid max-h-[360px] gap-x-3 gap-y-2 sm:gap-y-3 overflow-y-auto ${category === "preIpo" ? "grid-cols-2 sm:grid-cols-2 lg:grid-cols-4" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"}`} aria-label={t("launchPaymentList")}>
      {rows.map(token => {
        const isSelected = values.paymentToken === token.symbol;
        return <button type="button" key={token.symbol} data-payment-symbol={token.symbol} aria-label={token.symbol} aria-pressed={isSelected} className={`flex items-center gap-1.5 sm:gap-2.5 border rounded-xl px-2 sm:px-3 w-full h-[50px] sm:h-[68px] min-w-0 text-left outline-none focus-visible:ring-1 focus-visible:ring-[#ffda46] ${isSelected ? "border-[#ffda46] bg-[#2b2819] text-[#ffda46]" : "border-[#36434e] bg-[#0d1216] text-[#eceef1] hover:border-[#bca139]"}`} onClick={() => setField("paymentToken", token.symbol)}>
          <PaymentTokenIcon token={token} selected={isSelected} />
          <span className="flex flex-col flex-1 min-w-0"><span className="font-semibold text-[14px] truncate leading-tight" title={token.symbol}>{token.symbol}</span>{token.group === "preIpo" && "issuer" in token && token.issuer ? <span className="mt-0.5 font-normal text-[#aab2bd] text-[9px] sm:text-[11px] truncate leading-tight" title={`${t("launchIssuer")} ${token.issuer}`}>{t("launchIssuer")} {token.issuer}</span> : null}</span>
          <span data-sauce-payment-check="" aria-hidden="true" className={`ml-auto flex items-center justify-center rounded-full size-4 sm:size-[18px] shrink-0 ${isSelected ? "bg-[#ffe142] text-[#1a1c12]" : "invisible"}`}><Check size={11} strokeWidth={2.5} /></span>
        </button>;
      })}
      {!rows.length ? <p className="col-span-full py-4 text-[#aab3be] text-xs">{t("launchNoPayment")}</p> : null}
    </div>
    {/* The custom token flow accepts an address alone. Clear leaves the picker unselected. */}
    <details hidden className="border-[#30373c] mt-5 pt-4 border-t text-xs">
      <summary className="min-h-8 text-[#d9dee5] cursor-pointer">{t("launchCustomPayment")}</summary>
      <p className="my-3 text-[#aab3be] leading-6">{t("launchCustomPaymentNote")}</p>
      <LaunchField label={t("launchPaymentAddress")} hint={values.paymentAddress && !validPaymentAddress(values.paymentAddress) ? t("launchAddressInvalid") : undefined}>
        <div className="relative">
          <input className={`${launchInput} pr-11`} value={values.paymentAddress} placeholder="0x…" autoComplete="off" spellCheck={false} onChange={e => onChange({ ...values, paymentAddress: e.target.value.trim(), paymentToken: "custom" })} />
          {values.paymentAddress ? <button type="button" aria-label={t("launchClearPaymentAddress")} className="top-1/2 right-3 absolute flex justify-center items-center hover:bg-[#30383d] rounded-full text-[#d9dee5] hover:text-white -translate-y-1/2 size-7 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ffda46]" onClick={() => onChange({ ...values, paymentAddress: "", paymentToken: "custom" })}><X size={18} aria-hidden="true" /></button> : null}
        </div>
      </LaunchField>
    </details>
    {selected ? <div aria-live="polite" className="flex items-center gap-3 border-[#38434d] bg-[#11181d] mt-4 p-3 sm:p-4 border rounded-xl min-w-0">
      {selectedToken ? <PaymentTokenIcon token={selectedToken} large /> : <span className="flex justify-center items-center bg-[#252d34] rounded-full text-[#ffda46] shrink-0 size-10"><Coins size={21} /></span>}
      <div className="min-w-0"><p className="font-semibold text-[#f1f2ef] text-sm"><span>{selected}</span><span className="font-normal text-[#a8b2bd]"> · {selectedName}</span></p>{selectedAddress && selectedAddress.toLowerCase() !== ZERO_ADDRESS.toLowerCase() ? <p className="mt-1 font-mono text-[#aab4bf] text-[11px] break-all">{selectedAddress}</p> : null}</div>
    </div> : null}
  </div>;
}

// Portal creates the launcher through the configured Factory after parameter review.
function CreateTokenPage({ t, values, onChange, logoCid, onLogoCid, creatorAddress, onBack, onCreated, connected, wrongNetwork, onSwitch, launchSdk, tokenAddresses, submission, onSubmissionChange, uploadImage, uploadText }: {
  t: (key: string) => string; values: LaunchValues; onChange: Dispatch<SetStateAction<LaunchValues>>; onBack: () => void;
  logoCid: string; onLogoCid: (cid: string) => void; creatorAddress: string;
  onCreated: () => void; connected: boolean; wrongNetwork: boolean; onSwitch: () => void;
  launchSdk: FlapChainSdk; tokenAddresses: PaymentTokenAddresses; submission: LaunchSubmission | null; onSubmissionChange: (next: LaunchSubmission | null) => void;
  uploadImage: (file: File) => Promise<{ cid: string }>;
  uploadText: (text: string) => Promise<{ cid: string }>;
}) {
  const [uploading, setUploading] = useState(false);
  const [draggingLogo, setDraggingLogo] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [metadataUploading, setMetadataUploading] = useState(false);
  const [metadataError, setMetadataError] = useState("");
  const [contractError, setContractError] = useState<string | null>(null);
  const [metadataCid, setMetadataCid] = useState(submission?.metadataCid ?? "");
  const [launchPhase, setLaunchPhase] = useState<"idle" | "preparing" | "approving" | "simulating" | "submitting" | "confirming">("idle");
  const launchedToken = submission?.status === "success" ? submission.token : null;
  const metadataInFlight = useRef(false);
  const useConfiguredMetadata = !!DEFAULT_LAUNCH_METADATA_CID && logoCid === DEFAULT_LAUNCH_IMAGE_CID;
  const [errors, setErrors] = useState<string[]>([]);
  const [validatingTime, setValidatingTime] = useState(false);
  const timeValidationInFlight = useRef(false);
  const [floorPreview, setFloorPreview] = useState<LaunchFloorPreview | null>(null);
  const [step, setStep] = useState<"edit" | "review" | "done">(() => submission?.status === "success" ? "done" : submission ? "review" : "edit");
  const [generatingAddress, setGeneratingAddress] = useState(false);
  const [addressError, setAddressError] = useState("");
  const addressInFlight = useRef(false);
  const [buyFunds, setBuyFunds] = useState<CreatorBuyFunds | null>(null);
  const [balanceRefresh, setBalanceRefresh] = useState(0);
  const [saltLockFee, setSaltLockFee] = useState<SaltLockFeeState>({ status: "idle", amount: null });
  // Creation pays the current Portal fee; the rest of poolQuote is raised by subscriptions.
  useEffect(() => {
    const launchPad = launchSdk.context.manifest.walletContracts?.find(item => item.id === LAUNCHPAD_CONTRACT_ID && item.chainId === launchSdk.context.chainId);
    if (!launchPad) { setSaltLockFee({ status: "error", amount: null }); return; }
    let active = true;
    setSaltLockFee({ status: "loading", amount: null });
    launchSdk.readContract<bigint>({ address: PORTAL_ADDRESS, abi: PORTAL_ABI, functionName: "SALT_LOCK_FEE", args: [] })
      .then(amount => {
        if (!active) return;
        if (typeof amount !== "bigint" || amount < 0n) { setSaltLockFee({ status: "error", amount: null }); return; }
        setSaltLockFee({ status: "ready", amount });
      })
      .catch(() => { if (active) setSaltLockFee({ status: "error", amount: null }); });
    return () => { active = false; };
  }, [step, launchSdk]);
  const uploadRef = useRef<HTMLInputElement>(null);
  const setField = <K extends keyof LaunchValues>(key: K, value: LaunchValues[K]) => {
    onChange(current => {
      const next = { ...current, [key]: value, ...(key === "paymentToken" ? { creatorBuyAmount: "" } : {}) };
      if (key === "supply" || key === "totalAmount") {
        try { next.liquidityTokens = new Decimal(next.supply).sub(next.totalAmount).toFixed(); } catch { next.liquidityTokens = ""; }
      }
      return next;
    });
    setErrors([]); setFloorPreview(null); setMetadataCid(""); setMetadataError(""); setContractError(null);
  };
  const setSplitField = (key: SplitKey, value: string) => {
    const requested = Number(value);
    const clamped = Number.isFinite(requested) ? Math.min(splitLimit(values, key), Math.max(0, requested)) : 0;
    setField(key, Math.round(clamped * 100) / 100);
  };
  const customCurrency = validPaymentAddress(values.paymentAddress) ? configuredPaymentToken(values.paymentAddress, tokenAddresses)?.symbol ?? t("launchCustomToken") : t("launchUnselected");
  const currency = values.paymentToken === "custom" ? customCurrency : values.paymentToken;
  const splitTotal = Math.round(splitParts.reduce((sum, part) => sum + Number(values[part.key] || 0), 0) * 100) / 100;
  const taxEnabled = values.buyTax > 0 || values.sellTax > 0;
  const lotQuantity = launchLotQuantity(values.totalAmount, values.amountPerUnit);
  const lots = lotQuantity.trunc().toNumber();
  const lotsDisplay = formatTruncated(lotQuantity, 1);
  const maxRaise = Number(values.unitCashPrice) > 0 ? lotQuantity.mul(values.unitCashPrice).toString() : "0";
  const configuredQuote = selectedPaymentQuote(values, tokenAddresses);
  const [quotePrecision, setQuotePrecision] = useState<{ address: string; decimals: number } | null>(null);
  const selectedQuoteKey = configuredQuote?.address.toLowerCase() ?? "";
  const quotePrecisionReady = selectedQuoteKey === ZERO_ADDRESS || quotePrecision?.address === selectedQuoteKey;
  const quoteDecimalsEstimate = selectedQuoteKey === ZERO_ADDRESS ? 18 : quotePrecision?.address === selectedQuoteKey ? quotePrecision.decimals : 18;
  useEffect(() => {
    if (!selectedQuoteKey || selectedQuoteKey === ZERO_ADDRESS) return;
    let active = true;
    setQuotePrecision(null);
    void resolveLaunchQuoteToken(launchSdk, selectedQuoteKey as Address)
      .then(handle => launchSdk.readContract<number>({ contract: handle, abi: erc20Abi, functionName: "decimals" }))
      .then(decimals => {
        if (!Number.isInteger(Number(decimals)) || Number(decimals) < 0 || Number(decimals) > 77) throw new Error("Invalid quote decimals");
        if (active) setQuotePrecision({ address: selectedQuoteKey, decimals: Number(decimals) });
      }).catch(cause => console.error("[SAUCE] Quote precision read failed", cause));
    return () => { active = false; };
  }, [launchSdk, selectedQuoteKey]);
  const creatorBuyUnits = creatorBuyBaseUnits(values, quoteDecimalsEstimate);
  const creatorBuyDisplay = creatorBuyUnits !== null ? launchNumber(formatUnits(creatorBuyUnits, quoteDecimalsEstimate)) : "—";
  // Native first buy and the Portal salt-lock fee are paid in the same Portal.newLauncher transaction.
  const nativeCreationValue = saltLockFee.amount !== null && creatorBuyUnits !== null
    ? saltLockFee.amount + (values.mode === "buy" && configuredQuote?.address === ZERO_ADDRESS ? creatorBuyUnits : 0n)
    : null;
  const defaultHolderMinTokens = minimumDividendTokens(units18(values.supply)) ?? "";
  const supplyAmount = launchDecimal(values.supply);
  const reservedAmount = launchDecimal(values.totalAmount).plus(launchDecimal(values.liquidityTokens));
  const isOverSupply = reservedAmount.greaterThan(supplyAmount);
  const unconfiguredAmount = supplyAmount.minus(reservedAmount);
  const buyQuoteAddress = configuredQuote?.address ?? "";
  const buyFundsKey = `${creatorAddress.toLowerCase()}:${buyQuoteAddress.toLowerCase()}`;
  const currentBuyFunds = buyFunds?.key === buyFundsKey ? buyFunds : null;
  const buyBalanceReady = connected && !wrongNetwork && currentBuyFunds?.status === "ready";
  // Balance reads follow the account/quote selection, not keystrokes in the purchase amount.
  useEffect(() => {
    if (values.mode !== "buy" || !connected || !isAddress(creatorAddress) || !buyQuoteAddress) return;
    let active = true;
    setBuyFunds({ key: buyFundsKey, status: "loading", balance: 0n, decimals: 18, gasReserve: 0n });
    const load = async () => {
      if (buyQuoteAddress === ZERO_ADDRESS) {
        const [balance, gasPrice] = await Promise.all([launchSdk.getBalance(creatorAddress as Address), launchSdk.getGasPrice()]);
        if (gasPrice <= 0n) throw new Error("Invalid gas price");
        return { balance, decimals: 18, gasReserve: gasPrice * CREATOR_BUY_GAS_BUFFER_UNITS };
      }
      const quote = await resolveLaunchQuoteToken(launchSdk, buyQuoteAddress as Address);
      const balance = await launchSdk.readContract<bigint>({ contract: quote, abi: erc20Abi, functionName: "balanceOf", args: [creatorAddress] });
      return { balance, decimals: quoteDecimalsEstimate, gasReserve: 0n };
    };
    void load().then(funds => { if (active) setBuyFunds({ key: buyFundsKey, status: "ready", ...funds }); })
      .catch(() => { if (active) setBuyFunds({ key: buyFundsKey, status: "error", balance: 0n, decimals: 18, gasReserve: 0n }); });
    return () => { active = false; };
  }, [values.mode, connected, creatorAddress, buyQuoteAddress, buyFundsKey, quoteDecimalsEstimate, launchSdk, balanceRefresh]);
  let maxCreatorBuy = 0n;
  if (buyBalanceReady) {
    const available = currentBuyFunds.balance - currentBuyFunds.gasReserve - (buyQuoteAddress === ZERO_ADDRESS ? saltLockFee.amount ?? 0n : 0n);
    maxCreatorBuy = available > 0n ? available : 0n;
  }
  async function generateTokenAddress() {
    if (addressInFlight.current) return;
    addressInFlight.current = true; setGeneratingAddress(true); setAddressError("");
    try {
      const vanity = await minePoolLaunchSalt(launchSdk);
      if (!isValidPoolLaunchVanity(vanity)) throw new Error("launchSaltError");
      onChange(current => ({ ...current, vanity }));
      setErrors([]);
    } catch { setAddressError("launchSaltError"); }
    finally { addressInFlight.current = false; setGeneratingAddress(false); }
  }
  function applyBuyPercentage(percent: number) {
    if (!buyBalanceReady || maxCreatorBuy <= 0n) return;
    setField("creatorBuyAmount", formatUnits(maxCreatorBuy * BigInt(percent) / 100n, currentBuyFunds.decimals));
  }
  const logo = logoCid ? <IpfsImage cid={logoCid} alt={t("launchLogoAlt")} className="rounded-xl w-full h-full object-cover" /> : <ImageIcon size={35} className="text-[#d6ba59]" />;
  async function acceptLogo(file?: File) {
    if (!file) return;
    setUploadError("");
    if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)) { setUploadError("launchImageTypeError"); return; }
    if (file.size > 3 * 1024 * 1024) { setUploadError("launchImageSizeError"); return; }
    setUploading(true);
    try { const uploaded = await uploadImage(file); onLogoCid(uploaded.cid); setMetadataCid(""); setMetadataError(""); }
    catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : null;
      setUploadError(code === "UPLOAD_ORIGIN_DENIED" ? "launchImageOriginError" : ["UPLOAD_PROXY_FAILED", "UPLOAD_FAILED", "UPLOAD_NOT_CONFIGURED", "UPLOAD_TIMEOUT", "UPLOAD_NETWORK_ERROR"].includes(String(code)) ? "launchImageHostError" : "launchImageUploadError");
    }
    finally { setUploading(false); }
  }
  async function validate() {
    const found: string[] = [];
    if (!isValidPoolLaunchVanity(values.vanity)) found.push("launchErrorTokenAddress");
    if (values.paymentToken === "custom" ? !validPaymentAddress(values.paymentAddress) : !paymentTokens.some(token => token.symbol === values.paymentToken)) found.push("launchErrorPayment");
    if (!values.name.trim()) found.push("launchErrorName");
    if (!/^[A-Za-z0-9]{2,12}$/.test(values.symbol)) found.push("launchErrorSymbol");
    if (!logoCid) found.push("launchErrorImage");
    const supplyUnits = units18(values.supply);
    if (supplyUnits === null || BigInt(supplyUnits) < 100n * 10n ** 18n || BigInt(supplyUnits) > 10n ** 33n) found.push("launchErrorSupply");
    if ([values.buyTax, values.sellTax].some(rate => rate < 0 || rate > 10)) found.push("launchErrorTax");
    if (!quotePrecisionReady) found.push("launchQuoteUnavailable");
    const poolUnits = units18(values.liquidityTokens);
    if (poolUnits === null || BigInt(poolUnits) <= 0n || (supplyUnits !== null && BigInt(poolUnits) > BigInt(supplyUnits))) found.push("launchErrorPoolToken");
    if (estimatedPoolQuoteBaseUnits(values, quoteDecimalsEstimate) === null) found.push("launchErrorLiquidity");
    if (values.mode === "buy") {
      if (creatorBuyUnits === null) found.push("launchErrorCreatorBuy");
      if (currentBuyFunds?.status === "ready" && creatorBuyUnits !== null && (creatorBuyUnits + (buyQuoteAddress === ZERO_ADDRESS ? saltLockFee.amount ?? 0n : 0n)) > currentBuyFunds.balance) found.push("launchInsufficientBuyBalance");
    }
    if (splitParts.some(part => !Number.isFinite(Number(values[part.key])) || Number(values[part.key]) < 0 || Number(values[part.key]) > 100)) found.push("launchErrorSplitRange");
    if (taxEnabled && splitTotal !== 100) found.push("launchErrorSplitTotal");
    if ([values.website, values.telegram, values.x].some(link => link && !/^https:\/\/\S+$/i.test(link))) found.push("launchErrorLinks");
    // Both creation choices retain IDO rules; only the creator purchase is optional.
    const idoUnits = units18(values.totalAmount);
    const lotUnits = units18(values.amountPerUnit);
    if (idoUnits === null || lotUnits === null || BigInt(idoUnits) <= 0n || BigInt(lotUnits) <= 0n || BigInt(idoUnits) % BigInt(lotUnits) !== 0n || BigInt(idoUnits) / BigInt(lotUnits) >= 2n ** 128n) found.push("launchErrorAllocation");
    const energyUnits = units18(values.unitEnergyPrice);
    let cashUnits: bigint | null = null;
    try { cashUnits = parseUnits(values.unitCashPrice, quoteDecimalsEstimate); } catch { /* Invalid precision or value. */ }
    if (cashUnits === null || cashUnits <= 0n || energyUnits === null || BigInt(energyUnits) < 0n) found.push("launchErrorCost");
    if (supplyUnits === null || poolUnits === null || energyUnits === null || BigInt(poolUnits) + BigInt(units18(values.totalAmount) ?? "0") !== BigInt(supplyUnits)) found.push("launchErrorReserved");
    if (Number(values.liquidityPercent) !== 100) found.push("launchErrorFullRaise");
    if (BigInt(units18(values.totalAmount) ?? "0") >= 2n ** 128n) found.push("launchErrorAllocation");
    if ([values.titleZh, values.titleEn, values.summaryZh, values.summaryEn].some(value => !value.trim())) found.push("launchDescriptionRequired");
    if ([values.name, values.titleZh, values.titleEn].some(value => value.length > LAUNCH_NAME_MAX_LENGTH) || [values.description, values.summaryZh, values.summaryEn].some(value => value.length > LAUNCH_DESCRIPTION_MAX_LENGTH)) found.push("launchTextTooLong");
    if (!/^\d+$/.test(values.purchaseLimit) || !Number.isSafeInteger(Number(values.purchaseLimit)) || Number(values.purchaseLimit) > lots) found.push("launchErrorWalletCap");
    const startSeconds = beijingUnixSeconds(values.startTime); const endSeconds = beijingUnixSeconds(values.endTime);
    if (startSeconds === null || endSeconds === null || startSeconds >= endSeconds) found.push("launchErrorTime");
    if (!Number.isFinite(Number(values.liquidityPercent)) || Number(values.liquidityPercent) <= 0 || Number(values.liquidityPercent) > 100 || poolUnits === null || BigInt(poolUnits) <= 0n) found.push("launchErrorLiquidity");
    if (values.marketAddress && !isAddress(values.marketAddress)) found.push("launchErrorAddress");
    if (values.holder > 0 && dividendMinimumBalance(supplyUnits, values.holderMinShareTokens) === null) found.push("launchErrorHolderMinShare");
    setFloorPreview(null);
    if (!found.length && startSeconds !== null && endSeconds !== null && configuredQuote && poolUnits !== null && supplyUnits !== null) {
      // Chain time and quote price are independent reads; start both before waiting.
      const relation = launchSdk.context.manifest.walletContracts?.find(item => item.id === RELATION_CONTRACT_ID && item.chainId === launchSdk.context.chainId && item.address.toLowerCase() === RELATION_ADDRESS.toLowerCase());
      const poolQuote = estimatedPoolQuoteBaseUnits(values, quoteDecimalsEstimate);
      if (!relation || poolQuote === null) {
        found.push("launchFloorCheckUnavailable");
      } else {
        const [timestampResult, quoteConfigResult] = await Promise.allSettled([
          launchSdk.readContract<bigint>({ address: RELATION_ADDRESS, abi: RELATION_ABI, functionName: "timestemp" }),
          launchSdk.readContract<readonly [boolean, bigint]>({ address: PORTAL_ADDRESS, abi: PORTAL_ABI, functionName: "launchQuoteConfig", args: [0, configuredQuote.address] }),
        ]);
        if (timestampResult.status === "rejected" || typeof timestampResult.value !== "bigint" || timestampResult.value <= 0n) {
          console.error("[SAUCE] Launch chain time validation failed", timestampResult.status === "rejected" ? timestampResult.reason : "Invalid chain time");
          found.push("launchChainTimeUnavailable");
        } else if (BigInt(endSeconds) <= timestampResult.value) {
          found.push("launchErrorFuture");
        }
        if (quoteConfigResult.status === "rejected") {
          console.error("[SAUCE] Portal quote configuration read failed", quoteConfigResult.reason);
          found.push("launchFloorCheckUnavailable");
        } else if (!quoteConfigResult.value[0] || quoteConfigResult.value[1] <= 0n) {
          found.push("launchQuoteUnavailable");
        } else {
          try {
            // This form has no VAULT fee slot, so the Portal preview receives the zero vault factory.
            const result = await launchSdk.readContract<GraduationFloorResult>({
              address: PORTAL_ADDRESS,
              abi: PORTAL_ABI,
              functionName: "graduationFloorV2",
              args: [{ quoteToken: configuredQuote.address, quotePriceUsd: quoteConfigResult.value[1], poolQuote, poolToken: BigInt(poolUnits), totalSupply: BigInt(supplyUnits), vaultFactory: ZERO_ADDRESS }],
            });
            const shortfallUsdWad = result.createFloorUsdWad > result.quoteUsdWad ? result.createFloorUsdWad - result.quoteUsdWad : 0n;
            const shortfallQuote = shortfallUsdWad > 0n ? ceilDiv(shortfallUsdWad * 10n ** BigInt(quoteDecimalsEstimate), quoteConfigResult.value[1]) : 0n;
            setFloorPreview({ quoteUsdWad: result.quoteUsdWad, createFloorUsdWad: result.createFloorUsdWad, shortfallUsdWad, shortfallQuote });
            if (!result.meetsCreateFloor) found.push("launchErrorCreateFloor");
          } catch (cause) {
            console.error("[SAUCE] Portal graduation floor preview failed", cause);
            found.push("launchFloorCheckUnavailable");
          }
        }
      }
    }
    return [...new Set(found)];
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!connected || timeValidationInFlight.current) return;
    timeValidationInFlight.current = true; setValidatingTime(true);
    try { const found = await validate(); setErrors(found); if (!found.length) setStep("review"); }
    finally { timeValidationInFlight.current = false; setValidatingTime(false); }
  }
  async function finish() {
    if (metadataInFlight.current || timeValidationInFlight.current) return;
    setContractError(null);
    if (submission?.status === "success") { setStep("done"); return; }
    if (submission?.status === "pending") {
      if (submission.owner.toLowerCase() !== creatorAddress.toLowerCase()) { setMetadataError("launchTransactionFailed"); return; }
      metadataInFlight.current = true; setMetadataUploading(true); setMetadataError(""); setLaunchPhase("confirming");
      try {
        const receipt = await launchSdk.waitForTx(submission.hash);
        if (receipt.status !== "success") { onSubmissionChange(null); throw new Error("launchTransactionFailed"); }
        await verifyCreatedPreparation(launchSdk, receipt, submission.token, submission.owner);
        onSubmissionChange({ ...submission, status: "success" }); setStep("done");
      } catch (cause) { console.error("[SAUCE] LaunchPad receipt check failed", cause); setMetadataError(cause instanceof Error && cause.message === "launchTransactionFailed" ? "launchTransactionFailed" : cause instanceof Error && cause.message === "launchCreationUnverified" ? "launchCreationUnverified" : "launchTransactionPending"); }
      finally { metadataInFlight.current = false; setMetadataUploading(false); setLaunchPhase("idle"); }
      return;
    }
    if (!connected) return;
    if (wrongNetwork) { onSwitch(); return; }
    if (saltLockFee.status !== "ready" || saltLockFee.amount === null) { setMetadataError("launchSaltFeeUnavailable"); return; }
    const launchPad = launchSdk.context.manifest.walletContracts?.find(item => item.id === LAUNCHPAD_CONTRACT_ID && item.chainId === launchSdk.context.chainId);
    if (!launchPad || !isAddress(creatorAddress)) { setMetadataError("launchIncompleteParameters"); return; }
    timeValidationInFlight.current = true; setValidatingTime(true);
    let found: string[];
    try { found = await validate(); }
    finally { timeValidationInFlight.current = false; setValidatingTime(false); }
    if (found.length) { setMetadataError(found[0]); return; }
    const vanity = values.vanity;
    if (!isValidPoolLaunchVanity(vanity)) { setMetadataError("launchErrorTokenAddress"); return; }
    metadataInFlight.current = true; setMetadataUploading(true); setMetadataError(""); setLaunchPhase("preparing");
    let checkingQuoteApproval = false;
    try {
      const cid = metadataCid || (useConfiguredMetadata ? DEFAULT_LAUNCH_METADATA_CID : (await uploadText(JSON.stringify(buildTokenMetadata(values, logoCid, creatorAddress)))).cid);
      if (!cid) throw new Error("Empty metadata CID");
      setMetadataCid(cid);
      const draft = buildLaunchParameters(values, logoCid, creatorAddress, cid, vanity, launchSdk.context.chainId, quoteDecimalsEstimate, configuredQuote?.address ?? null);
      const { p: launchParams, creatorBuy, missingFields, feeConfigIssues } = draft.poolLaunch;
      if (missingFields.length || feeConfigIssues.length || !launchParams.meta || launchParams.totalSupply === null || launchParams.quoteToken === null || launchParams.poolQuote === null || launchParams.poolToken === null || launchParams.creatorBuyQuote === null || !launchParams.feeConfigs) throw new Error("launchIncompleteParameters");
      const environment = await readLaunchEnvironment(launchSdk);
      if (environment.portal.toLowerCase() !== vanity.portal.toLowerCase() || environment.codeHash !== vanity.codeHash) throw new Error("launchErrorTokenAddress");
      const [accepted, quoteConfig, isDisabled, multiplier] = await Promise.all([
        launchSdk.readContract<boolean>({ address: LAUNCHPAD_ADDRESS, abi: LAUNCHPAD_ABI, functionName: "isAcceptQuoteToken", args: [launchParams.quoteToken] }),
        launchSdk.readContract<readonly [boolean, bigint]>({ address: PORTAL_ADDRESS, abi: PORTAL_ABI, functionName: "launchQuoteConfig", args: [0, launchParams.quoteToken] }),
        launchSdk.readContract<boolean>({ address: PORTAL_ADDRESS, abi: PORTAL_ABI, functionName: "quoteTokenCreationDisabled", args: [launchParams.quoteToken] }),
        launchSdk.readContract<readonly [boolean, number]>({ address: PORTAL_ADDRESS, abi: PORTAL_ABI, functionName: "launcherFactoryMultiplier", args: [environment.factory] }),
      ]);
      console.log(accepted, quoteConfig, isDisabled, multiplier)

      if (!accepted || !quoteConfig[0] || quoteConfig[1] <= 0n || isDisabled ) throw new Error("launchQuoteUnavailable");
      const startTime = beijingUnixSeconds(values.startTime);
      const endTime = beijingUnixSeconds(values.endTime);
      const totalAmount = units18(values.totalAmount);
      const amountPerUnit = units18(values.amountPerUnit);
      if (startTime === null || endTime === null || totalAmount === null || amountPerUnit === null) throw new Error("launchIncompleteParameters");
      // c uses the exact LaunchPad CreateIDOConfig names. Token, energy and configured payment quotes use 18 decimals.
      const c = {
        totalAmount: BigInt(totalAmount),
        unitEnergyPrice: parseUnits(values.unitEnergyPrice, 18),
        unitCashPrice: parseUnits(values.unitCashPrice, quoteDecimalsEstimate),
        amountPerUnit: BigInt(amountPerUnit),
        startTime: BigInt(startTime), endTime: BigInt(endTime),
        purchaseLimit: BigInt(values.purchaseLimit),
        totalStock: BigInt(totalAmount) / BigInt(amountPerUnit),
      };
      if (c.totalStock * c.unitCashPrice !== launchParams.poolQuote || c.totalStock * c.amountPerUnit !== c.totalAmount || c.totalAmount + launchParams.poolToken !== launchParams.totalSupply) throw new Error("launchErrorReserved");
      const config = {
        token: { ...launchParams, meta: launchParams.meta, totalSupply: launchParams.totalSupply, quoteToken: launchParams.quoteToken, poolQuote: launchParams.poolQuote, poolToken: launchParams.poolToken, creatorBuyQuote: launchParams.creatorBuyQuote, feeConfigs: launchParams.feeConfigs },
        creatorBuy, ido: c,
        description: { titleZh: values.titleZh.trim(), titleEn: values.titleEn.trim(), summaryZh: values.summaryZh.trim(), summaryEn: values.summaryEn.trim() },
      };
      const descriptionJson = JSON.stringify({ v: 1, name: config.token.name, symbol: config.token.symbol, quoteToken: config.token.quoteToken.toLowerCase(), targetRaise: (config.token.poolQuote * 10n ** 18n / 10n ** BigInt(quoteDecimalsEstimate)).toString(), poolTokenRatio: (config.token.poolToken * 10n ** 18n / config.token.totalSupply).toString(), ...config.description });
      if (toBytes(descriptionJson).length > 2048) throw new Error("launchDescriptionTooLong");
      const idoData = encodeAbiParameters(LAUNCHER_CONFIG_ABI, [config]);
      const data = encodeAbiParameters(parseAbiParameters("(bytes idoData)"), [{ idoData }]);
      const currentSaltFee = await launchSdk.readContract<bigint>({ address: PORTAL_ADDRESS, abi: PORTAL_ABI, functionName: "SALT_LOCK_FEE" });
      setSaltLockFee({ status: "ready", amount: currentSaltFee });
      const transactionValue = currentSaltFee + (launchParams.quoteToken === ZERO_ADDRESS ? launchParams.creatorBuyQuote : 0n);
      // ABI encoding verifies the nested tuple and uint widths before the payload is logged.
      try { encodeFunctionData({ abi: PORTAL_ABI, functionName: "newLauncher", args: [environment.factory, data] }); }
      catch { throw new Error("launchIncompleteParameters"); }
      console.log("[SAUCE] Portal.newLauncher parameters", { launcherFactory: environment.factory, creator: creatorAddress, config, data, value: transactionValue, predictedTokenAddress: vanity.predictedTokenAddress });
      setLaunchPhase("simulating");
      let prepared: Awaited<ReturnType<typeof launchSdk.simulateContract>>;
      const launchPadAddress = launchPad.address as Address;
      const approvalSpender = environment.factory;
      if (launchParams.quoteToken.toLowerCase() !== ZERO_ADDRESS.toLowerCase() && launchParams.creatorBuyQuote > 0n) {
        checkingQuoteApproval = true;
        // Resolve the selected ERC20 from LaunchPad's on-chain allowlist, not the display catalog.
        setLaunchPhase("approving");
        const quote = await resolveLaunchQuoteToken(launchSdk, launchParams.quoteToken);
        const requiredQuote = launchParams.creatorBuyQuote;
        const decimals = Number(await launchSdk.readContract<number>({ contract: quote, abi: erc20Abi, functionName: "decimals" }));
        if (decimals !== quoteDecimalsEstimate) throw new Error("launchQuoteUnavailable");
        const allowance = await launchSdk.readContract<bigint>({ contract: quote, abi: erc20Abi, functionName: "allowance", args: [creatorAddress as Address, approvalSpender] });
        if (allowance < requiredQuote) {
          const policy = launchPad.resolvedContracts?.find(item => item.id === "launch-quote-token");
          if (!policy?.maxApprovalWei || requiredQuote > BigInt(policy.maxApprovalWei)) throw new Error("launchQuoteAboveCap");
          if (allowance > 0n) {
            const reset = await launchSdk.simulateContract({ contract: quote, abi: erc20Abi, functionName: "approve", args: [approvalSpender, 0n], account: creatorAddress as Address });
            if ((await launchSdk.waitForTx(await launchSdk.writeContract(reset.request))).status !== "success") throw new Error("launchApprovalFailed");
          }
          const approval = await launchSdk.simulateContract({ contract: quote, abi: erc20Abi, functionName: "approve", args: [approvalSpender, requiredQuote], account: creatorAddress as Address });
          const approvalHash = await launchSdk.writeContract(approval.request);
          const approvalReceipt = await launchSdk.waitForTx(approvalHash);
          if (approvalReceipt.status !== "success") throw new Error("launchApprovalFailed");
          const updatedAllowance = await launchSdk.readContract<bigint>({ contract: quote, abi: erc20Abi, functionName: "allowance", args: [creatorAddress as Address, approvalSpender] });
          if (updatedAllowance < requiredQuote) throw new Error("launchApprovalFailed");
        }
        setLaunchPhase("simulating");
        checkingQuoteApproval = false;
      }
      try {
        prepared = await launchSdk.simulateContract({ address: PORTAL_ADDRESS, abi: PORTAL_ABI, functionName: "newLauncher", args: [environment.factory, data], account: creatorAddress as Address, value: transactionValue });
      }
      catch (cause) {
        const decoded = decodeLaunchPadError(cause);
        setContractError(decoded);
        console.error("[SAUCE] LaunchPad simulation failed", { decodedError: decoded, cause });
        throw new Error(decoded ? "launchContractError" : "launchSimulationFailed");
      }
      setLaunchPhase("submitting");
      let hash: Hex;
      try { hash = await launchSdk.writeContract(prepared.request); }
      catch (cause) {
        const decoded = decodeLaunchPadError(cause);
        setContractError(decoded);
        console.error("[SAUCE] LaunchPad wallet submission failed", { decodedError: decoded, cause });
        throw new Error(decoded ? "launchContractError" : "launchTransactionFailed");
      }
      const pending: LaunchSubmission = { hash, token: vanity.predictedTokenAddress, owner: creatorAddress as Address, metadataCid: cid, status: "pending" };
      onSubmissionChange(pending);
      setLaunchPhase("confirming");
      let receipt: Awaited<ReturnType<typeof launchSdk.waitForTx>>;
      try { receipt = await launchSdk.waitForTx(hash); }
      catch (cause) { console.error("[SAUCE] LaunchPad receipt unavailable", cause); throw new Error("launchTransactionPending"); }
      if (receipt.status !== "success") { onSubmissionChange(null); throw new Error("launchTransactionFailed"); }
      await verifyCreatedPreparation(launchSdk, receipt, vanity.predictedTokenAddress, creatorAddress as Address);
      onSubmissionChange({ ...pending, status: "success" }); setStep("done");
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : null;
      console.error("[SAUCE] Portal newLauncher failed", error);
      setMetadataError(error instanceof Error && ["launchEnvironmentInvalid", "launchQuoteUnavailable", "launchDescriptionTooLong", "launchCreationUnverified", "launchErrorTokenAddress", "launchErrorReserved", "launchIncompleteParameters", "launchSimulationFailed", "launchTransactionFailed", "launchTransactionPending", "launchContractError", "launchQuoteResolveFailed", "launchQuoteAboveCap", "launchApprovalFailed"].includes(error.message) ? error.message : code === "UPLOAD_ORIGIN_DENIED" ? "launchMetadataOriginError" : checkingQuoteApproval ? "launchApprovalFailed" : "launchMetadataUploadError");
    } finally { metadataInFlight.current = false; setMetadataUploading(false); setLaunchPhase("idle"); }
  }
  function leaveDone() {
    onSubmissionChange(null);
    onChange(current => ({ ...current, vanity: null, creatorBuyAmount: "" }));
    onCreated();
  }
  const field = (key: keyof LaunchValues, label: string, unit?: string, min = 0, step = "any", hint?: string, max?: number) => <LaunchField label={label} hint={hint}><div className="relative"><input className={`${launchInput} ${unit ? "pr-16" : ""}`} type="number" min={min} max={max} step={step} value={String(values[key])} onChange={e => setField(key, e.target.value as never)} />{unit ? <span className="right-3 absolute inset-y-0 flex items-center max-w-14 text-[#aab3bd] text-[10px] truncate pointer-events-none">{unit}</span> : null}</div></LaunchField>;
  const detail = (label: string, value: ReactNode) => <div className="flex justify-between items-baseline gap-3 py-1.5 text-xs"><dt className="text-[#9da8b6] shrink-0">{label}</dt><dd className="text-right m-0 min-w-0 text-[#eceef1] break-all">{value}</dd></div>;
  const gradient = (() => { let offset = 0; const stops = splitParts.map(part => { const start = offset; offset += Math.max(0, Number(values[part.key] || 0)) / Math.max(100, splitTotal) * 100; return `${part.color} ${start}% ${offset}%`; }); if (offset < 100) stops.push(`#3a414a ${offset}% 100%`); return `conic-gradient(${stops.join(", ")})`; })();
  return <main className="mx-auto py-7 max-w-[1540px] text-[#eaecf0]">
    <button type="button" className="flex items-center gap-2 mb-6 text-[#aab2be] text-xs hover:text-[#ffda46]" onClick={step === "review" ? () => setStep("edit") : onBack}><ArrowLeft size={17} />{t(step === "review" ? "launchBackEdit" : "launchBack")}</button>
    <div className="flex flex-wrap justify-between items-start gap-4 mb-7"><div><h1 className="font-bold text-3xl sm:text-[39px]">{t(step === "done" ? "launchDoneTitle" : step === "review" ? "launchReviewTitle" : "launchTitle")}</h1>{step !== "done" ? <p className="mt-2 text-[#a4adba] text-xs leading-6">{t(step === "review" ? "launchReviewIntro" : "launchIntro")}</p> : null}</div><span className="border-[#5a5031] px-3 py-2 border font-semibold text-[#ffda46] text-xs">{t("network")} / {currency}</span></div>
    {step === "done" ? <div className={`${launchCard} flex flex-col items-center gap-4 p-12 text-center`}><CheckCircle2 size={56} className="text-[#ffda46]" /><h2 className="font-semibold text-2xl">{values.name}</h2>{launchedToken ? <p className="max-w-full text-[#d0ff00] text-xs break-all">{t("launchTokenAddress")}: <code>{launchedToken}</code></p> : null}<Button className={goldButton} onClick={leaveDone}>{t("launchViewProject")}<ArrowRight size={16} /></Button></div> :
      <div className="items-start gap-5 grid xl:grid-cols-[minmax(0,1fr)_315px]"><form className={`${launchCard} min-w-0 overflow-hidden`} onSubmit={submit} noValidate>
        {step === "review" ? <div className="p-5 sm:p-7">
          <div className="flex items-center gap-4"><div className="flex justify-center items-center bg-[#11181d] rounded-xl w-16 h-16 overflow-hidden shrink-0">{logo}</div><div className="flex-1 min-w-0"><h2 className="font-semibold text-2xl break-all">{values.name}</h2><span className="text-[#a5afbc] text-xs">{values.symbol}</span></div><span className="border-[#4c6774] px-2 py-1 border rounded text-[#b6d0dd] text-[10px]">{t("waiting")}</span></div>
          <p className="mt-5 text-[#a9b3c0] text-sm leading-6">{values.description || t("launchNoDescription")}</p>
          {/* Review the immutable project introduction separately from token metadata. */}
          <h3 className="border-[#30373f] mt-7 pt-6 border-t font-semibold">{t("launchProjectDescription")}</h3>
          <dl data-sauce-review-description="" className="gap-4 grid grid-cols-1 sm:grid-cols-2 mt-4">
            {projectDescriptionFields.map(field => <div key={field.key} className="border-[#30373f] bg-[#11181d] p-3 border rounded-lg min-w-0">
              <dt className="text-[#9da8b6] text-xs">{t(field.labelKey)}</dt>
              <dd className="m-0 mt-2 text-[#eceef1] text-sm break-words whitespace-pre-wrap">{values[field.key].trim() || "—"}</dd>
            </div>)}
          </dl>
          <h3 className="border-[#30373f] mt-7 pt-6 border-t font-semibold">{t("launchLinks")}</h3><dl className="mt-3">{detail(t("launchLinkwebsite"), values.website || "—")}{detail(t("launchLinkx"), values.x || "—")}{detail(t("launchLinktelegram"), values.telegram || "—")}</dl>
          <h3 className="border-[#30373f] mt-7 pt-6 border-t font-semibold">{t("launchBasic")}</h3><dl className="mt-3">{detail(t("launchTokenAddress"), values.vanity?.predictedTokenAddress || "—")}{detail(t("launchSupply"), `${launchNumber(values.supply)} ${values.symbol}`)}{detail(t("launchPayment"), currency)}{detail(t("launchBuySellTax"), `${values.buyTax}% / ${values.sellTax}%`)}{detail(t("launchMode"), t(values.mode === "ido" ? "launchModeIdo" : "launchModeBuy"))}{detail(t("launchNetworkLabel"), `${launchSdk.context.chainId}`)}{values.mode === "buy" ? detail(t("launchCreatorBuyAmount"), `${values.creatorBuyAmount} ${currency}`) : null}</dl>
          <h3 className="border-[#30373f] mt-7 pt-6 border-t font-semibold">{t("launchIdo")}</h3><dl className="mt-3">{detail(t("launchAllocation"), `${formatTokenValue(values.totalAmount)} ${values.symbol}`)}{detail(t("launchPerLot"), `${formatTokenValue(values.amountPerUnit)} ${values.symbol}`)}{detail(t("launchPerLotCost"), `${values.unitEnergyPrice} ${t("energy")} + ${values.unitCashPrice} ${currency}`)}{detail(t("launchMaxRaise"), `${formatTokenValue(maxRaise)} ${currency}`)}{detail(t("launchWalletCap"), values.purchaseLimit === "0" ? t("purchaseUnlimited") : `${formatTokenValue(values.purchaseLimit)} ${t("launchLots")}`)}{detail(t("launchStart"), values.startTime.replace("T", " "))}{detail(t("launchEnd"), values.endTime.replace("T", " "))}{detail(t("launchFirstCome"), t("launchByOrder"))}</dl><h3 className="border-[#30373f] mt-7 pt-6 border-t font-semibold">{t("launchLiquidity")}</h3><dl className="mt-3">{detail(t("launchLpPercent"), `${values.liquidityPercent}%`)}{detail(t("launchLpTokens"), `${formatTokenValue(values.liquidityTokens)} ${values.symbol}`)}</dl>
          {taxEnabled ? <><h3 className="border-[#30373f] mt-7 pt-6 border-t font-semibold">{t("launchTaxSplit")}</h3><div className="gap-3 grid sm:grid-cols-2 mt-4">{splitParts.map(part => <div key={part.key} className="flex items-center gap-2 text-xs"><span className="rounded-full w-2 h-2" style={{ background: part.color }} />{t(part.labelKey)}<b className="ml-auto">{values[part.key]}%</b></div>)}</div>{values.holder > 0 ? <dl className="mt-3">{detail(t("launchHolderMinShare"), `${values.holderMinShareTokens ?? defaultHolderMinTokens} ${values.symbol || "TOKEN"}`)}</dl> : null}</> : null}
          {/* Creation charges are shown immediately above the final action. */}
          <div className="border-[#3c4035] bg-[#171b18] mt-7 p-4 sm:p-5 border rounded-xl">
            <h3 className="font-semibold text-sm">{t("launchPaymentBreakdown")}</h3>
            <dl className="mt-3">{detail(t("launchSaltLockFee"), <span data-sauce-salt-lock-fee="" aria-live="polite" className="text-[#ffda46]">{saltLockFee.status === "ready" && saltLockFee.amount !== null ? `${formatUnits(saltLockFee.amount, 18)} BNB` : t(saltLockFee.status === "error" ? "launchSaltFeeUnavailable" : "launchSaltFeeLoading")}</span>)}{values.mode === "buy" ? detail(t("launchCreatorBuyAmount"), `${creatorBuyDisplay} ${currency}`) : null}{detail(t("launchTotalNativePayment"), <b className="text-[#ffda46]">{nativeCreationValue !== null ? `${formatTruncated(formatUnits(nativeCreationValue, 18))} BNB` : t(saltLockFee.status === "error" ? "launchSaltFeeUnavailable" : "launchSaltFeeLoading")}</b>)}</dl>
          </div>
          {metadataError ? <div role="alert" className="mt-4 text-red-300 text-xs"><p>{t(metadataError)}{contractError ? ` ${contractError}` : ""}</p>{contractError === "InsufficientPayment()" ? <p className="mt-1">{t("launchInsufficientPaymentHint")}</p> : null}{contractError === "invaild input" ? <p className="mt-1">{t("launchInvalidInputHint")}</p> : null}</div> : null}<div className="flex flex-wrap gap-3 mt-6"><Button type="button" variant="outline" disabled={metadataUploading || submission?.status === "pending"} onClick={() => setStep("edit")}>{t("launchBackEdit")}</Button><Button type="button" className={goldButton} disabled={!connected || metadataUploading} loading={metadataUploading} onClick={() => void finish()}>{t(metadataUploading ? `launchPhase${launchPhase}` : submission?.status === "pending" ? "launchRecheckTransaction" : "launchCreateToken")}<Check size={16} /></Button></div>
        </div> : <>
          {/* 01. Token identity and uploaded image. */}
          <LaunchSection title={t("launchBasic")} subtitle={t("launchBasicIntro")}>
            <div className="gap-6 grid md:grid-cols-[180px_minmax(0,1fr)]">
              <div className="md:block items-start gap-x-4 gap-y-2 grid grid-cols-[112px_minmax(0,1fr)] min-w-0">
                <input ref={uploadRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="sr-only" tabIndex={-1} aria-hidden="true" disabled={!!logoCid || uploading} onChange={e => { void acceptLogo(e.target.files?.[0]); e.target.value = ""; }} />
                <button type="button" aria-label={t(logoCid ? "launchLogoAlt" : "launchUpload")} className={`col-start-1 row-start-1 flex flex-col justify-center items-center gap-2 border bg-[#11181d] border-dashed rounded-xl w-full text-center text-xs overflow-hidden aspect-square transition-colors ${draggingLogo ? "border-[#ffda46] bg-[#211f15]" : "border-[#68717d] hover:border-[#bca139] focus-visible:border-[#bca139]"}`} disabled={!!logoCid || uploading} onClick={() => uploadRef.current?.click()} onDragOver={event => { if (logoCid || uploading) return; event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDraggingLogo(true); }} onDragLeave={() => setDraggingLogo(false)} onDrop={event => { event.preventDefault(); setDraggingLogo(false); if (!logoCid && !uploading) void acceptLogo(event.dataTransfer.files?.[0]); }}>{logoCid ? logo : <ImageIcon size={34} className="text-[#ffda46]" />}{uploading ? <span>{t("launchUploading")}</span> : null}</button>
                <div className="col-start-2 row-start-1 md:mt-3 min-w-0">
                  <b className="block text-[#ffda46] text-[11px] leading-5"><span aria-hidden="true">{"// "}</span>{t("launchImageFormatsTitle")}</b>
                  <p className="mt-1 text-[#bbc4ce] text-[10px] md:text-[11px] leading-5">{t("launchUpload")}</p>
                  <p className="mt-3 text-[#9da7b4] text-[10px] md:text-[11px] leading-5">{t("launchImageFormats")}<br />{t("launchImageLimit")}</p>
                  {logoCid ? <button type="button" className="flex items-center gap-1 mt-2 text-[#bbc4ce] text-[11px] hover:text-[#ffda46]" onClick={() => { onLogoCid(""); setUploadError(""); setMetadataCid(""); setMetadataError(""); }}><X size={13} />{t("launchRemoveImage")}</button> : null}
                </div>
                {uploadError ? <p role="alert" className="col-span-2 mt-2 text-red-300 text-xs">{t(uploadError)}</p> : null}
              </div>
              <div className="space-y-5"><div className="gap-4 grid sm:grid-cols-2"><LaunchField label={t("launchName")}><input className={launchInput} maxLength={LAUNCH_NAME_MAX_LENGTH} value={values.name} placeholder={t("launchNamePlaceholder")} onChange={e => setField("name", e.target.value)} /></LaunchField><LaunchField label={t("launchSymbol")}><input className={launchInput} maxLength={12} value={values.symbol} placeholder="SGEN" onChange={e => setField("symbol", e.target.value.toUpperCase())} /></LaunchField></div><LaunchField label={t("launchDescription")}><textarea className={launchInput} rows={4} maxLength={LAUNCH_DESCRIPTION_MAX_LENGTH} value={values.description} placeholder={t("launchDescriptionPlaceholder")} onChange={e => setField("description", e.target.value)} /><small className="text-right text-[#8f99a6] text-[10px]">{values.description.length} / {LAUNCH_DESCRIPTION_MAX_LENGTH}</small></LaunchField>{field("supply", t("launchSupply"), values.symbol || "TOKEN", 100, "any")}</div>
            </div>
            <div data-sauce-address-panel="" className="border-[#30373f] mt-6 pt-5 border-t">
              <div className="flex flex-wrap justify-between items-center gap-3"><h3 className="font-semibold text-sm">{t("launchTokenAddress")}</h3><Button type="button" variant="outline" size="sm" loading={generatingAddress} disabled={generatingAddress || metadataUploading} onClick={() => void generateTokenAddress()} className="[--ui20-chamfer-border:#ffda46] hover:[--ui20-chamfer-border:#ffe77c] text-[#ffda46] hover:text-[#ffe77c] normal-case">{t(generatingAddress ? "launchGeneratingAddress" : values.vanity ? "launchRegenerateAddress" : "launchGenerateAddress")}</Button></div>
              <p aria-live="polite" className="border-[#333e49] bg-[#11181d] mt-3 p-3 border rounded-lg text-sm break-all"><code data-sauce-predicted-token="" className={values.vanity ? "text-[#ffda46]" : "text-[#8b96a4]"}>{values.vanity?.predictedTokenAddress || t("launchAddressNotGenerated")}</code></p>
              <p className="mt-2 text-[#969fac] text-[11px] leading-6">{t("launchGeneratedAddressHint")}</p>
              {addressError ? <p role="alert" className="mt-2 text-red-300 text-xs">{t(addressError)}</p> : null}
            </div>
          </LaunchSection>
          {/* 02. Payment catalog is illustrative until a reviewed payment contract is available. */}
          <LaunchSection title={t("launchProjectDescription")} subtitle={t("launchDescriptionNote")}><div className="gap-4 grid grid-cols-1 sm:grid-cols-2 mb-6">{projectDescriptionFields.map(field => {
            const isSummary = field.key === "summaryZh" || field.key === "summaryEn";
            const limit = isSummary ? LAUNCH_DESCRIPTION_MAX_LENGTH : LAUNCH_NAME_MAX_LENGTH;
            return <LaunchField key={field.key} label={t(field.labelKey)}>
              {isSummary ? <textarea className={launchInput} rows={4} maxLength={limit} value={values[field.key]} onChange={event => setField(field.key, event.target.value)} /> : <input className={launchInput} maxLength={limit} value={values[field.key]} onChange={event => setField(field.key, event.target.value)} />}
              <small className="text-right text-[#8f99a6] text-[10px]">{values[field.key].length} / {limit}</small>
            </LaunchField>;
          })}</div>
          </LaunchSection>
          <LaunchSection title={t("launchPayment")} subtitle={t("launchPaymentIntro")}><PaymentPicker t={t} values={values} setField={setField} onChange={onChange} tokenAddresses={tokenAddresses} /></LaunchSection>
          {/* 03. IDO sale rules and their calculated totals. */}
          <LaunchSection title={t("launchIdo")} subtitle={`${t("launchIdoIntro")} ${currency}`}><div className="gap-5 grid sm:grid-cols-2">{field("totalAmount", t("launchAllocation"), values.symbol || "TOKEN", 1, "1")}{field("amountPerUnit", t("launchPerLot"), values.symbol || "TOKEN", 1, "1")}{field("unitEnergyPrice", t("launchEnergyPerLot"), t("energy"), 0)}{field("unitCashPrice", `${t("launchPricePerLot")} ${currency}`, currency, .000001)}<LaunchField label={t("launchStart")} hint={t("launchBeijingTime")}><input className={launchInput} type="datetime-local" value={values.startTime} onChange={e => setField("startTime", e.target.value)} /></LaunchField><LaunchField label={t("launchEnd")} hint={t("launchBeijingTime")}><input className={launchInput} type="datetime-local" value={values.endTime} onChange={e => setField("endTime", e.target.value)} /></LaunchField>{field("purchaseLimit", t("launchWalletCap"), t("launchLots"), 1, "1", `${t("launchWalletCapHint")} ${lotsDisplay} ${t("launchLots")}`, lots)}<LaunchField label={t("launchAllocationMethod")}><div className={`${launchInput} flex items-center gap-2`}><CheckCircle2 size={17} className="text-[#ffda46]" />{t("launchFirstCome")}</div></LaunchField></div><div className="flex flex-wrap items-center gap-3 bg-[#222216] mt-6 p-4 rounded-lg text-[#bdc1b6] text-xs"><Zap size={18} className="text-[#ffda46]" /><span>{t("launchTotalLots")} <b className="text-[#f2dea3]" data-sauce-total-lots="">{lotsDisplay} {t("launchLots")}</b></span><span className="text-[#615b3a]">|</span><span>{t("launchMaxRaise")} <b className="text-[#f2dea3]">{launchNumber(maxRaise)} {currency}</b></span></div></LaunchSection>
          {/* 04. Buy/sell tax and the distribution of collected tax. */}
          <LaunchSection title={t("launchTax")} subtitle={t("launchTaxIntro")}><div className="gap-4 grid sm:grid-cols-2">{(["buyTax", "sellTax"] as const).map(key => <div key={key} className="border-[#333e49] bg-[#11181d] p-4 border rounded-xl"><div className="flex justify-between text-xs"><label htmlFor={key}>{t(key === "buyTax" ? "launchBuyTax" : "launchSellTax")}</label><b className="text-[#ffda46]">{values[key]}%</b></div><input id={key} className="mt-5 w-full accent-[#ffda46]" type="range" min={0} max={10} step={1} value={values[key]} onChange={e => setField(key, Number(e.target.value))} /><div className="flex justify-between text-[#909eac] text-[10px]"><span>0%</span><span>10%</span></div></div>)}</div><div className="flex justify-between items-center border-[#30373f] mt-7 pt-6 border-t"><h3 className="font-semibold">{t("launchTaxSplit")}</h3><Button type="button" variant="outline" size="sm" className="hover:[--ui20-chamfer-border:#ffda46] focus-visible:ring-[#ffda46]/45 hover:text-[#ffda46] normal-case" onClick={() => onChange({ ...values, market: 25, burn: 25, holder: 25, lpRewards: 25 })}>{t("launchResetSplit")}</Button></div><p className="mt-2 text-[#9ca7b5] text-xs leading-6">{t("launchTaxSplitIntro")}</p><div className="gap-6 grid md:grid-cols-[190px_minmax(0,1fr)] mt-5"><div><div className="relative mx-auto p-7 rounded-full max-w-[190px] aspect-square" style={{ background: gradient }} role="img" aria-label={`${t("launchSplitTotal")} ${splitTotal}%`}><div className="flex flex-col justify-center items-center bg-[#0d1114] rounded-full w-full h-full"><b className="text-2xl">{splitTotal}%</b><span className="text-[#a5afba] text-[10px]">{t(splitTotal === 100 ? "launchSplitComplete" : splitTotal > 100 ? "launchSplitOver" : "launchSplitRemaining")}</span></div></div><div className="space-y-2 mt-5">{splitParts.map(part => <div key={part.key} className="flex items-center gap-2 text-[11px]"><span className="rounded-full w-2 h-2" style={{ background: part.color }} />{t(part.labelKey)}<b className="ml-auto">{values[part.key]}%</b></div>)}</div></div><div><p className={`flex justify-between border p-3 text-xs ${taxEnabled && splitTotal !== 100 ? "border-amber-600 text-amber-200" : "border-[#434c54] text-[#b5c7b6]"}`}><span>{t("launchSplitTotal")} <b>{splitTotal}%</b></span><span>{t(!taxEnabled ? "launchZeroTax" : splitTotal === 100 ? "launchSplitComplete" : splitTotal > 100 ? "launchSplitOver" : "launchSplitRemaining")}</span></p>{splitParts.map(part => <div key={part.key} className="mt-4"><div className="flex items-center gap-2 text-xs"><label htmlFor={`split-${part.key}`}>{t(part.labelKey)}</label><small className="flex-1 min-w-0 text-[#929dac] text-[10px]">{t(part.descriptionKey)}</small><input className={launchCompactInput} aria-label={`${t(part.labelKey)} %`} type="number" min={0} max={splitLimit(values, part.key)} value={values[part.key]} onChange={e => setSplitField(part.key, e.target.value)} /></div><input id={`split-${part.key}`} className="mt-2 w-full accent-[#ffda46]" type="range" min={0} max={100} value={values[part.key]} onChange={e => setSplitField(part.key, e.target.value)} /></div>)}</div></div><div className="gap-4 border-[#30373f] grid sm:grid-cols-2 mt-6 pt-6 border-t"><LaunchField label={t("launchMarketAddress")} hint={t("launchAddressHint")}><input className={launchInput} value={values.marketAddress} placeholder="0x…" onChange={e => setField("marketAddress", e.target.value)} /></LaunchField><LaunchField label={t("launchHolderAsset")} hint={t("launchHolderAssetHint")}><div className={`${launchInput} flex items-center gap-2`}><Wallet size={17} className="text-[#ffda46]" />{currency}</div></LaunchField><LaunchField label={t("launchHolderMinShare")} hint={t("launchHolderMinShareHint")}><div className="relative"><input className={`${launchInput} pr-20`} type="number" aria-label={t("launchHolderMinShare")} min={defaultHolderMinTokens || 0} step="any" value={values.holderMinShareTokens ?? defaultHolderMinTokens} onChange={e => setField("holderMinShareTokens", e.target.value)} /><span className="right-3 absolute inset-y-0 flex items-center max-w-16 text-[#aab3bd] text-[10px] truncate pointer-events-none">{values.symbol || "TOKEN"}</span></div></LaunchField></div></LaunchSection>
          {/* 05. LP configuration and remaining token supply. */}
          <LaunchSection title={t("launchLiquidity")} subtitle={t("launchLiquidityIntro")}><div className="gap-5 grid sm:grid-cols-2"><LaunchField label={t("launchLpPercent")}><input className={launchInput} readOnly value="100%" /></LaunchField><LaunchField label={t("launchLpTokens")}><input className={launchInput} readOnly value={`${formatTokenValue(values.liquidityTokens)} ${values.symbol || "TOKEN"}`} /></LaunchField></div><div className="flex flex-wrap justify-between gap-2 border-[#30373f] mt-6 pt-4 border-t text-[#adb5bf] text-xs"><span>{t("launchConfigured")} <b className="text-white">{formatTokenValue(reservedAmount.toString())}</b> / {formatTokenValue(supplyAmount.toString())}</span><span className={isOverSupply ? "text-red-300" : ""}>{isOverSupply ? t("launchOverSupply") : `${t("launchUnconfigured")} ${formatTokenValue(unconfiguredAmount.toString())}`}</span></div><p className="mt-3 text-[#9ca7b5] text-xs leading-6">{t("launchLiquidityNote")}</p></LaunchSection>
          {/* 06. Both choices include IDO; the second also configures the creator purchase. */}
          <LaunchSection title={t("launchMode")}>
            <div className="gap-3 grid sm:grid-cols-2" role="radiogroup" aria-label={t("launchMode")}>
              {(["ido", "buy"] as const).map(mode => <label key={mode} className={`relative cursor-pointer rounded-xl border p-4 ${values.mode === mode ? "border-[#ffda46] bg-[#272415]" : "border-[#38434d] bg-[#11181d]"}`}><input type="radio" name="launch-mode" value={mode} className="top-4 right-4 absolute accent-[#ffda46]" checked={values.mode === mode} onChange={() => setField("mode", mode)} /><span className="flex items-center gap-2 pr-5 font-semibold text-sm">{mode === "ido" ? <Rocket size={20} /> : <Coins size={20} />}{t(mode === "ido" ? "launchModeIdo" : "launchModeBuy")}</span><p className="mt-3 text-[#adb6c1] text-xs leading-6">{t(mode === "ido" ? "launchModeIdoDesc" : "launchModeBuyDesc")}</p></label>)}
            </div>
            {values.mode === "buy" ? <div data-sauce-first-buy="" className="border-[#333b44] bg-[#101619] mt-5 p-4 sm:p-5 border rounded-2xl">
              <div className="flex justify-between items-baseline gap-3 mb-5 text-sm"><span className="text-[#a4afbc]">{t("launchMyQuoteBalance").replace("{token}", currency)}</span><b data-sauce-buy-balance="" className="text-right text-[#ffda46] break-all">{buyBalanceReady ? formatTokenValue(formatUnits(currentBuyFunds.balance, currentBuyFunds.decimals)) : currentBuyFunds?.status === "loading" && connected ? t("launchBalanceLoading") : "—"} {currency}</b></div>
              <label htmlFor="sauce-creator-buy" className="block mb-2 text-[#bdc4ce] text-sm">{t("launchCreatorBuyAmount")}</label>
              <div className="relative"><input id="sauce-creator-buy" data-sauce-creator-buy-input="" className={`${launchInput} min-h-14 pr-20 text-base [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`} type="number" min="0" step="any" inputMode="decimal" placeholder="0.02" value={values.creatorBuyAmount} onChange={e => setField("creatorBuyAmount", e.target.value)} /><span className="right-4 absolute inset-y-0 flex items-center text-[#e1e4e7] text-sm pointer-events-none">{currency}</span></div>
              <div className="gap-2 grid grid-cols-4 mt-3">{[25, 50, 75, 100].map(percent => <button key={percent} type="button" data-buy-percent={percent} className="border-[#3d464d] enabled:hover:border-[#bca139] disabled:opacity-35 border rounded-md min-h-11 text-[#c7cdd3] text-xs enabled:hover:text-[#ffda46] disabled:cursor-not-allowed" disabled={!buyBalanceReady || maxCreatorBuy <= 0n} onClick={() => applyBuyPercentage(percent)}>{percent === 100 ? t("launchMax") : `${percent}%`}</button>)}</div>
              {
                !connected ? <p className="mt-3 text-[#9ca7b5] text-xs">{t("launchBuyConnectHint")}</p> :
                  currentBuyFunds?.status === "error" ? <div role="status" className="flex items-center gap-3 mt-3 text-amber-200 text-xs"><span>{t("launchBalanceError")}</span><button type="button" className="text-[#ffda46] underline underline-offset-4" onClick={() => setBalanceRefresh(value => value + 1)}>{t("launchRefreshBalance")}</button></div> : null}
              <p className="mt-3 text-[#929eac] text-[11px] leading-6">{t("launchBuyAmountHint")}</p>
            </div> : null}
          </LaunchSection>
          <section className="border-[#30373f] p-5 sm:p-7 border-b"><details><summary className="flex items-center gap-2 font-medium text-sm cursor-pointer">{t("launchLinks")}<ChevronRight size={17} className="text-[#ffda46]" /></summary><div className="gap-4 grid sm:grid-cols-2 mt-5">{launchLinkFields.map(field => <LaunchField key={field.key} label={t(field.labelKey)}><input className={launchInput} type="url" value={values[field.key]} placeholder={t(field.labelKey)} onChange={e => setField(field.key, e.target.value)} /></LaunchField>)}</div></details></section>
          <div className="p-5 sm:p-7">{errors.length ? <div role="alert" className="bg-[#322019] mt-5 p-4 rounded-lg text-[#ffd0b5] text-xs leading-6"><b>{t("launchCheckErrors")}</b><ul className="mt-2 pl-4 list-disc">{errors.map(key => <li key={key}>{t(key)}{key === "launchErrorCreateFloor" && floorPreview ? <span className="block mt-1 text-[#ffe091]">{t("launchFloorCurrent")}: ${formatTruncated(formatUnits(floorPreview.quoteUsdWad, 18))} · {t("launchFloorRequired")}: ${formatTruncated(formatUnits(floorPreview.createFloorUsdWad, 18))}<br />{t("launchFloorShortfall")}: {formatTruncated(formatUnits(floorPreview.shortfallQuote, quoteDecimalsEstimate))} {currency} (${formatTruncated(formatUnits(floorPreview.shortfallUsdWad, 18))})</span> : null}</li>)}</ul></div> : null}<div className="flex flex-wrap gap-3 mt-5"><Button type="submit" className={goldButton} disabled={!connected || generatingAddress || validatingTime} loading={validatingTime}>{t("launchPreview")}<ArrowRight size={16} /></Button></div></div>
        </>}
      </form>
        {/* Right rail: process guide and live totals. It stacks after the form on phones. */}
        <aside className="xl:top-6 xl:sticky gap-4 grid sm:grid-cols-2 xl:grid-cols-1"><div className={`${launchCard} p-5`}><h2 className="font-semibold text-[#ffda46] text-sm">{t("launchProcess")}</h2><ol className="space-y-5 mt-5">{launchProcessSteps.map((step, index) => <li key={step.titleKey} className="flex gap-3"><span className="flex justify-center items-center border-[#5d5331] border rounded-full w-6 h-6 text-[#9e8b45] text-[10px] shrink-0">0{index + 1}</span><div><b className="text-xs">{t(step.titleKey)}</b><p className="mt-1 text-[#9faab8] text-[11px] leading-5">{t(step.descriptionKey)}</p></div></li>)}</ol></div><div className={`${launchCard} p-5`}><h2 className="font-semibold text-sm">{t("launchSummary")} <small className="ml-2 font-normal text-[#a1acb8] text-[10px]">{t("launchLive")}</small></h2><div className="flex items-center gap-3 border-[#30373f] mt-4 pb-4 border-b"><div className="flex justify-center items-center bg-[#11181d] rounded-lg w-10 h-10 overflow-hidden">{logo}</div><div className="min-w-0"><b className="block text-xs truncate">{values.name || t("launchYourToken")}</b><span className="text-[#a0a9b5] text-[10px]">{values.symbol || "TOKEN"}</span></div></div><dl className="mt-3">{detail(t("launchSupply"), launchNumber(values.supply))}{detail(t("launchAllocation"), formatTokenValue(values.totalAmount))}{detail(t("launchEnergyPerLot"), `${launchNumber(values.unitEnergyPrice)} ${t("energy")}`)}{detail(t("launchPricePerLot"), `${values.unitCashPrice} ${currency}`)}{detail(t("launchMaxRaise"), `${launchNumber(maxRaise)} ${currency}`)}{detail(t("launchBuySellTax"), `${values.buyTax}% / ${values.sellTax}%`)}</dl><div className="flex justify-between gap-3 border-[#30373f] mt-5 pt-4 border-t text-xs"><span className="text-[#b2bbc7]">{t("launchSaltLockFee")}</span><b className="text-[#ffda46]">{saltLockFee.status === "ready" && saltLockFee.amount !== null ? `${formatUnits(saltLockFee.amount, 18)} BNB` : t(saltLockFee.status === "error" ? "launchSaltFeeUnavailable" : "launchSaltFeeLoading")}</b></div>{values.mode === "buy" ? <div className="flex justify-between gap-3 mt-2 text-xs"><span className="text-[#b2bbc7]">{t("launchCreatorBuyAmount")}</span><b className="text-[#ffda46]">{creatorBuyDisplay} {currency}</b></div> : null}<div className="flex justify-between gap-3 border-[#30373f] mt-3 pt-3 border-t text-xs"><span className="text-[#b2bbc7]">{t("launchTotalNativePayment")}</span><b className="text-[#ffda46]">{nativeCreationValue !== null ? `${formatTruncated(formatUnits(nativeCreationValue, 18))} BNB` : t(saltLockFee.status === "error" ? "launchSaltFeeUnavailable" : "launchSaltFeeLoading")}</b></div></div>{connected && wrongNetwork ? <Button variant="outline" onClick={onSwitch}>{t("switchNetwork")}</Button> : null}</aside></div>}
  </main>;
}

// Staking balances come from StakeFarm; history comes from FSI.
type StakeAction = "stake" | "redeem";
type StakeHistoryRow = { emitter: string; ns: string; id: string; actor: string; related: string; amount: string; extra: string; blockNumber: number | string; logIndex: number; txHash: string; updatedAt: number; confirmed: boolean };
type StakeHistoryPage = { items: StakeHistoryRow[]; nextCursor?: string | null };
// FSI G namespace: actor is the wallet, related is the staked token, id 1/2 is add/redeem.
async function readStakeHistory(sdk: FlapChainSdk, farm: Address, account: Address, cursor = ""): Promise<StakeHistoryPage> {
  const response = await sdk.readFsi<StakeHistoryPage>(`${farm.toLowerCase()}/G/stakeHistory`, {
    actor: account.toLowerCase(), sort: "time_desc", limit: String(STAKE_HISTORY_PAGE_SIZE), cursor,
  });
  if (!response || !Array.isArray(response.items) || response.items.length > STAKE_HISTORY_PAGE_SIZE || (response.nextCursor != null && typeof response.nextCursor !== "string")) throw new Error("Invalid FSI page");
  const nsHex = "0x7374616b65486973746f7279000000000000000000000000000000000000000000";
  const items = response.items.filter(row => {
    if (!row || typeof row.emitter !== "string" || row.emitter.toLowerCase() !== farm.toLowerCase() || typeof row.actor !== "string" || row.actor.toLowerCase() !== account.toLowerCase() || (row.ns !== "stakeHistory" && row.ns?.toLowerCase() !== nsHex) || row.confirmed !== true) throw new Error("FSI record identity mismatch");
    if (!isAddress(row.related) || !/^(1|2)$/.test(row.id) || !/^\d+$/.test(row.amount) || !/^0x[0-9a-f]{64}$/i.test(row.txHash) || !Number.isSafeInteger(row.logIndex) || row.logIndex < 0 || !Number.isSafeInteger(row.updatedAt) || row.updatedAt <= 0) throw new Error("Invalid FSI record");
    return BigInt(row.amount) > 0n;
  });
  return { items, nextCursor: response.nextCursor };
}
const stakeDate = (at: number) => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(at));
const extraRewardDate = (at: number) => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(at));


// Open-dialog queries only. Purchase/refund emitters are Preparation instances;
// creation emits from LaunchPad. FSI amounts for purchases/refunds are LOTS, not wei.
type IdoHistoryNamespace = "idoCreated" | "idoPurchase" | "idoRefund";
type IdoHistorySource = { emitter: Address; ns: IdoHistoryNamespace; cursor: string };
type IdoHistoryRow = StakeHistoryRow & { kind: IdoHistoryNamespace };
async function readIdoHistory(sdk: FlapChainSdk, source: IdoHistorySource, account: Address) {
  const path = `${source.emitter.toLowerCase()}/G/${source.ns}`;
  const query = {
    actor: account.toLowerCase(), sort: "time_desc", limit: String(IDO_HISTORY_PAGE_SIZE), cursor: source.cursor,
  };
  const response = await sdk.readFsi<StakeHistoryPage>(path, query);
  if (source.ns === "idoCreated") console.log("[SAUCE] My launches FSI response", { path, query, response });
  if (!response || !Array.isArray(response.items) || response.items.length > IDO_HISTORY_PAGE_SIZE || (response.nextCursor != null && typeof response.nextCursor !== "string")) throw new Error("Invalid FSI history page");
  const encodedNamespace = `0x${Array.from(source.ns, char => char.charCodeAt(0).toString(16)).join("").padEnd(64, "0")}`;
  const items: IdoHistoryRow[] = response.items.map(row => {
    if (!row || typeof row.emitter !== "string" || row.emitter.toLowerCase() !== source.emitter.toLowerCase() || typeof row.actor !== "string" || row.actor.toLowerCase() !== account.toLowerCase() || (row.ns !== source.ns && row.ns?.toLowerCase() !== encodedNamespace) || row.confirmed !== true) throw new Error("FSI history identity mismatch");
    if (!isAddress(row.related) || !/^\d+$/.test(row.id) || !/^\d+$/.test(row.amount) || !/^\d+$/.test(row.extra) || !/^0x[0-9a-f]{64}$/i.test(row.txHash) || !Number.isSafeInteger(row.logIndex) || row.logIndex < 0 || !Number.isSafeInteger(row.updatedAt) || row.updatedAt <= 0) throw new Error("Invalid FSI history row");
    if (source.ns === "idoCreated" ? BigInt(row.id) >= 2n ** 160n : BigInt(row.id) !== 0n) throw new Error("Invalid FSI history id");
    return { ...row, kind: source.ns };
  });
  return { items, next: response.nextCursor && response.nextCursor !== source.cursor ? { ...source, cursor: response.nextCursor } : null };
}

function IdoHistory({ sdk, account, launchPad, projects, projectsLoading, kind, t }: {
  sdk: FlapChainSdk; account: Address | null; launchPad?: Address; projects: Project[]; projectsLoading: boolean;
  kind: "records" | "launches"; t: (key: string) => string;
}) {
  const [state, setState] = useState<{ key: string; loading: boolean; items: IdoHistoryRow[]; pending: IdoHistorySource[] }>({ key: "", loading: true, items: [], pending: [] });
  const [moreBusy, setMoreBusy] = useState(false);
  const snapshot = useRef({ sdk, projects });
  snapshot.current = { sdk, projects };
  // A list's price/countdown changes must not refetch open-dialog history.
  const emitters = [...new Set(projects.flatMap(project => project.preparationAddress ? [project.preparationAddress.toLowerCase()] : []))].sort().join(",");
  const key = `${sdk.context.chainId}:${account?.toLowerCase()}:${launchPad?.toLowerCase()}:${kind}:${kind === "records" ? emitters : ""}`;
  const activeKey = useRef(key);
  activeKey.current = key;
  useEffect(() => {
    activeKey.current = key;
    return () => { activeKey.current = ""; };
  }, [key]);
  async function readSources(sources: IdoHistorySource[], wallet: Address, client: FlapChainSdk, isActive: () => boolean) {
    const items: IdoHistoryRow[] = [], pending: IdoHistorySource[] = [];
    for (let offset = 0; offset < sources.length; offset += IDO_HISTORY_CONCURRENCY) {
      if (!isActive()) throw new Error("History dialog closed or account changed");
      const pages = await Promise.all(sources.slice(offset, offset + IDO_HISTORY_CONCURRENCY).map(source => readIdoHistory(client, source, wallet)));
      for (const page of pages) { items.push(...page.items); if (page.next) pending.push(page.next); }
    }
    return { items, pending };
  }
  function mergeRows(rows: IdoHistoryRow[]) {
    return [...new Map(rows.map(row => [`${row.emitter.toLowerCase()}:${row.txHash.toLowerCase()}:${row.logIndex}`, row])).values()]
      .sort((a, b) => b.updatedAt - a.updatedAt || (BigInt(a.blockNumber) > BigInt(b.blockNumber) ? -1 : BigInt(a.blockNumber) < BigInt(b.blockNumber) ? 1 : b.logIndex - a.logIndex));
  }
  useEffect(() => {
    let active = true;
    setState({ key, loading: true, items: [], pending: [] });
    if (!account || !launchPad || projectsLoading) return;
    const sources: IdoHistorySource[] = kind === "launches" ? [{ emitter: launchPad, ns: "idoCreated", cursor: "" }]
      : emitters.split(",").filter(Boolean).flatMap(emitter => (["idoPurchase", "idoRefund"] as const).map(ns => ({ emitter: emitter as Address, ns, cursor: "" })));
    void readSources(sources, account, snapshot.current.sdk, () => active).then(result => {
      
      if (active) setState({ key, loading: false, items: mergeRows(result.items), pending: result.pending });
    }).catch(cause => { if (active) console.error("[SAUCE] FSI IDO history failed", cause); });
    return () => { active = false; };
  }, [key, account, launchPad, kind, emitters, projectsLoading]);
  async function loadMore() {
    if (!account || moreBusy || !state.pending.length) return;
    const requestKey = key;
    setMoreBusy(true);
    try {
      const result = await readSources(state.pending, account, snapshot.current.sdk, () => activeKey.current === requestKey);
      if (activeKey.current === requestKey) setState(current => ({ ...current, items: mergeRows([...current.items, ...result.items]), pending: result.pending }));
    } catch (cause) { console.error("[SAUCE] FSI IDO history pagination failed", cause); }
    finally { setMoreBusy(false); }
  }
  if (!account) return <p className="py-10 text-[#a7aeb8] text-center text-sm">{t("stakeConnectHistory")}</p>;
  if (state.key !== key || state.loading) return <p className="py-10 text-[#a7aeb8] text-center text-sm">{t("stakeHistoryLoading")}</p>;
  return <>
    {state.items.length ? state.items.map(record => {
      const item = projects.find(project => record.kind === "idoCreated"
        ? project.preparationAddress?.toLowerCase() === record.related.toLowerCase() || BigInt(project.tokenAddress) === BigInt(record.id)
        : project.preparationAddress?.toLowerCase() === record.emitter.toLowerCase());
      const title = item?.projectTitle || item?.name || (record.kind === "idoCreated" ? `0x${BigInt(record.id).toString(16).padStart(40, "0")}` : record.emitter);
      return <div key={`${record.emitter}:${record.txHash}:${record.logIndex}`} className="flex items-start gap-3 border-white/10 py-4 border-t">
        {item ? <ProjectImage sdk={sdk} project={item} alt={title} /> : null}
        <div className="flex-1 min-w-0"><div className="flex flex-wrap justify-between items-center gap-2"><h3 className="font-semibold text-sm break-all">{title}</h3><span className="text-[#ffda46] text-xs">{t(record.kind === "idoCreated" ? "idoHistoryCreated" : record.kind === "idoRefund" ? "idoHistoryRefund" : "idoHistoryPurchase")}</span></div>
          <p className="mt-1 text-[#87919a] text-[10px]">{stakeDate(record.updatedAt * 1000)}</p>
          {record.kind !== "idoCreated" ? <><p className="mt-2 text-[#a7aeb8] text-xs">{t("quantity")}: {formatTruncated(record.amount)}</p>
            {item ? <p className="mt-1 text-[#a7aeb8] text-xs">{t(record.kind === "idoRefund" ? "idoHistoryCashRefund" : "idoHistoryCashPaid")}: {projectAmount(BigInt(record.amount) * item.price, item.quoteDecimals)} {item.quoteSymbol}</p> : null}
            <p className="mt-1 text-[#a7aeb8] text-xs">{t(record.kind === "idoRefund" ? "idoHistoryEnergyRefund" : "idoHistoryEnergyUsed")}: {formatEnergy(BigInt(record.extra))}</p></> : null}
        </div>
      </div>;
    }) : <p className="py-10 text-[#a7aeb8] text-center text-sm">{t(kind === "launches" ? "myNoLaunches" : "noRecords")}</p>}
    {state.pending.length ? <div className="flex justify-center p-4 text-xs"><button type="button" disabled={moreBusy} className="disabled:opacity-40 text-[#ffda46]" onClick={() => void loadMore()}>{t(moreBusy ? "stakeHistoryLoading" : "stakeHistoryMore")}</button></div> : null}
  </>;
}

function StakeStatus({ t, effective }: { t: (key: string) => string; effective: boolean }) {
  return <span className={`inline-flex items-center gap-1 rounded border border-[#333a42] bg-[#111619] px-2 py-1 text-[10px] ${effective ? "text-[#ffda46]" : "text-[#aeb7b7]"}`}>{effective ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}{t(effective ? "stakeEffective" : "stakeIneffective")}</span>;
}
function StakeIcon({ poolIndex, alt }: { poolIndex: number; alt: string }) {
  const token = allTokens[poolIndex];
  return <span className="flex justify-center items-center bg-[#252d35] rounded-[10px] w-[41px] h-[41px] text-[#8c98a6] overflow-hidden shrink-0">
    {token ? <IpfsImage cid={token.imageCid} alt={alt} className="w-full h-full object-cover" /> : <svg aria-hidden="true" width="22" height="22" viewBox="0 0 256 256" fill="currentColor"><path d="M184,89.57V84c0-25.08-37.83-44-88-44S8,58.92,8,84v40c0,20.89,26.25,37.49,64,42.46V172c0,25.08,37.83,44,88,44s88-18.92,88-44V132C248,111.3,222.58,94.68,184,89.57ZM232,132c0,13.22-30.79,28-72,28-3.73,0-7.43-.13-11.08-.37C170.49,151.77,184,139,184,124V105.74C213.87,110.19,232,122.27,232,132ZM72,150.25V126.46A183.74,183.74,0,0,0,96,128a183.74,183.74,0,0,0,24-1.54v23.79A163,163,0,0,1,96,152,163,163,0,0,1,72,150.25Zm96-40.32V124c0,8.39-12.41,17.4-32,22.87V123.5C148.91,120.37,159.84,115.71,168,109.93ZM96,56c41.21,0,72,14.78,72,28s-30.79,28-72,28S24,97.22,24,84,54.79,56,96,56ZM24,124V109.93c8.16,5.78,19.09,10.44,32,13.57v23.37C36.41,141.4,24,132.39,24,124Zm64,48v-4.17c2.63.1,5.29.17,8,.17,3.88,0,7.67-.13,11.39-.35A121.92,121.92,0,0,0,120,171.41v23.46C100.41,189.4,88,180.39,88,172Zm48,26.25V174.4a179.48,179.48,0,0,0,24,1.6,183.74,183.74,0,0,0,24-1.54v23.79a165.45,165.45,0,0,1-48,0Zm64-3.38V171.5c12.91-3.13,23.84-7.79,32-13.57V172C232,180.39,219.59,189.4,200,194.87Z" /></svg>}
  </span>;
}

// Recheck the first configured asset on-chain before gated actions.
async function readEffectiveUser(sdk: FlapChainSdk, live: LiveStakeState, account: Address) {
  const pool = eligibilityStakePool(live);
  if (!pool || pool.decimals === null) throw new Error("stakeLoadFailed");
  const [info, threshold] = await Promise.all([
    sdk.readContract<StakeFarmAccountInfo>({ address: STAKE_FARM_ADDRESS, abi: STAKE_FARM_ABI, functionName: "accountInfoOf", args: [account, pool.pool.token] }),
    sdk.readContract<bigint>({ address: STAKE_FARM_ADDRESS, abi: STAKE_FARM_ABI, functionName: "energyStakeThreshold" }),
  ]);
  if (typeof threshold !== "bigint" || threshold < 0n) throw new Error("stakeLoadFailed");
  const required = stakeThresholdInTokenUnits({ ...live, energyStakeThreshold: threshold });
  if (required === null) throw new Error("stakeLoadFailed");
  return info.staticReward.staked >= required;
}
type ExtraRewardPlan = { index: bigint; address: Address; weight: bigint };
type RewardPoolInfo = readonly [bigint, bigint, bigint, bigint, bigint, boolean, boolean];
type RewardTokenDetails = { name: string; symbol: string; decimals: number | null };

function useExtraRewardCatalog(sdk: FlapChainSdk | null, pools: LiveStakePool[], ready: boolean) {
  const sdkRef = useRef(sdk); sdkRef.current = sdk;
  const poolKey = ready ? pools.map(row => row.pool.token.toLowerCase()).sort().join(",") : "";
  const factory = sdk?.context.manifest.walletContracts?.find(item => item.id === REWARD_FACTORY_ID && item.chainId === sdk.context.chainId);
  const factoryAddress = factory?.address.toLowerCase() === REWARD_FACTORY_ADDRESS.toLowerCase() ? REWARD_FACTORY_ADDRESS : undefined;
  const farm = sdk ? stakeFarmAddress(sdk) : "";
  const key = `${sdk?.context.chainId}:${farm}:${factory?.address}:${poolKey}`.toLowerCase();
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ key: string; loading: boolean; failed: boolean; byPool: Record<string, ExtraRewardPlan[]> }>({ key: "", loading: false, failed: false, byPool: {} });
  useEffect(() => {
    const current = sdkRef.current;
    if (!current || !ready || !poolKey || !factoryAddress) return;
    let active = true;
    setState({ key, loading: true, failed: false, byPool: {} });
    void (async () => {
      try {
        const [linkedFactory, linkedFarm, count] = await Promise.all([
          current.readContract<Address>({ address: STAKE_FARM_ADDRESS, abi: STAKE_FARM_ABI, functionName: "rewardDistributorFactory" }),
          current.readContract<Address>({ address: REWARD_FACTORY_ADDRESS, abi: REWARD_FACTORY_ABI, functionName: "stakeFarm" }),
          current.readContract<bigint>({ address: REWARD_FACTORY_ADDRESS, abi: REWARD_FACTORY_ABI, functionName: "distributorCount" }),
        ]);
        if (!active) return;
        if (linkedFactory.toLowerCase() === ZERO_ADDRESS) { setState({ key, loading: false, failed: false, byPool: {} }); return; }
        if (linkedFactory.toLowerCase() !== factoryAddress.toLowerCase() || linkedFarm.toLowerCase() !== farm.toLowerCase()) throw new Error("Reward factory / StakeFarm mismatch");
        const byPool: Record<string, ExtraRewardPlan[]> = {};
        let failed = false;
        // Enumerate history, not only activeDistributorsOf: archived rewards remain claimable.
        for (let start = 0n; start < count && active; start += BigInt(REWARD_DISCOVERY_BATCH_SIZE)) {
          const indexes: bigint[] = [];
          for (let i = start; i < count && i < start + BigInt(REWARD_DISCOVERY_BATCH_SIZE); i++) indexes.push(i);
          const batch = await Promise.allSettled(indexes.map(async index => {
            if (!active) return [];
            const contract = await current.resolveContract("reward-distributor", [index]);
            const matches: { pool: string; plan: ExtraRewardPlan }[] = [];
            // Bound reads even when many principal pools are configured.
            for (const pool of poolKey.split(",")) {
              if (!active) return matches;
              const info = await current.readContract<RewardPoolInfo>({ contract, abi: REWARD_DISTRIBUTOR_ABI, functionName: "poolInfoOf", args: [pool as Address] });
              if (info[5] && info[0] > 0n) matches.push({ pool, plan: { index, address: contract.address, weight: info[0] } });
            }
            return matches;
          }));
          if (!active) return;
          for (const result of batch) {
            if (result.status === "rejected") { failed = true; console.error("[SAUCE] Reward plan discovery failed", result.reason); continue; }
            for (const { pool, plan } of result.value) (byPool[pool] ??= []).push(plan);
          }
          setState({ key, loading: true, failed, byPool: Object.fromEntries(Object.entries(byPool).map(([pool, plans]) => [pool, [...plans]])) });
        }
        if (active) setState({ key, loading: false, failed, byPool });
      } catch (cause) {
        console.error("[SAUCE] Reward factory read failed", cause);
        if (active) setState({ key, loading: false, failed: true, byPool: {} });
      }
    })();
    return () => { active = false; };
  }, [key, poolKey, ready, factoryAddress, farm, retry]);
  return { ...(state.key === key ? state : { loading: false, failed: false, byPool: {} as Record<string, ExtraRewardPlan[]> }), retry: () => setRetry(value => value + 1) };
}

// Reward artwork is deliberately isolated from reward accounting reads. Older
// distributors, empty metadata, malformed JSON, and unavailable IPFS content
// all retain the default icon without putting the reward row into an error state.
function RewardTokenIcon({ sdk, plan, alt }: { sdk: FlapChainSdk; plan: ExtraRewardPlan; alt: string }) {
  const sdkRef = useRef(sdk); sdkRef.current = sdk;
  const [imageCid, setImageCid] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const identity = `${sdk.context.chainId}:${plan.address}:${plan.index}`.toLowerCase();
  useEffect(() => {
    const current = sdkRef.current;
    let active = true;
    setImageCid(null);
    setImageFailed(false);
    void (async () => {
      const contract = await current.resolveContract("reward-distributor", [plan.index]);
      if (contract.address.toLowerCase() !== plan.address.toLowerCase()) return;
      const metadataCid = (await current.readContract<string>({ contract, abi: REWARD_DISTRIBUTOR_ABI, functionName: "metaCID" })).trim().replace(/^ipfs:\/\//i, "");
      if (!metadataCid) return;
      const metadata = JSON.parse(await current.readIpfsText(metadataCid)) as { image?: unknown };
      const image = typeof metadata.image === "string" ? metadata.image.trim().replace(/^ipfs:\/\//i, "") : "";
      if (active && /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})$/.test(image)) setImageCid(image);
    })().catch(() => { /* Optional artwork falls back to the default icon. */ });
    return () => { active = false; };
  }, [identity, plan.address, plan.index]);
  return <span className="flex justify-center items-center bg-[#252b2a] rounded-lg text-[#a4ad99] overflow-hidden shrink-0 size-8">
    {imageCid && !imageFailed ? <IpfsImage cid={imageCid} alt={alt} className="object-cover size-full" onError={() => setImageFailed(true)} /> : <Coins aria-hidden="true" size={17} />}
  </span>;
}

function ExtraRewardRow({ sdk, plan, poolToken, connected, chainTime, t, revision, onFeedback, onVisibilityChange }: {
  sdk: FlapChainSdk; plan: ExtraRewardPlan; poolToken: Address; connected: boolean; chainTime: bigint | null; t: (key: string) => string; revision: string;
  onFeedback: (key: string, tone: "success" | "warning" | "error") => void;
  onVisibilityChange: (address: Address, hidden: boolean) => void;
}) {
  const account = connected ? sdk.wallet.address : undefined;
  const sdkRef = useRef(sdk); sdkRef.current = sdk;
  const accountKey = `${sdk.context.chainId}:${account ?? ""}:${plan.address}:${poolToken}`.toLowerCase();
  const keyRef = useRef(accountKey); keyRef.current = accountKey;
  const [details, setDetails] = useState<{ token: Address; "metadata": RewardTokenDetails; start: bigint; end: bigint; rewardPerDay: bigint; totalWeight: bigint; funded: boolean } | null>(null);
  const [pending, setPending] = useState<bigint | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [reload, setReload] = useState(0);
  const [pendingRefresh, setPendingRefresh] = useState(0);
  useEffect(() => {
    const current = sdkRef.current;
    let active = true;
    setDetails(null); setFailed(false);
    void (async () => {
      try {
        const contract = await current.resolveContract("reward-distributor", [plan.index]);
        if (contract.address.toLowerCase() !== plan.address.toLowerCase()) throw new Error("Reward target changed");
        const [token, tokenInfo, start, end, rewardPerDay, totalWeight, funded] = await Promise.all([
          current.readContract<Address>({ contract, abi: REWARD_DISTRIBUTOR_ABI, functionName: "rewardToken" }),
          current.readContract<readonly [name: string, symbol: string, decimals: number]>({ contract, abi: REWARD_DISTRIBUTOR_ABI, functionName: "rewardTokenInfo" }),
          current.readContract<bigint>({ contract, abi: REWARD_DISTRIBUTOR_ABI, functionName: "startTime" }),
          current.readContract<bigint>({ contract, abi: REWARD_DISTRIBUTOR_ABI, functionName: "endTime" }),
          current.readContract<bigint>({ contract, abi: REWARD_DISTRIBUTOR_ABI, functionName: "rewardPerDay" }),
          current.readContract<bigint>({ contract, abi: REWARD_DISTRIBUTOR_ABI, functionName: "totalWeight" }),
          current.readContract<boolean>({ contract, abi: REWARD_DISTRIBUTOR_ABI, functionName: "isFunded" }),
        ]);
        const decimals = Number(tokenInfo[2]);
        const tokenDetails: RewardTokenDetails = {
          name: tokenInfo[0],
          symbol: tokenInfo[1],
          decimals: Number.isInteger(decimals) && decimals >= 0 && decimals <= 255 ? decimals : null,
        };
        if (active) setDetails({ token, "metadata": tokenDetails, start, end, rewardPerDay, totalWeight, funded });
      } catch (cause) { console.error("[SAUCE] Reward details read failed", cause); if (active) setFailed(true); }
    })();
    return () => { active = false; };
  }, [plan.index, plan.address, sdk.context.chainId, reload]);
  useEffect(() => {
    const current = sdkRef.current;
    let active = true, inFlight = false;
    setPending(null);
    if (!account) return;
    const load = async () => {
      if (inFlight || busyRef.current || !active) return;
      inFlight = true;
      try {
        const contract = await current.resolveContract("reward-distributor", [plan.index]);
        if (!active) return;
        if (contract.address.toLowerCase() !== plan.address.toLowerCase()) throw new Error("Reward target changed");
        const value = await current.readContract<bigint>({ contract, abi: REWARD_DISTRIBUTOR_ABI, functionName: "pendingRewardOf", args: [poolToken, account] });
        if (active) setPending(value);
      } catch (cause) { console.error("[SAUCE] Extra reward pending read failed", cause); }
      finally { inFlight = false; }
    };
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [accountKey, account, plan.index, plan.address, poolToken, revision, reload, pendingRefresh]);
  async function claim() {
    if (busyRef.current || !account || !pending || !details?.funded) return;
    const current = sdkRef.current, submittedKey = accountKey;
    busyRef.current = true; setBusy(true);
    try {
      if (current.wallet.isWrongNetwork) { await current.wallet.switchChain(); return; }
      const contract = await current.resolveContract("reward-distributor", [plan.index]);
      if (contract.address.toLowerCase() !== plan.address.toLowerCase()) throw new Error("Reward target changed");
      const amount = await current.readContract<bigint>({ contract, abi: REWARD_DISTRIBUTOR_ABI, functionName: "pendingRewardOf", args: [poolToken, account] });
      if (keyRef.current !== submittedKey) return;
      if (amount === 0n) { setPending(0n); return; }
      const prepared = await current.simulateContract({ contract, abi: REWARD_DISTRIBUTOR_ABI, functionName: "claim", args: [poolToken], account });
      const hash = await current.writeContract(prepared.request);
      const receipt = await current.waitForTx(hash);
      if (receipt.status !== "success") throw new Error("Reward claim reverted");
      if (keyRef.current === submittedKey) {
        onFeedback("extraRewardClaimSuccess", "success"); setPendingRefresh(value => value + 1);
      }
    } catch (cause) {
      console.error("[SAUCE] Extra reward claim failed", cause);
    }
    finally { busyRef.current = false; if (keyRef.current === submittedKey) setBusy(false); }
  }
  const metadata = details?.metadata;
  const hidden = connected && chainTime !== null && details !== null && chainTime > details.end && pending === 0n;
  useEffect(() => {
    onVisibilityChange(plan.address, hidden);
  }, [hidden, onVisibilityChange, plan.address]);
  const dailyEmission = details && details.totalWeight > 0n && metadata?.decimals !== null && metadata?.decimals !== undefined
    ? formatTruncated(formatUnits(details.rewardPerDay * plan.weight / details.totalWeight, metadata.decimals))
    : "—";
  const amount = pending !== null && metadata?.decimals !== null && metadata?.decimals !== undefined ? formatTruncated(formatUnits(pending, metadata.decimals)) : "—";
  if (hidden) return null;
  return <div data-sauce-extra-reward={plan.address} className="md:items-center gap-x-4 gap-y-3 border-[#31372e] grid grid-cols-2 md:grid-cols-[minmax(140px,1.2fr)_0.6fr_1fr_1fr_90px] px-4 py-4 border-t text-xs">
    <div className="flex items-center gap-2 col-span-2 md:col-span-1 min-w-0"><RewardTokenIcon sdk={sdk} plan={plan} alt={metadata?.symbol ?? t("extraRewardToken")} /><div className="min-w-0"><b className="block truncate" title={metadata?.name}>{metadata?.name ?? (failed ? t("stakeLoadFailed") : t("extraRewardsLoading"))}</b>{details ? <CopyButton value={details.token} label={`${details.token.slice(0, 6)}…${details.token.slice(-4)}`} className="gap-1 hover:bg-transparent mt-1 p-0 h-auto min-h-6 text-[#929eaa] text-[10px] hover:text-[#ffda46] normal-case [&_svg]:size-3" /> : <small className="block mt-1 text-[#929eaa]">—</small>}</div></div>
    <div className="min-w-0"><span className="block md:hidden mb-1 text-[#929eaa] text-[10px]">{t("extraRewardDailyEmission")}</span><b className="break-words tabular-nums">{dailyEmission}</b><small className="ml-1 text-[#929eaa] text-[10px]">{metadata?.symbol}</small></div>
    <div className="text-[10px] leading-5"><span className="block md:hidden text-[#929eaa]">{t("extraRewardStart")}</span><span className="block">{details ? extraRewardDate(Number(details.start) * 1000) : "—"}</span>{details ? <small className="block text-[#87929f]">{t("extraRewardEnd")}: {extraRewardDate(Number(details.end) * 1000)}</small> : null}</div>
    <div className="min-w-0"><span className="block md:hidden mb-1 text-[#929eaa] text-[10px]">{t("extraRewardClaimable")}</span><b className="text-[#e6d077] break-words tabular-nums">{connected ? amount : "—"}</b><small className="block mt-1 text-[#929eaa] truncate">{metadata?.symbol}</small></div>
    <div className="flex justify-end">{failed ? <Button variant="ghost" size="sm" className={stakeAddButtonClass} onClick={() => setReload(value => value + 1)}>{t("stakeRetry")}</Button> : <Button variant="ghost" size="sm" loading={busy} disabled={!account || pending === null || pending <= 0n || !details?.funded || busy} className={stakeAddButtonClass} onClick={() => void claim()}>{t(sdk.wallet.isWrongNetwork ? "switchNetwork" : busy ? "extraRewardClaiming" : "extraRewardClaim")}</Button>}</div>
  </div>;
}

function ExtraRewards({ sdk, plans, pool, connected, chainTime, t, onFeedback, onVisibleCountChange }: { sdk: FlapChainSdk; plans: ExtraRewardPlan[]; pool: LiveStakePool; connected: boolean; chainTime: bigint | null; t: (key: string) => string; onFeedback: (key: string, tone: "success" | "warning" | "error") => void; onVisibleCountChange: (count: number) => void }) {
  const [page, setPage] = useState(0);
  const [hiddenPlans, setHiddenPlans] = useState<Record<string, boolean>>({});
  useEffect(() => setHiddenPlans({}), [connected, sdk.wallet.address]);
  const visiblePlans = plans.filter(plan => !hiddenPlans[plan.address.toLowerCase()]);
  const pageCount = Math.ceil(visiblePlans.length / EXTRA_REWARD_PAGE_SIZE);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  const revision = `${pool.staked}:${pool.totalStaked}`;
  const onVisibilityChange = (address: Address, hidden: boolean) => {
    const key = address.toLowerCase();
    setHiddenPlans(current => current[key] === hidden ? current : { ...current, [key]: hidden });
  };
  useEffect(() => onVisibleCountChange(visiblePlans.length), [onVisibleCountChange, visiblePlans.length]);
  return <div id={`extra-rewards-${pool.poolIndex}`} role="region" aria-label={`${pool.symbol} ${t("extraRewards")}`} className="border-[#4c4931] bg-[#151b18] mx-3 md:mr-5 mb-4 md:ml-12 border rounded-lg overflow-hidden">
    <div className="flex items-center gap-2 border-[#393c2d] px-4 py-3 border-b text-[#d8c878] text-xs"><Coins size={15} /><b>{t("extraRewards")}</b><span className="text-[#939e9a]">{visiblePlans.length}</span></div>
    <div className="gap-4 hidden md:grid grid-cols-[minmax(140px,1.2fr)_0.6fr_1fr_1fr_90px] bg-[#1b211d] px-4 py-2 text-[#939e9a] text-[10px]"><span>{t("extraRewardToken")}</span><span>{t("extraRewardDailyEmission")}</span><span>{t("extraRewardStart")}</span><span>{t("extraRewardClaimable")}</span><span className="text-right">{t("stakeActions")}</span></div>
    {visiblePlans.slice(currentPage * EXTRA_REWARD_PAGE_SIZE, (currentPage + 1) * EXTRA_REWARD_PAGE_SIZE).map(plan => <ExtraRewardRow key={`${sdk.context.chainId}:${sdk.wallet.address ?? ""}:${plan.address}:${pool.pool.token}`} sdk={sdk} plan={plan} poolToken={pool.pool.token} connected={connected} chainTime={chainTime} t={t} revision={revision} onFeedback={onFeedback} onVisibilityChange={onVisibilityChange} />)}
    {pageCount > 1 ? <div className="flex justify-end items-center gap-3 border-[#31372e] p-3 border-t text-xs"><Button variant="ghost" size="sm" className={stakeAddButtonClass} aria-label={t("extraRewardPrevious")} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronRight className="rotate-180" size={14} /></Button><span>{currentPage + 1} / {pageCount}</span><Button variant="ghost" size="sm" className={stakeAddButtonClass} aria-label={t("extraRewardNext")} disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}><ChevronRight size={14} /></Button></div> : null}
  </div>;
}

// Staking reads principal from StakeFarm and historical actions from the configured FSI deployment.
function StakingPage({ t, connected, live, energyBalance, onRefresh, onRetry, onConnect, onBack, onIDO, onEnergy, onAccount, onFeedback }: {
  t: (key: string) => string;
  connected: boolean; live: LiveStakeState; energyBalance: bigint | null; onRefresh: (token: Address) => void; onRetry: () => void; onConnect: () => void;
  onBack: () => void; onIDO: () => void; onEnergy: () => void; onAccount: () => void; onFeedback: (key: string, tone: "success" | "warning" | "error") => void;
}) {
  const miniApp = useMiniAppSdk();
  const farmDefinition = miniApp.context.manifest.walletContracts?.find(item => item.id === STAKE_FARM_CONTRACT_ID);
  let farmSdk: FlapChainSdk | null = null;
  try { if (farmDefinition) farmSdk = miniApp.forChain(farmDefinition.chainId); } catch { /* The host may not expose the configured chain. */ }
  const rewardClockDefinition = farmSdk?.context.manifest.walletContracts?.find(item => item.id === RELATION_CONTRACT_ID && item.chainId === farmSdk?.context.chainId);
  const rewardClockAddress = rewardClockDefinition?.address.toLowerCase() === RELATION_ADDRESS.toLowerCase() ? RELATION_ADDRESS : undefined;
  const rewardClockSdkRef = useRef(farmSdk); rewardClockSdkRef.current = farmSdk;
  const [rewardChainTime, setRewardChainTime] = useState<bigint | null>(null);
  useEffect(() => {
    const current = rewardClockSdkRef.current;
    setRewardChainTime(null);
    if (!current || !rewardClockAddress) return;
    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    void current.readContract<bigint>({ address: RELATION_ADDRESS, abi: RELATION_ABI, functionName: "timestemp" }).then(timestamp => {
      if (!active || timestamp <= 0n) return;
      const sampledAt = performance.now();
      const tick = () => setRewardChainTime(timestamp + BigInt(Math.floor((performance.now() - sampledAt) / 1000)));
      tick();
      timer = setInterval(tick, 1000);
    }).catch(cause => { console.error("[SAUCE] Reward chain time read failed", cause); });
    return () => { active = false; if (timer) clearInterval(timer); };
  }, [farmDefinition?.chainId, rewardClockAddress]);
  const [selectedAsset, setSelectedAsset] = useState<Address | null>(null);
  const [filter, setFilter] = useState<"all" | "mine">("all");
  const [query, setQuery] = useState("");
  const [action, setAction] = useState<StakeAction>("stake");
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<{ key: string; status: "loading" | "ready" | "error" | "guest"; items: StakeHistoryRow[]; cursor: string | null }>({ key: "", status: "guest", items: [], cursor: null });
  const extraRewards = useExtraRewardCatalog(farmSdk, live.rows, live.status === "ready");
  const [expandedRewards, setExpandedRewards] = useState<Record<string, boolean>>({});
  const [visibleRewardCounts, setVisibleRewardCounts] = useState<Record<string, number>>({});
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [historyMoreBusy, setHistoryMoreBusy] = useState(false);
  const historyAccount = farmSdk?.wallet.address ?? "";
  useEffect(() => setVisibleRewardCounts({}), [farmDefinition?.chainId, historyAccount]);
  const historyKey = `${farmSdk?.context.chainId}:${farmDefinition?.address.toLowerCase()}:${historyAccount.toLowerCase()}`;
  const historyKeyRef = useRef(historyKey);
  historyKeyRef.current = historyKey;
  const historySdkRef = useRef(farmSdk);
  historySdkRef.current = farmSdk;
  useEffect(() => {
    const sdk = historySdkRef.current;
    if (!connected || !historyAccount) { setHistory({ key: historyKey, status: "guest", items: [], cursor: null }); return; }
    if (!sdk) { setHistory({ key: historyKey, status: "error", items: [], cursor: null }); return; }
    let active = true;
    setHistory(current => ({ key: historyKey, status: "loading", items: current.key === historyKey ? current.items : [], cursor: null }));
    void (async () => {
      try {
        const page = await readStakeHistory(sdk, stakeFarmAddress(sdk), historyAccount as Address);
        if (active) setHistory({ key: historyKey, status: "ready", items: page.items, cursor: page.nextCursor || null });
      } catch (cause) {
        console.error("[SAUCE] FSI stake history failed", cause);
        if (active) setHistory({ key: historyKey, status: "error", items: [], cursor: null });
      }
    })();
    return () => { active = false; };
  }, [connected, historyAccount, historyKey, historyRefresh]);
  async function loadMoreHistory() {
    const sdk = historySdkRef.current, key = historyKey;
    if (!sdk || !history.cursor || historyMoreBusy || !historyAccount) return;
    setHistoryMoreBusy(true);
    try {
      const page = await readStakeHistory(sdk, stakeFarmAddress(sdk), historyAccount as Address, history.cursor);
      if (historyKeyRef.current !== key) return;
      setHistory(current => {
        const unique = new Map(current.items.map(row => [`${row.emitter}:${row.txHash}:${row.logIndex}`, row]));
        for (const row of page.items) unique.set(`${row.emitter}:${row.txHash}:${row.logIndex}`, row);
        return { ...current, items: [...unique.values()], cursor: page.nextCursor === current.cursor ? null : page.nextCursor || null };
      });
    } catch (cause) { console.error("[SAUCE] FSI history pagination failed", cause); }
    finally { setHistoryMoreBusy(false); }
  }
  const eligibilityPool = eligibilityStakePool(live);
  const eligibilityThreshold = stakeThresholdInTokenUnits(live);
  const eligibilityStaked = eligibilityPool?.staked ?? 0n;
  const effective = !eligibilityPool || eligibilityThreshold === null ? null : eligibilityStaked >= eligibilityThreshold;
  const eligibilityUnavailable = live.status === "error" || live.status === "ready" && (!eligibilityPool || live.energyStakeThreshold === null);
  const eligibilityProgress = eligibilityThreshold !== null && connected
    ? eligibilityThreshold === 0n ? 100 : Number((eligibilityStaked >= eligibilityThreshold ? eligibilityThreshold : eligibilityStaked) * 10_000n / eligibilityThreshold) / 100
    : 0;
  const missing = eligibilityThreshold === null || eligibilityStaked >= eligibilityThreshold ? 0n : eligibilityThreshold - eligibilityStaked;
  const selected = live.rows.find(row => row.pool.token.toLowerCase() === selectedAsset?.toLowerCase());
  const dialogSdkRef = useRef(farmSdk);
  dialogSdkRef.current = farmSdk;
  const dialogAccount = farmSdk?.wallet.address;
  const fundsKey = `${farmDefinition?.chainId}:${farmDefinition?.address}:${dialogAccount}:${selectedAsset}`.toLowerCase();
  const [dialogFunds, setDialogFunds] = useState<{ key: string; balance: bigint } | null>(null);
  const fundsReady = dialogFunds?.key === fundsKey;
  // Wallet funds are read only for the selected asset when the add dialog opens.
  // Stable primitive dependencies keep global energy updates from reloading this balance.
  useEffect(() => {
    if (!selectedAsset || action !== "stake" || !connected || !dialogAccount || !selected?.approved) return;
    let active = true;
    setDialogFunds(null);
    const sdk = dialogSdkRef.current;
    if (!sdk) return;
    void resolveStakePoolToken(sdk, selected.poolIndex, selectedAsset)
      .then(token => sdk.readContract<bigint>({ contract: token, abi: erc20Abi, functionName: "balanceOf", args: [dialogAccount] }))
      .then(balance => { if (active) setDialogFunds({ key: fundsKey, balance }); })
      .catch(cause => { console.error("[SAUCE] Stake dialog balance read failed", cause); if (active) setError("stakeLoadFailed"); });
    return () => { active = false; };
  }, [selectedAsset, action, connected, dialogAccount, selected?.approved, selected?.poolIndex, fundsKey]);
  const symbol = selected?.symbol ?? "";
  const limit = selected ? action === "stake" ? fundsReady ? dialogFunds!.balance : 0n : selected.staked : 0n;
  let amountWei = 0n;
  try { if (selected?.decimals !== null && selected && input.trim()) amountWei = parseUnits(input.trim(), selected.decimals); } catch { /* Invalid precision is handled below. */ }
  const amountValid = amountWei > 0n && amountWei <= limit;
  const wrongNetwork = farmSdk?.wallet.isWrongNetwork ?? false;
  const displayLive = (value: bigint, decimals: number | null, places = 4) => decimals === null ? "—" : formatTruncated(formatUnits(value, decimals), places);
  // APD uses 1e12 precision: 100 tokens × 0.01e12 / 1e12 = 1 energy per day.
  const dailyEnergyRaw = (row: LiveStakePool, principal = row.staked) => row.decimals === null || !connected || effective !== true || row.pool.isDisable || !row.isActive ? new Decimal(0) : new Decimal(formatUnits(principal, 18)).mul(row.pool.staticState.apd.toString()).div("1000000000000");
  const dailyEnergy = (row: LiveStakePool, principal = row.staked) => row.decimals === null ? "—" : formatTruncated(dailyEnergyRaw(row, principal));
  const dynamicApdRaw = (row: LiveStakePool) => row.decimals === null || !connected || effective !== true || row.pool.isDisable || !row.isActive ? new Decimal(0) : new Decimal(formatUnits(row.teamStaked, 18)).mul(row.pool.teamState.apd.toString()).div("1000000000000");
  const dynamicApd = (row: LiveStakePool) => row.decimals === null ? "—" : formatTruncated(dynamicApdRaw(row));
  const rows = live.rows.filter(row => !row.pool.isDisable && (filter === "all" || row.staked > 0n) && [row.name, row.symbol, row.pool.token].some(value => value.toLowerCase().includes(query.trim().toLowerCase())));
  const currentDailyEnergy = live.rows.reduce((total, row) => total.add(dailyEnergyRaw(row)).add(dynamicApdRaw(row)), new Decimal(0));
  const entries = history.key === historyKey ? history.items : [];
  const accessInFlight = useRef(false);
  async function checkAddAccess(asset: Address) {
    if (!farmSdk?.wallet.address) return false;
    const account = farmSdk.wallet.address;
    const firstPool = eligibilityStakePool(live);
    if (!firstPool) throw new Error("stakeLoadFailed");
    const relation = farmSdk.context.manifest.walletContracts?.find(item => item.id === RELATION_CONTRACT_ID && item.chainId === farmSdk.context.chainId && item.address.toLowerCase() === RELATION_ADDRESS.toLowerCase());
    if (!relation) throw new Error("myRelationUnavailable");
    const [root, parent] = await Promise.all([
      farmSdk.readContract<Address>({ address: RELATION_ADDRESS, abi: RELATION_ABI, functionName: "root" }),
      farmSdk.readContract<Address>({ address: RELATION_ADDRESS, abi: RELATION_ABI, functionName: "parentOf", args: [account] }),
    ]);
    if (root.toLowerCase() !== account.toLowerCase() && /^0x0{40}$/i.test(parent)) { onFeedback("stakeBindRequired", "warning"); onAccount(); return false; }
    if (asset.toLowerCase() !== firstPool.pool.token.toLowerCase() && !await readEffectiveUser(farmSdk, live, account)) {
      setError("stakeEffectiveRequired"); onFeedback("stakeEffectiveRequired", "warning"); return false;
    }
    return true;
  }
  async function choose(asset: Address, kind: StakeAction) {
    if (busy || accessInFlight.current) return;
    setError(""); setNotice("");
    accessInFlight.current = true;
    try {
      if (kind === "stake" && !await checkAddAccess(asset)) return;
      setDialogFunds(null); setSelectedAsset(asset); setAction(kind); setInput("");
    } catch (cause) { console.error("[SAUCE] Stake access check failed", cause); setError("stakeLoadFailed"); onFeedback("stakeLoadFailed", "error"); }
    finally { accessInFlight.current = false; }
  }
  function topUp() { if (eligibilityPool) choose(eligibilityPool.pool.token, "stake"); }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!connected) return;
    if (!farmSdk || !selected || !selected.approved || selected.decimals === null) { setError("stakeTokenUnavailable"); return; }
    if (wrongNetwork) { try { await farmSdk.wallet.switchChain(); } catch { setError("walletError"); } return; }
    if (!amountValid) { setError(amountWei > limit ? action === "stake" ? "stakeErrorBalance" : "stakeErrorRedeem" : "stakeErrorAmount"); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      if (action === "stake" && !await checkAddAccess(selected.pool.token)) return;
      const token = action === "stake" ? await resolveStakePoolToken(farmSdk, selected.poolIndex, selected.pool.token) : null;
      const allowance = token ? await farmSdk.readContract<bigint>({ contract: token, abi: erc20Abi, functionName: "allowance", args: [farmSdk.wallet.address, stakeFarmAddress(farmSdk)] }) : 0n;
      if (action === "stake" && allowance < amountWei) {
        setNotice("stakeApproving");
        if (!token) throw new Error("stakeTokenUnavailable");
        const prepared = await farmSdk.simulateContract({ contract: token, abi: erc20Abi, functionName: "approve", args: [stakeFarmAddress(farmSdk), amountWei], account: farmSdk.wallet.address });
        const hash = await farmSdk.writeContract(prepared.request);
        const receipt = await farmSdk.waitForTx(hash);
        if (receipt.status !== "success") throw new Error("Token approval reverted.");
      }
      setNotice("stakeSubmitting");
      await writeStakeFarm(farmSdk, selected.pool.token, amountWei, action === "stake" ? "stake" : "unstaked");
      setHistoryRefresh(value => value + 1);
      onFeedback(action === "stake" ? "stakeAddedSuccess" : "stakeReducedSuccess", "success");
      setInput(""); setNotice(""); setSelectedAsset(null); onRefresh(selected.pool.token);
    } catch (cause) {
      console.error("[SAUCE] StakeFarm write failed", cause);
    }
    finally { setBusy(false); }
  }

  return <main className="mx-auto py-7 max-w-[1500px] text-[#eaecf0]">
    <button type="button" className="flex items-center gap-2 mb-6 text-[#aab2be] text-xs" onClick={onBack}><ArrowLeft size={17} />{t("stakeBack")}</button>
    {/* 01. Page heading. */}
    <div className="mb-7">
      <div className="min-w-0"><h1 className="font-bold text-[clamp(29px,4vw,43px)] tracking-tight">{t("stakeTitle")}<span className="text-[#ffda46]">.</span></h1><p className="mt-3 text-[#b0b8c3] text-sm leading-7">{t("stakeIntro")}</p><p className="flex flex-wrap items-center gap-2 mt-3 text-[#a89a60] text-[10px]"><Clock size={13} />{t("stakeNoLock")}<span>·</span>{t("stakeTimeEnergy")}</p></div>
    </div>
    <div className="space-y-5">
      {/* 02. Asset orders span the desktop content width; hover and selection identify the active row. */}
      <section className="border-[#333a42] bg-[#111619] border rounded-xl min-w-0 overflow-hidden">
        <div className="p-4"><h2 className="font-semibold text-sm">{t("stakeOrders")}</h2><p className="mt-2 text-[#a4adba] text-xs">{t("stakeOrdersIntro")}</p></div>
        <div className="flex flex-wrap justify-between items-center gap-3 border-[#333a42] border-y p-3"><div className="flex gap-1" role="group" aria-label={t("stakeAssetFilter")}>{(["all", "mine"] as const).map(key => <button type="button" key={key} aria-pressed={filter === key} onClick={() => setFilter(key)} className={`min-h-11 rounded-md px-3 text-xs transition-colors hover:text-[#ffda46] focus-visible:outline focus-visible:outline-[#ffda46] ${filter === key ? "bg-[#292718] text-[#ffda46]" : "text-[#a5afbd]"}`}>{t(key === "all" ? "stakeAllAssets" : "stakeMyAssets")}</button>)}</div><label className="flex items-center gap-2 border-[#3b444e] focus-within:border-[#bca139] bg-[#0e1316] px-3 border rounded-lg focus-within:ring-1 focus-within:ring-[#bca139]/50 w-full sm:w-auto min-w-0 sm:min-w-[220px] min-h-11 text-[#8e9ba9]"><Search size={16} /><input className="bg-transparent w-full min-w-0 text-[#f0f0f0] text-xs placeholder:text-[#8b96a4] caret-[#ffda46] outline-none [color-scheme:dark]" aria-label={t("stakeSearch")} placeholder={t("stakeSearch")} value={query} onChange={e => setQuery(e.target.value)} /></label></div>
        <div className="gap-3 hidden md:grid grid-cols-[minmax(150px,1.5fr)_0.8fr_0.8fr_0.8fr_0.8fr_150px] bg-[#181d21] px-5 py-3 text-[#a7b0bb] text-[10px]"><span>{t("stakeAsset")}</span><span>{t("stakeMine")}</span><span>{t("stakeTotalStaked")}</span><span>{t("stakeDaily")}</span><span>{t("stakeDynamicApd")}</span><span>{t("stakeActions")}</span></div>
        {live.status === "loading" ? <div role="status" className="p-8 text-[#a4adba] text-center text-xs">{t("stakeLoadingPools")}</div>
          : live.status === "error" ? <div role="alert" className="flex flex-col items-center gap-3 p-8 text-[#ffbe98] text-center text-xs"><AlertCircle size={22} /><span>{t(farmSdk ? "stakeLoadFailed" : "stakeHostUnavailable")}</span><Button variant="outline" onClick={onRetry}>{t("stakeRetry")}</Button></div>
            : rows.length ? <div>{rows.map(row => {
              const asset = row.pool.token;
              const assetName = row.symbol;
              const plans = extraRewards.byPool[asset.toLowerCase()] ?? [];
              const visibleRewardCount = visibleRewardCounts[asset.toLowerCase()] ?? plans.length;
              const expanded = Boolean(expandedRewards[asset.toLowerCase()] && visibleRewardCount);
              return <div key={asset} data-sauce-stake-pool={asset}><article data-sauce-glow-row className={`grid grid-cols-2 gap-x-3 gap-y-4 border-t border-[#2c333a] px-4 py-4 md:min-h-[120px] md:grid-cols-[minmax(150px,1.5fr)_0.8fr_0.8fr_0.8fr_0.8fr_150px] md:items-center md:gap-4 md:px-5 md:py-[23px] ${selectedAsset?.toLowerCase() === asset.toLowerCase() || expanded ? "bg-[#22231a]" : ""}`}>
                <div className="flex items-center gap-3 col-span-2 md:col-span-1 min-w-0 min-h-11 text-left"><StakeIcon poolIndex={row.poolIndex} alt={assetName} /><div className="min-w-0">{visibleRewardCount ? <button type="button" className="block font-semibold text-left text-sm hover:text-[#ffda46] focus-visible:outline focus-visible:outline-[#ffda46]" aria-expanded={expanded} aria-controls={`extra-rewards-${row.poolIndex}`} onClick={() => setExpandedRewards(current => ({ ...current, [asset.toLowerCase()]: !expanded }))}>{assetName}</button> : <b className="block text-sm">{assetName}</b>}<CopyButton value={asset} label={`${asset.slice(0, 6)}…${asset.slice(-4)}`} className="gap-1 hover:bg-transparent mt-1 p-0 h-auto min-h-6 text-[#929fac] text-[10px] hover:text-[#ffda46] normal-case [&_svg]:size-3" />{visibleRewardCount ? <button type="button" className="flex items-center gap-1 mt-1 text-[#d9c779] text-[10px] hover:text-[#ffda46] focus-visible:outline focus-visible:outline-[#ffda46]" aria-expanded={expanded} aria-controls={`extra-rewards-${row.poolIndex}`} onClick={() => setExpandedRewards(current => ({ ...current, [asset.toLowerCase()]: !expanded }))}>{t("extraRewards")} {visibleRewardCount}<ChevronDown size={12} className={`transition-transform ${expanded ? "rotate-180" : ""}`} /></button> : null}</div></div>
                <div className="min-w-0 text-xs"><span className="block md:hidden mb-1 text-[#929fac] text-[10px]">{t("stakeMine")}</span><b className="tabular-nums">{connected ? displayLive(row.staked, row.decimals) : "—"}</b><small className="ml-1 text-[#929fac] text-[10px]">{assetName}</small></div>
                <div className="min-w-0 text-xs"><span className="block md:hidden mb-1 text-[#929fac] text-[10px]">{t("stakeTotalStaked")}</span><b className="tabular-nums">{row.totalStaked === null ? "—" : displayLive(row.totalStaked, row.decimals)}</b><small className="ml-1 text-[#929fac] text-[10px]">{assetName}</small></div>
                <div className="min-w-0 text-xs"><span className="block md:hidden mb-1 text-[#929fac] text-[10px]">{t("stakeDaily")}</span><b className="text-[#dcca75] tabular-nums">{connected && row.decimals !== null ? `+${dailyEnergy(row)}` : "—"}</b><small className="block mt-1 text-[#929fac] text-[10px]">{t(row.pool.isDisable ? "stakePoolDisabled" : "stakeEnergyDay")}</small></div>
                <div className="min-w-0 text-xs"><span className="block md:hidden mb-1 text-[#929fac] text-[10px]">{t("stakeDynamicApd")}</span><b className="text-[#dcca75] tabular-nums">{connected && row.decimals !== null ? `+${dynamicApd(row)}` : "—"}</b><small className="block mt-1 text-[#929fac] text-[10px]">{t(row.pool.isDisable ? "stakePoolDisabled" : "stakeEnergyDay")}</small></div>
                <div className="flex justify-end md:justify-start col-span-2 md:col-span-1"><div className="flex items-center gap-2"><button type="button" disabled={!connected || row.pool.isDisable || !row.approved || row.decimals === null} className="inline-flex justify-center items-center gap-1 border-[#78672b] enabled:hover:border-[#ffda46] bg-[#2b2818] enabled:hover:bg-[#393216] disabled:opacity-40 px-3 border rounded-md min-h-11 md:min-h-10 text-[#dac56c] text-[11px] enabled:hover:text-[#ffda46] transition-colors focus-visible:outline focus-visible:outline-[#ffda46]" aria-label={`${t("stakeAdd")} ${assetName}`} onClick={() => choose(asset, "stake")}><Plus size={13} />{t("stakeAdd")}</button><button type="button" disabled={!connected || row.staked <= 0n || !row.approved || row.decimals === null} className="inline-flex justify-center items-center gap-1 border-[#39434c] enabled:hover:border-[#bca139] disabled:opacity-40 px-3 border rounded-md min-h-11 md:min-h-10 text-[#c2c9d3] text-[11px] enabled:hover:text-[#ffda46] transition-colors focus-visible:outline focus-visible:outline-[#ffda46]" aria-label={`${t("stakeReduce")} ${assetName}`} onClick={() => choose(asset, "redeem")}><Minus size={13} />{t("stakeReduce")}</button></div></div>
              </article>{expanded && farmSdk ? <ExtraRewards sdk={farmSdk} plans={plans} pool={row} connected={connected} chainTime={rewardChainTime} t={t} onFeedback={onFeedback} onVisibleCountChange={count => setVisibleRewardCounts(current => current[asset.toLowerCase()] === count ? current : { ...current, [asset.toLowerCase()]: count })} /> : null}</div>;
            })}</div> : filter === "mine" ? <div className="p-8 text-center text-sm">{t("stakeNoPosition")}</div> : <div className="flex flex-col items-center gap-3 p-8 text-center"><Search size={24} className="text-[#ffda46]" /><h3 className="text-sm">{t("stakeNoMatch")}</h3></div>}
        {extraRewards.failed ? <div className="flex justify-end items-center gap-2 px-4 py-3 text-[#a4adba] text-[11px]"><span>{t("extraRewardsLoadFailed")}</span><button type="button" className="text-[#ffda46]" onClick={extraRewards.retry}>{t("stakeRetry")}</button></div> : null}
      </section>
      {/* 03. Eligibility, energy, history, and rules stack as full-width sections. */}
      <div className="space-y-5">
        <section className="border-[#333a42] bg-[#111619] p-5 border rounded-xl" aria-label={t("stakeEligibility")}>
          <div className="flex items-start gap-3">{connected && effective ? <ShieldCheck size={27} className="text-[#d3d68e] shrink-0" /> : <AlertCircle size={27} className="text-[#edb26d] shrink-0" />}<div><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold text-sm">{t(!connected ? "stakeConnectEligibility" : effective === null ? eligibilityUnavailable ? "stakeLoadFailed" : "stakeLoadingPools" : effective ? "stakeActiveEligibility" : "stakeInactiveEligibility")}</h2>{connected && effective !== null ? <StakeStatus t={t} effective={effective} /> : null}</div><p className="mt-2 text-[#b3bba8] text-[11px] leading-5">{t(!connected ? "stakeGuestEligibility" : effective === null ? eligibilityUnavailable ? "stakeLoadFailed" : "stakeLoadingPools" : effective ? "stakeActiveDesc" : "stakeInactiveDesc")}{connected && effective === false && eligibilityPool ? ` ${displayLive(missing, eligibilityPool.decimals)} ${eligibilityPool.symbol}.` : null}</p></div></div>
          <div className="mt-4 text-[#b3bba8] text-[10px]">{t("stakeThreshold")} <b className="ml-2 text-white text-xs">{connected && eligibilityPool ? displayLive(eligibilityStaked, eligibilityPool.decimals) : "—"} / {live.energyStakeThreshold === null ? "—" : formatEnergy(live.energyStakeThreshold)} {eligibilityPool?.symbol ?? allTokens[0].symbol}</b></div><div role="progressbar" aria-label={t("stakeEligibilityProgress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={eligibilityProgress} className="bg-[#383d2a] mt-2 rounded h-1 overflow-hidden"><div className="bg-[#d5c361] rounded h-full" style={{ width: `${eligibilityProgress}%` }} /></div>
          <button type="button" disabled={connected && effective === null} className="flex items-center gap-2 disabled:opacity-50 mt-4 text-[#e7d477] text-xs" onClick={!connected ? onConnect : effective ? onIDO : topUp}>{t(!connected ? "connect" : effective ? "stakeJoinIdo" : "stakeFillThreshold")}<ArrowRight size={14} /></button>
        </section>
        <section className="border-[#333a42] bg-[#111619] p-5 border rounded-xl"><div className="flex justify-between items-center gap-3"><h2 className="flex items-center gap-2 font-semibold text-sm"><Zap size={18} className="text-[#ffda46]" />{t("myEnergy")}</h2><button type="button" className="text-[#aeb6c1] text-[10px]" onClick={onEnergy}>{t("stakeAllDetails")} ↗</button></div><div className="gap-4 grid sm:grid-cols-2 mt-5"><div><span className="text-[#adb6a9] text-[10px]">{t("myEnergy")}</span><b className="block mt-1 text-lg">{connected && energyBalance !== null ? formatEnergy(energyBalance) : "—"}</b></div><div><span className="text-[#adb6a9] text-[10px]">{t("stakeCurrentYield")}</span><b className="block mt-1 text-lg">{connected && live.status === "ready" ? formatTruncated(currentDailyEnergy) : "—"} <small className="text-[10px]">{t("stakeEnergyPerDay")}</small></b><small className="text-[#959f8f] text-[10px]">{t("stakeAccrueNote")}</small></div></div><p className="flex gap-2 border-[#333a42] mt-5 pt-4 border-t text-[#b5bea9] text-[10px] leading-5"><Info size={15} className="text-[#c9c376] shrink-0" />{t("stakeSettlementNote")}</p></section>
        <section className="border-[#333a42] bg-[#111619] border rounded-xl overflow-hidden">
          <div className="flex flex-wrap justify-between items-center gap-3 border-[#333a42] p-4 border-b">
            <h2 className="text-[#ffda46] text-xs">{t("stakeHistory")}</h2>
            <span className="text-[#97a4b2] text-[10px]">{t("launchBeijingTime")}</span>
          </div>
          {entries.length ? <div className="divide-y divide-[#2d353d]">{entries.map(event => {
            const asset = live.rows.find(row => row.pool.token.toLowerCase() === event.related.toLowerCase());
            const symbol = asset?.symbol ?? `${event.related.slice(0, 6)}…${event.related.slice(-4)}`;
            const amount = asset?.decimals != null ? formatTruncated(formatUnits(BigInt(event.amount), asset.decimals)) : "—";
            return <div key={`${event.emitter}:${event.txHash}:${event.logIndex}`} className="gap-2 grid p-4 text-xs">
              <div className="flex flex-wrap items-center gap-2">{event.id === "2" ? <ArrowUp size={16} className="text-[#adc2d4]" /> : <ArrowDown size={16} className="text-[#d8c26b]" />}<b>{t(event.id === "1" ? "stakeAddEvent" : "stakeRedeemEvent")} {symbol}</b><small className="ml-auto text-[#929fae]">{stakeDate(event.updatedAt * 1000)}</small></div>
              <p className="text-[#d8c26b]">{event.id === "1" ? "+" : "−"}{amount} {symbol}</p>
            </div>;
          })}</div> : <div className="flex flex-col items-center gap-2 p-8 text-center"><Clock size={22} className="text-[#8595a3]" /><p className="text-[#acb6c2] text-xs">{t(!connected ? "stakeConnectHistory" : history.status === "error" || history.status === "loading" || history.key !== historyKey ? "stakeHistoryLoading" : "stakeNoHistory")}</p></div>}
          {connected && history.cursor ? <div className="flex justify-center p-4 text-xs"><button type="button" disabled={historyMoreBusy || history.status === "loading"} className="disabled:opacity-40 text-[#ffda46]" onClick={() => void loadMoreHistory()}>{t(historyMoreBusy ? "stakeHistoryLoading" : "stakeHistoryMore")}</button></div> : null}
        </section>
        <section className="space-y-4 border-[#333a42] bg-[#111619] p-5 border rounded-xl"><h2 className="font-semibold text-sm">{t("stakeHowWorks")}</h2>{stakeRuleItems.map(item => <div key={item.titleKey}><b className="text-[#e5cf76] text-xs">{t(item.titleKey)}</b><p className="mt-1 text-[#a4adba] text-[11px] leading-5">{t(item.descriptionKey)}</p></div>)}</section>
      </div>
    </div>
    <footer className="flex flex-wrap justify-between items-center gap-3 mt-7 py-5 text-[#969ea8] text-[10px]"><span>{t("brand")} {t("launchpad")}</span><button type="button" onClick={onBack}>{t("stakeGoIdo")} ↗</button></footer>
    {/* StakeFarm dialog: exact ERC20 approval is sent only when allowance is insufficient. */}
    {selectedAsset && selected ? <Modal title={`${symbol} ${t("stakeOrder")}`} closeLabel={t("close")} onClose={() => { if (!busy) setSelectedAsset(null); }}>
      <div className="flex gap-2 mb-4" role="group" aria-label={t("stakeActionType")}>{(["stake", "redeem"] as const).map(kind => <button type="button" key={kind} disabled={busy} aria-pressed={action === kind} className={`min-h-10 flex-1 rounded-lg text-xs ${action === kind ? "bg-[#302b17] text-[#ffda46]" : "bg-[#1b2229] text-[#a5b0bd]"}`} onClick={() => { if (selectedAsset) void choose(selectedAsset, kind); }}>{kind === "stake" ? <Plus size={14} className="inline mr-1" /> : <Minus size={14} className="inline mr-1" />}{t(kind === "stake" ? "stakeAdd" : "stakeReduce")}</button>)}</div>
      <form onSubmit={event => { void submit(event); }} noValidate>
        <div className="flex items-center gap-3 border-[#333e49] p-3 border rounded-lg"><StakeIcon poolIndex={selected.poolIndex} alt={symbol} /><div className="min-w-0"><b className="text-sm">{symbol}</b><p className="text-[#929fac] text-[10px] break-all">{selected.pool.token}</p></div></div>
        <div className="flex justify-between gap-3 mt-5 text-xs"><label htmlFor="stake-amount">{t(action === "stake" ? "stakeAddAmount" : "stakeReduceAmount")}</label><span className="text-[#929fac]">{t(action === "stake" ? "stakeWalletAvailable" : "stakeRedeemable")} <b className="text-white">{action === "stake" && !fundsReady ? "—" : displayLive(limit, selected.decimals)} {symbol}</b></span></div>
        <div className="relative mt-2"><input id="stake-amount" className={launchInput} type="text" inputMode="decimal" placeholder={t("stakeAmountPlaceholder")} value={input} disabled={busy} onChange={event => { setInput(event.target.value); setError(""); }} /><span className="top-3 right-3 absolute text-[#aab3bd] text-xs">{symbol}</span></div>
        <div className="gap-2 grid grid-cols-4 mt-3">{[25, 50, 75, 100].map(percent => <button type="button" key={percent} disabled={busy || !connected || selected.decimals === null || limit <= 0n} className="border-[#3b444e] hover:border-[#ffda46] disabled:opacity-40 border rounded min-h-9 text-[#c5cccf] text-[11px] hover:text-[#ffda46]" onClick={() => setInput(formatUnits(limit * BigInt(percent) / 100n, selected.decimals ?? 18))}>{percent === 100 ? t("stakeMax") : `${percent}%`}</button>)}</div>
        <div className="space-y-4 border-[#303940] mt-5 pt-4 border-t text-xs"><div className="flex justify-between gap-3"><span className="text-[#a7b0bb]">{t("stakeAfterOperation")}</span><b>{connected && amountValid ? displayLive(action === "stake" ? selected.staked + amountWei : selected.staked - amountWei, selected.decimals) : displayLive(selected.staked, selected.decimals)} {symbol}</b></div><div className="flex justify-between gap-3"><span className="text-[#a7b0bb]">{t("stakeDaily")}</span><b>{connected && amountValid ? dailyEnergy(selected, action === "stake" ? selected.staked + amountWei : selected.staked - amountWei) : dailyEnergy(selected)} {t("energy")}</b></div></div>
        {error ? <p role="alert" className="mt-3 text-red-300 text-xs">{t(error)}</p> : null}{notice ? <p role="status" className="mt-3 text-[#d3e4ac] text-xs">{t(notice)}</p> : null}
        <Button type="submit" disabled={!connected || busy || !selected.approved || selected.decimals === null || action === "stake" && !fundsReady} className={`mt-5 w-full ${goldButton}`}><Wallet size={16} />{t(wrongNetwork ? "switchNetwork" : busy ? "stakeSubmitting" : action === "stake" ? "stakeConfirmAdd" : "stakeConfirmReduce")}<ArrowRight size={16} /></Button>
      </form>
    </Modal> : null}
  </main>;
}

// Account page: relation reads begin only when this page is mounted.
function AccountPage({ t, sdk, connected, address, energyBalance, live, onConnect, onEnergy, onRecords, onLaunches }: {
  t: (key: string) => string; sdk: FlapChainSdk; connected: boolean; address: string; energyBalance: bigint | null; live: LiveStakeState; onConnect: () => void;
  onEnergy: () => void; onRecords: () => void; onLaunches: () => void;
}) {

  const [binding, setBinding] = useState(false);
  const [inviter, setInviter] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [relation, setRelation] = useState<{ status: "loading" | "ready" | "error"; root: Address | null; parent: Address | null; children: readonly Address[] }>({ status: "loading", root: null, parent: null, children: [] });
  const [communityStakes, setCommunityStakes] = useState<{ status: "loading" | "ready" | "error"; values: Record<string, bigint | null> }>({ status: "loading", values: {} });
  const [refresh, setRefresh] = useState(0);
  const definition = sdk.context.manifest.walletContracts?.find(item => item.id === RELATION_CONTRACT_ID && item.chainId === sdk.context.chainId);
  const relationAddress = definition?.address.toLowerCase() === RELATION_ADDRESS.toLowerCase() ? RELATION_ADDRESS : undefined;
  useEffect(() => {
    if (!connected || !isAddress(address, { strict: false }) || !relationAddress) {
      setRelation({ status: connected ? "error" : "ready", root: null, parent: null, children: [] });
      return;
    }
    let active = true;
    setRelation(current => ({ ...current, status: "loading" }));
    void Promise.all([
      sdk.readContract<Address>({ address: RELATION_ADDRESS, abi: RELATION_ABI, functionName: "root" }),
      sdk.readContract<Address>({ address: RELATION_ADDRESS, abi: RELATION_ABI, functionName: "parentOf", args: [address as Address] }),
      sdk.readContract<readonly Address[]>({ address: RELATION_ADDRESS, abi: RELATION_ABI, functionName: "childrenOf", args: [address as Address] }),
    ]).then(([root, parent, children]) => {
      if (active) setRelation({ status: "ready", root, parent: /^0x0{40}$/i.test(parent) ? null : parent, children });
    }).catch(cause => {
      console.error("[SAUCE] Relation read failed", cause);
      if (active) setRelation({ status: "error", root: null, parent: null, children: [] });
    });
    return () => { active = false; };
  }, [sdk, connected, address, relationAddress, refresh]);
  const referrer = relation.parent;
  const isRelationRoot = relation.status === "ready" && relation.root?.toLowerCase() === address.toLowerCase();
  const briefReferrer = referrer ? `${referrer.slice(0, 6)}…${referrer.slice(-4)}` : "";
  const eligibilityPool = eligibilityStakePool(live);
  const eligibilityToken = eligibilityPool?.pool.token;
  const eligibilityDecimals = eligibilityPool?.decimals;
  const accountThreshold = stakeThresholdInTokenUnits(live);
  const isEffectiveUser = eligibilityPool && accountThreshold !== null ? eligibilityPool.staked >= accountThreshold : null;
  const farmDefinition = sdk.context.manifest.walletContracts?.find(item => item.id === STAKE_FARM_CONTRACT_ID && item.chainId === sdk.context.chainId);
  useEffect(() => {
    if (!connected || relation.status !== "ready" || eligibilityDecimals == null || !eligibilityToken) {
      setCommunityStakes({ status: "loading", values: {} });
      return;
    }
    if (!farmDefinition) {
      setCommunityStakes({ status: "error", values: {} });
      return;
    }
    let active = true;
    setCommunityStakes({ status: "loading", values: {} });
    void (async () => {
      const values: Record<string, bigint | null> = {};
      // Bound concurrent reads so a large community does not overwhelm the host RPC.
      for (let index = 0; index < relation.children.length; index += 8) {
        const batch = relation.children.slice(index, index + 8);
        const results = await Promise.allSettled(batch.map(child => sdk.readContract<StakeFarmAccountInfo>({
          address: STAKE_FARM_ADDRESS, abi: STAKE_FARM_ABI, functionName: "accountInfoOf", args: [child, eligibilityToken],
        })));
        batch.forEach((child, offset) => { values[child.toLowerCase()] = results[offset].status === "fulfilled" ? results[offset].value.staticReward.staked : null; });
      }
      if (active) setCommunityStakes({ status: "ready", values });
    })().catch(cause => {
      console.error("[SAUCE] Community stake read failed", cause);
      if (active) setCommunityStakes({ status: "error", values: {} });
    });
    return () => { active = false; };
  }, [sdk, connected, relation.status, relation.children, eligibilityDecimals, eligibilityToken, farmDefinition]);
  const communityThreshold = stakeThresholdInTokenUnits(live);
  const communityEffectiveCount = communityThreshold === null || communityStakes.status !== "ready" || relation.children.some(child => communityStakes.values[child.toLowerCase()] == null)
    ? null : relation.children.reduce((count, child) => {
      const staked = communityStakes.values[child.toLowerCase()];
      return count + (staked !== null && staked !== undefined && staked >= communityThreshold ? 1 : 0);
    }, 0);

  async function bind(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = inviter.trim();
    const issue = relation.status !== "ready" || !relationAddress ? "myRelationUnavailable" : isRelationRoot || referrer ? "myReferrerAlreadyBound" : !isAddress(candidate, { strict: false }) ? "myReferrerInvalid" : /^0x0{40}$/i.test(candidate) ? "myReferrerZero" : candidate.toLowerCase() === address.toLowerCase() ? "myReferrerSelf" : sdk.wallet.isWrongNetwork ? "wrongNetwork" : "";
    setError(issue);
    if (issue) return;
    setBusy(true);
    try {
      const [parentParent, childrenCount] = await Promise.all([
        sdk.readContract<Address>({ address: RELATION_ADDRESS, abi: RELATION_ABI, functionName: "parentOf", args: [candidate as Address] }),
        sdk.readContract<bigint>({ address: RELATION_ADDRESS, abi: RELATION_ABI, functionName: "childrenCount", args: [candidate as Address] }),
      ]);
      if ((candidate.toLowerCase() !== relation.root?.toLowerCase() && parentParent.toLowerCase() === ZERO_ADDRESS) || childrenCount >= 128n) throw new Error("myReferrerInvalid");
      stakeFarmAddress(sdk);
      const prepared = await sdk.simulateContract({ address: STAKE_FARM_ADDRESS, abi: STAKE_FARM_ABI, functionName: "bindParent", args: [candidate as Address], account: sdk.wallet.address });
      const hash = await sdk.writeContract(prepared.request);
      const receipt = await sdk.waitForTx(hash);
      if (receipt.status !== "success") throw new Error("StakeFarm bindParent transaction reverted.");
      setBinding(false); setInviter(""); setRefresh(value => value + 1);
    } catch (cause) {
      console.error("[SAUCE] StakeFarm bindParent failed", cause);
      setError("myBindFailed");
    } finally { setBusy(false); }
  }

  return <main className="mx-auto pt-6 sm:pt-8 pb-10 max-w-[760px]">
    <h1 className="mb-6 font-bold text-[32px] tracking-tight">{t("my")}<span className="text-[#ffda46]">.</span></h1>
    {/* 01. Profile follows the selected three-row design: identity, wallet address, then the full-width energy action. */}
    <section className="border-[#39424a] bg-[#131a1e] border rounded-[13px] overflow-hidden" aria-labelledby="my-profile-title">
      <header className="flex flex-wrap justify-between items-center gap-3 px-[18px] sm:px-[22px] py-4 sm:py-5"><h2 id="my-profile-title" className="flex items-center gap-2 font-medium text-sm"><CircleUserRound size={23} className="text-[#c8bb7d]" />{t("myProfile")}</h2>{connected && isEffectiveUser !== null ? <span className={`inline-flex items-center gap-1.5 border border-[#333a42] bg-[#111619] rounded-full px-3 py-1.5 text-[11px] ${isEffectiveUser ? "text-[#ffda46]" : "text-[#aeb7b7]"}`}><ShieldCheck size={14} />{t(isEffectiveUser ? "stakeEffective" : "stakeIneffective")}</span> : null}</header>
      {connected ? <><div className="flex sm:flex-row flex-col sm:items-center gap-1 sm:gap-7 border-[#39424a] px-[18px] sm:px-[22px] py-4 border-t min-w-0"><span className="text-[#9daebc] text-xs shrink-0">{t("myWalletAddress")}</span><p className="text-[#d5dfe7] text-xs break-all leading-6 select-text">{address}</p></div><button type="button" onClick={onEnergy} className="flex sm:flex-row flex-col sm:justify-between sm:items-center gap-3 border-[#4b452e] hover:border-[#aa9238] bg-[#242316] hover:bg-[#2d2919] px-[18px] sm:px-[22px] py-5 border-t w-full min-w-0 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ffda46]"><span className="flex items-center gap-2 text-[#e5d17d] text-sm"><Zap size={20} />{t("myAvailableEnergy")}</span><span className="flex items-center gap-3 min-w-0"><b className="font-semibold text-[#ffda46] text-2xl sm:text-[30px] break-words tabular-nums">{energyBalance === null ? "—" : formatEnergy(energyBalance)}</b><ArrowRight size={18} className="text-[#ffda46] shrink-0" /></span></button></> : <div className="border-[#39424a] px-[18px] sm:px-[22px] py-5 border-t"><Button className={`w-full ${goldButton}`} onClick={onConnect}><Wallet size={17} />{t("connect")}</Button></div>}
    </section>

    {/* 02. Referrer binding comes from the connected wallet and Relation contract. */}
    <section className="mt-7" aria-labelledby="my-invite-title"><h2 id="my-invite-title" className="mb-4 font-medium text-sm">{t("myInviteTitle")}</h2>
      {!isRelationRoot ? <div className="flex flex-wrap items-center gap-3 border-[#323f49] py-5 border-b text-xs"><span className="text-[#a4b4c2]">{t("myReferrer")}</span>{relation.status === "loading" && connected ? <span className="ml-auto text-[#94a5b3] text-[11px]">{t("myRelationLoading")}</span> : relation.status === "error" && connected ? <span role="alert" className="ml-auto text-[#ffbe98] text-[11px]">{t("myRelationUnavailable")}</span> : connected && referrer ? <span className="flex items-center gap-1.5 ml-auto text-[#c8d4b5]" title={referrer}><CheckCircle2 size={14} className="text-[#adbf89]" />{briefReferrer}</span> : <><span className="ml-auto text-[#94a5b3] text-[11px]">{t(connected ? "myUnbound" : "myAwaitConnect")}</span><button type="button" disabled={!connected || busy} onClick={() => { setBinding(value => !value); setError(""); }} className="disabled:opacity-40 min-h-9 text-[#d7c36f] text-[11px]">{t(binding ? "myCancelBind" : "myBind")}</button></>}</div> : null}
      {binding && connected && relation.status === "ready" && !isRelationRoot && !referrer ? <form onSubmit={event => { void bind(event); }} noValidate className="pt-5"><label htmlFor="my-inviter" className="block mb-2 text-[#b2c0cb] text-[11px]">{t("myReferrerAddress")}</label><input id="my-inviter" aria-label={t("myReferrerAddress")} placeholder={t("myReferrerPlaceholder")} value={inviter} disabled={busy} onChange={event => { setInviter(event.target.value); setError(""); }} spellCheck={false} autoComplete="off" className="border-[#495765] focus:border-[#bca139] bg-[#10171c] px-3 border rounded-lg focus:ring-1 focus:ring-[#bca139]/50 w-full min-h-11 text-[#dbe3ea] text-xs placeholder:text-[#8b96a4] caret-[#ffda46] outline-none [color-scheme:dark]" />{error ? <p role="alert" className="mt-3 text-[#ffbe98] text-[11px]">{t(error)}</p> : null}<Button type="submit" disabled={busy} className={`mt-3 w-full ${goldButton}`}>{t(busy ? "myBinding" : "myConfirmBind")}</Button></form> : null}
    </section>

    {/* 03. Community membership comes from Relation; each member's SAUCE stake comes from StakeFarm. */}
    <details className="border-[#333a42] mt-3 border-b group">
      <summary className="flex items-center gap-2 marker:hidden py-4 min-h-[68px] cursor-pointer list-none">
        <h2 className="flex items-center gap-2 font-medium text-sm"><Users size={19} className="text-[#c8ba78]" />{t("myCommunity")}</h2>
        <span className="text-right ml-auto text-[#a7b7c4] text-[11px]">{connected && relation.status === "ready"
          ? `${relation.children.length} ${t("myPeople")} · ${t("myEffectiveCount")} ${communityEffectiveCount ?? "—"} ${t("myPeople")}`
          : connected ? t(relation.status === "loading" ? "myRelationLoading" : "myRelationUnavailable") : t("myConnectToView")}</span>
        <ChevronDown size={17} className="group-open:rotate-180 text-[#9babb9] transition-transform shrink-0" />
      </summary>
      {connected && relation.status === "ready" ? relation.children.length ? <div>{relation.children.map(child => {
        const staked = communityStakes.values[child.toLowerCase()];
        const loaded = communityStakes.status === "ready" && eligibilityDecimals != null;
        const effective = loaded && staked != null && communityThreshold !== null && staked >= communityThreshold;
        return <article key={child} className="flex justify-between items-center gap-4 border-[#333a42] py-5 border-t min-h-[72px]">
          <div className="min-w-0"><p className="text-[#d5dee6] text-xs" title={child}>{child.slice(0, 6)}…{child.slice(-4)}</p><p className="mt-2 text-[#9fb0bd] text-[11px]">
            {loaded && staked != null ? staked > 0n ? `${t("myMemberStaked")} ${formatTruncated(formatUnits(staked, eligibilityDecimals))} SAUCE` : t("myMemberUnstaked") : t(communityStakes.status === "error" || loaded ? "myCommunityStakeFailed" : "myCommunityStakeLoading")}
          </p></div>
          <span className={`text-[11px] shrink-0 ${effective ? "text-[#c5d2a6]" : "text-[#e6b780]"}`}>
            {loaded && staked != null ? t(effective ? "stakeEffective" : "stakeIneffective") : "—"}
          </span>
        </article>;
      })}</div> : <p className="pb-5 text-[#95a8b7] text-[11px]">{t("myNoChildren")}</p> : <p className="pb-5 text-[#95a8b7] text-[11px]">{t(!connected ? "myCommunityConnect" : relation.status === "loading" ? "myRelationLoading" : "myRelationUnavailable")}</p>}
    </details>
    <div className="flex flex-wrap justify-between items-center gap-4 pt-5"><button type="button" onClick={onRecords} className="flex items-center gap-1 min-h-10 text-[#a5b7c6] text-[11px] hover:text-[#ffda46]">{t("myParticipationRecords")}<ArrowUpRight size={13} /></button><button type="button" onClick={onLaunches} className="flex items-center gap-1 min-h-10 text-[#a5b7c6] text-[11px] hover:text-[#ffda46]">{t("myLaunches")}<ArrowUpRight size={13} /></button></div>
  </main>;
}

export default function Component() {
  const sdk = useFlapSdk({ chainId: chainId });
  const paymentTokenAddresses = usePaymentTokenAddresses(sdk);
  console.log(sdk)
  const miniApp = useMiniAppSdk();
  const { wallet, i18n } = sdk;
  const t = i18n.t;
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recommended");
  const [projectRowsPage, setProjectRowsPage] = useState({ key: "", limit: PROJECT_ROWS_PAGE_SIZE });
  const [sortOpen, setSortOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [page, setPage] = useState<AppPage>("home");
  const [selected, setSelected] = useState<number | null>(null);
  const [panel, setPanel] = useState<AppPanel | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState(false);
  // Keep the first successful list visible while later timer refreshes run.
  const projectSnapshotReady = useRef(false);
  // Project text loads independently after list rows render; duplicate cards share its request.
  const projectCopyCache = useRef(new WeakMap<FlapChainSdk, Map<string, Promise<ProjectCopy>>>());
  const [projectDetailReady, setProjectDetailReady] = useState<string>("");
  const projectListInFlight = useRef(0);
  const [projectRefresh, setProjectRefresh] = useState(0);
  // Prevent an older periodic snapshot from overwriting a confirmed transaction's row.
  const projectUpdateVersion = useRef(0);
  const projectVersions = useRef(new Map<string, number>());
  const [projectNow, setProjectNow] = useState(0);
  const [projectClockReady, setProjectClockReady] = useState(false);
  const projectClockAnchor = useRef<{ chainId: number; address: string; seconds: number; sampledAt: number } | null>(null);
  const [projectWritingAction, setProjectWritingAction] = useState<ProjectWritingAction | null>(null);
  const projectWriting = projectWritingAction !== null;
  const [actionNotice, setActionNotice] = useState<{ key: string; tone: "success" | "warning" | "error"; detail?: string } | null>(null);
  function notifyAction(key: string, tone: "success" | "warning" | "error", detail?: string) {
    const text = `${t(key)}${detail ? ` · ${detail}` : ""}`;
    try {
      if (tone === "success") sdk.notify.success(text);
      else if (tone === "warning") sdk.notify.warning(text);
      else sdk.notify.error(text);
    } catch { /* The local floating notice still displays. */ }
    setActionNotice({ key, tone, detail });
  }
  const [projectPurchases, setProjectPurchases] = useState<ProjectPurchaseState>({ status: "idle", account: null, tokenKey: "", byToken: {} });
  // My launch ownership needs an indexed creator source; the chain list itself is live.

  // Launchpad draft survives in-app page switches; it is not persisted in browser storage.
  const [launchValues, setLaunchValues] = useState<LaunchValues>(initialLaunch);
  const [launchLogoCid, setLaunchLogoCid] = useState(DEFAULT_LAUNCH_IMAGE_CID);
  // Keep a submitted tx hash across page switches so a delayed receipt cannot trigger a duplicate launch.
  const [launchSubmission, setLaunchSubmission] = useState<LaunchSubmission | null>(null);
  // One live StakeFarm snapshot supplies both the staking page and the energy dialog.
  const [liveStake, setLiveStake] = useState<LiveStakeState>(emptyLiveStake);
  const [energyBalance, setEnergyBalance] = useState<bigint | null>(null);
  const [projectQuoteBalance, setProjectQuoteBalance] = useState<{ account: Address; quoteAddress: Address; amount: bigint } | null>(null);
  const energySdkRef = useRef(sdk);
  const [stakeRetry, setStakeRetry] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const rail = useRef<HTMLDivElement>(null);
  const featuredFrame = useRef<HTMLElement>(null);
  const board = useRef<HTMLElement>(null);
  const [flowVisible, setFlowVisible] = useState({ featured: false, board: false });
  const sortButtonRef = useRef<HTMLButtonElement>(null);
  const owner = wallet.address ?? "";
  const launchPadDefinition = sdk.context.manifest.walletContracts?.find(item => item.id === LAUNCHPAD_CONTRACT_ID && item.chainId === sdk.context.chainId);
  const launchPadAddress = launchPadDefinition?.address.toLowerCase() === LAUNCHPAD_ADDRESS.toLowerCase() ? LAUNCHPAD_ADDRESS : undefined;
  const relationClockDefinition = sdk.context.manifest.walletContracts?.find(item => item.id === RELATION_CONTRACT_ID && item.chainId === sdk.context.chainId);
  const relationClockAddress = relationClockDefinition?.address.toLowerCase() === RELATION_ADDRESS.toLowerCase() ? RELATION_ADDRESS : undefined;
  // Keep the two frame sweeps in one shared cycle, and pause each one offscreen.
  useEffect(() => {
    if (page !== "home" || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      setFlowVisible(current => {
        let featured = current.featured;
        let boardVisible = current.board;
        for (const entry of entries) {
          if (entry.target === featuredFrame.current) featured = entry.isIntersecting;
          if (entry.target === board.current) boardVisible = entry.isIntersecting;
        }
        return featured === current.featured && boardVisible === current.board ? current : { featured, board: boardVisible };
      });
    }, { threshold: 0.05 });
    if (featuredFrame.current) observer.observe(featuredFrame.current);
    if (board.current) observer.observe(board.current);
    return () => observer.disconnect();
  }, [page]);
  // The preview host logs SDK messages; retain a visible local fallback.
  useEffect(() => { if (!actionNotice) return; const timer = setTimeout(() => setActionNotice(null), 4200); return () => clearTimeout(timer); }, [actionNotice]);
  // Read Relation.timestemp whenever the IDO page opens, then advance that
  // chain-time anchor locally until the user leaves the page.
  useEffect(() => {
    if (page !== "home") return;
    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    projectClockAnchor.current = null;
    setProjectClockReady(false);
    if (!projectSnapshotReady.current) setProjectsLoading(true);
    const start = (anchor: { seconds: number; sampledAt: number }) => {
      const tick = () => setProjectNow(anchor.seconds + Math.floor((performance.now() - anchor.sampledAt) / 1000));
      tick();
      setProjectClockReady(true);
      timer = setInterval(tick, 1000);
    };
    if (relationClockAddress) {
      void sdk.readContract<bigint>({ address: RELATION_ADDRESS, abi: RELATION_ABI, functionName: "timestemp" }).then(timestamp => {
        if (!active) return;
        const seconds = Number(timestamp);
        if (!Number.isSafeInteger(seconds) || seconds <= 0) throw new Error("Invalid Relation timestamp.");
        const anchor = { chainId: sdk.context.chainId, address: relationClockAddress, seconds, sampledAt: performance.now() };
        projectClockAnchor.current = anchor;
        start(anchor);
      }).catch(cause => { console.error("[SAUCE] Chain time read failed", cause); if (active) { setProjectClockReady(false); setProjectsLoading(false); setProjectsError(true); } });
    } else {
      setProjectClockReady(false);
      setProjectsLoading(false);
      setProjectsError(true);
    }
    return () => { active = false; projectClockAnchor.current = null; if (timer) clearInterval(timer); };
  }, [page, sdk, relationClockAddress]);
  useEffect(() => {
    if (page !== "home" || projectWriting) return;
    const timer = setInterval(() => { if (projectListInFlight.current === 0) setProjectRefresh(value => value + 1); }, PROJECT_LIST_REFRESH_MS);
    return () => clearInterval(timer);
  }, [page, projectWriting]);
  useEffect(() => {
    if (!launchPadAddress || page !== "home" || !projectClockReady || !projectClockAnchor.current) return;
    let active = true;
    const readVersion = projectUpdateVersion.current;
    projectListInFlight.current += 1;
    setProjectsLoading(!projectSnapshotReady.current);
    setProjectsError(false);
    // Only list() determines initial list readiness. Text and IPFS requests never block rows.
    void sdk.readContract<LaunchPadListRow[]>({ address: LAUNCHPAD_ADDRESS, abi: LAUNCHPAD_ABI, functionName: "list" }).then(list => {
      if (!active) return;
      const anchor = projectClockAnchor.current;
      if (!anchor) return;
      const now = anchor.seconds + Math.floor((performance.now() - anchor.sampledAt) / 1000);
      projectSnapshotReady.current = true;
      setProjects(current => list.map((item, id): Project => {
        const p = item.project.poolLaunchParams.p;
        const previous = current.find(project => project.tokenAddress.toLowerCase() === item.project.tokenAddress.toLowerCase());
        if ((projectVersions.current.get(item.project.tokenAddress.toLowerCase()) ?? 0) > readVersion && previous) return previous;
        const sold = BigInt(item.state.totalSoldCount), stock = BigInt(item.config.totalStock);
        const failed = !item.state.isFired && now > Number(item.config.endTime) && sold < stock;
        const quote = quoteInfo(p.quoteToken, paymentTokenAddresses);
        return {
          id, tokenAddress: item.project.tokenAddress, name: p.name, symbol: p.symbol, metadataCid: p.meta,
          projectTitle: previous?.projectTitle ?? "", description: previous?.description ?? "", imageCid: previous?.imageCid ?? null,
          stage: item.state.isFired || (stock > 0n && sold >= stock) ? "ended" : now < Number(item.config.startTime) ? "soon" : now <= Number(item.config.endTime) ? "live" : "ended",
          isFired: item.state.isFired, energy: BigInt(item.config.unitEnergyPrice), price: BigInt(item.config.unitCashPrice), allocation: BigInt(item.config.amountPerUnit), sold, stock,
          purchaseLimit: BigInt(item.config.purchaseLimit), startTime: BigInt(item.config.startTime), endTime: BigInt(item.config.endTime),
          quoteSymbol: quote?.symbol ?? `${p.quoteToken.slice(0, 6)}…${p.quoteToken.slice(-4)}`,
          quoteAddress: p.quoteToken, quoteDecimals: p.quoteToken.toLowerCase() === ZERO_ADDRESS ? 18 : previous?.quoteDecimals ?? quote?.decimals ?? null,
          preparationAddress: previous?.preparationAddress ?? null, capitalVerified: previous?.capitalVerified ?? false,
          refundable: previous?.refundable ?? false, creator: previous?.creator ?? null, creatorBuyQuote: p.creatorBuyQuote,
          tax: `${taxPercent(Number(p.buyTaxRate))}% / ${taxPercent(Number(p.sellTaxRate))}%`, failed,
        };
      }));
    }).catch(cause => { console.error("[SAUCE] LaunchPad list read failed", cause); if (active) setProjectsError(!projectSnapshotReady.current); })
      .finally(() => { projectListInFlight.current -= 1; if (active) setProjectsLoading(false); });
    return () => { active = false; };
  }, [sdk, launchPadAddress, page, projectClockReady, projectRefresh, launchSubmission?.status, paymentTokenAddresses]);
  const projectCopyKey = projects.map(project => `${project.id}:${project.tokenAddress.toLowerCase()}`).join(",");
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  useEffect(() => {
    if (page !== "home" || !projectCopyKey) return;
    let active = true;
    const snapshot = projectsRef.current;
    void (async () => {
      for (let offset = 0; offset < snapshot.length && active; offset += 4) {
        await Promise.all(snapshot.slice(offset, offset + 4).map(async project => {
          try {
            const { preparation, texts } = await readProjectCopy(sdk, project, projectCopyCache.current);
            if (!active) return;
            const title = i18n.locale === "zh" ? texts[0] : texts[1];
            const summary = i18n.locale === "zh" ? texts[2] : texts[3];
            setProjects(current => current.map(row => row.tokenAddress.toLowerCase() === project.tokenAddress.toLowerCase()
              ? { ...row, projectTitle: title, description: summary, preparationAddress: preparation.address } : row));
          } catch (cause) { if (active) console.warn("[SAUCE] Project description unavailable", project.tokenAddress, cause); }
        }));
      }
    })();
    return () => { active = false; };
  }, [sdk, page, projectCopyKey, i18n.locale]);

  const energyToken = sdk.context.manifest.walletContracts?.find(item => item.id === ENERGY_TOKEN_CONTRACT_ID && item.chainId === sdk.context.chainId);
  const energyTokenAddress = energyToken?.address.toLowerCase() === ENERGY_TOKEN_ADDRESS.toLowerCase() ? ENERGY_TOKEN_ADDRESS : null;
  useEffect(() => { energySdkRef.current = sdk; }, [sdk]);
  // Dynamic energy balance already includes pending rewards. Read pending separately for display, never add it to balance.
  // Poll these two small views only; avoid overlapping RPC reads and full pool reloads.
  useEffect(() => {
    if (!wallet.isConnected || !owner || !energyTokenAddress) { setEnergyBalance(null); return; }
    let active = true;
    let reading = false;
    setEnergyBalance(null);
    const refresh = async () => {
      if (reading) return;
      reading = true;
      try {
        const currentSdk = energySdkRef.current;
        const [balance, pending] = await Promise.all([
          currentSdk.readContract<bigint>({ address: ENERGY_TOKEN_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [owner as Address] }),
          currentSdk.readContract<bigint>({ address: STAKE_FARM_ADDRESS, abi: STAKE_FARM_ABI, functionName: "accountPendingEnergy", args: [owner as Address] }).catch(() => null),
        ]);
        if (active) {
          setEnergyBalance(current => current === balance ? current : balance);
          setLiveStake(current => current.accountPendingEnergy === pending ? current : { ...current, accountPendingEnergy: pending });
        }
      } catch (cause) {
        if (active) { setEnergyBalance(null); console.error("[SAUCE] Energy balance read failed", cause); }
      } finally { reading = false; }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, ENERGY_BALANCE_REFRESH_MS);
    return () => { active = false; clearInterval(timer); };
  }, [owner, wallet.isConnected, energyTokenAddress, sdk.context.chainId]);
  useEffect(() => {
    const farmDefinition = miniApp.context.manifest.walletContracts?.find(item => item.id === STAKE_FARM_CONTRACT_ID);
    if (!farmDefinition) { setLiveStake({ ...emptyLiveStake(), status: "error" }); return; }
    let farmSdk: FlapChainSdk;
    try { farmSdk = miniApp.forChain(farmDefinition.chainId); }
    catch { setLiveStake({ ...emptyLiveStake(), status: "error" }); return; }
    let active = true;
    setLiveStake(current => ({ ...current, status: "loading" }));
    void readStakeFarm(farmSdk, wallet.isConnected ? farmSdk.wallet.address : undefined).then(result => {
      if (active) setLiveStake({ status: "ready", ...result });
    }).catch(cause => {
      console.error("[SAUCE] StakeFarm read failed", cause);
      if (active) setLiveStake({ ...emptyLiveStake(), status: "error" });
    });
    return () => { active = false; };
  }, [miniApp, owner, wallet.isConnected, stakeRetry]);
  // Every stake/withdraw settles all main pools. Refresh account snapshots silently without clearing rows.
  async function refreshStakeToken(token: Address) {
    const farmDefinition = miniApp.context.manifest.walletContracts?.find(item => item.id === STAKE_FARM_CONTRACT_ID);
    if (!farmDefinition) return;
    try {
      const farmSdk = miniApp.forChain(farmDefinition.chainId);
      const accountAddress = farmSdk.wallet.address;
      const result = await readStakeFarm(farmSdk, accountAddress);
      if (wallet.address !== accountAddress) return;
      setLiveStake({ status: "ready", ...result });
    } catch (cause) { console.error("[SAUCE] StakeFarm token refresh failed", cause); }
  }
  const shortAddress = owner ? `${owner.slice(0, 6)}…${owner.slice(-4)}` : "";
  const activeEligibilityPool = eligibilityStakePool(liveStake);
  const activeThreshold = stakeThresholdInTokenUnits(liveStake);
  const activeEligible = activeEligibilityPool && activeThreshold !== null ? activeEligibilityPool.staked >= activeThreshold : null;
  const liveEnergyBalance = wallet.isConnected && energyBalance !== null ? formatEnergy(energyBalance) : "—";

  const visibleProjects = projects.map(item => {
    const stage: Stage = item.isFired || (item.stock > 0n && item.sold >= item.stock) ? "ended" : projectNow < Number(item.startTime) ? "soon" : projectNow <= Number(item.endTime) ? "live" : "ended";
    return { ...item, stage, failed: !item.isFired && projectNow > Number(item.endTime) && item.sold < item.stock };
  });
  const featuredProjects = visibleProjects.filter(item => item.stage === "soon" || item.stage === "live");
  const project = visibleProjects.find(p => p.id === selected);
  // Read the selected project's payment balance only while its detail dialog is open.
  useEffect(() => {
    if (!project?.quoteAddress || !wallet.isConnected || !owner || !launchPadAddress) { setProjectQuoteBalance(null); return; }
    const quoteAddress = project.quoteAddress;
    const account = owner as Address;
    let active = true;
    setProjectQuoteBalance(null);
    const readBalance = quoteAddress.toLowerCase() === ZERO_ADDRESS.toLowerCase()
      ? energySdkRef.current.getBalance(account)
      : resolveLaunchQuoteToken(energySdkRef.current, quoteAddress).then(contract => energySdkRef.current.readContract<bigint>({ contract, abi: erc20Abi, functionName: "balanceOf", args: [account] }));
    void readBalance.then(amount => {
      if (active) setProjectQuoteBalance({ account, quoteAddress, amount });
    }).catch(cause => {
      if (active) console.error("[SAUCE] Project payment balance read failed", cause);
    });
    return () => { active = false; };
  }, [selected, project?.quoteAddress, owner, wallet.isConnected, sdk.context.chainId, launchPadAddress]);
  const displayedQuoteBalance = project && projectQuoteBalance?.account.toLowerCase() === owner.toLowerCase() && projectQuoteBalance.quoteAddress.toLowerCase() === project.quoteAddress.toLowerCase()
    ? formatTruncated(formatUnits(projectQuoteBalance.amount, project.quoteDecimals ?? 18)) : "—";
  const projectTokenKey = project?.tokenAddress.toLowerCase() ?? "";
  const detailKey = `${sdk.context.chainId}:${selected}:${projectTokenKey}:${owner.toLowerCase()}`;
  useEffect(() => {
    setProjectDetailReady("");
    if (selected === null || !projectTokenKey || !launchPadAddress) return;
    const current = projectsRef.current.find(row => row.id === selected && row.tokenAddress.toLowerCase() === projectTokenKey);
    if (!current) return;
    let active = true;
    const readVersion = projectUpdateVersion.current;
    setProjectPurchases({ status: wallet.isConnected ? "loading" : "idle", account: wallet.isConnected ? owner as Address : null, tokenKey: projectTokenKey, byToken: {} });
    void (async () => {
      const { preparation, texts } = await readProjectCopy(sdk, current, projectCopyCache.current);
      const anchor = projectClockAnchor.current;
      const now = anchor ? anchor.seconds + Math.floor((performance.now() - anchor.sampledAt) / 1000) : 0;
      const [creator, updated, decimals] = await Promise.all([
        sdk.readContract<Address>({ contract: preparation, abi: IDO_PREPARATION_ABI, functionName: "creator" }),
        wallet.isConnected && owner ? readProjectUpdate(sdk, current, preparation, owner as Address, now)
          : Promise.all([
            sdk.readContract<boolean>({ contract: preparation, abi: IDO_PREPARATION_ABI, functionName: "isCapitalVerified" }),
            sdk.readContract<boolean>({ contract: preparation, abi: IDO_PREPARATION_ABI, functionName: "isRefundable" }),
          ]).then(([capitalVerified, refundable]) => ({ project: { ...current, capitalVerified, refundable }, purchase: null })),
        current.quoteDecimals !== null ? Promise.resolve(current.quoteDecimals)
          : resolveLaunchQuoteToken(sdk, current.quoteAddress).then(handle => sdk.readContract<number>({ contract: handle, abi: erc20Abi, functionName: "decimals" })),
      ]);
      if (!active) return;
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 77) throw new Error("Invalid quote decimals");
      if ((projectVersions.current.get(projectTokenKey) ?? 0) <= readVersion) {
        setProjects(rows => rows.map(row => row.tokenAddress.toLowerCase() === projectTokenKey ? {
          ...row, ...updated.project, creator, preparationAddress: preparation.address, quoteDecimals: decimals,
          projectTitle: i18n.locale === "zh" ? texts[0] : texts[1], description: i18n.locale === "zh" ? texts[2] : texts[3],
        } : row));
        if (updated.purchase) setProjectPurchases({ status: "ready", account: owner as Address, tokenKey: projectTokenKey, byToken: { [projectTokenKey]: updated.purchase } });
      }
      setProjectDetailReady(detailKey);
    })().catch(cause => { if (active) { console.error("[SAUCE] Project detail read failed", cause); setProjectPurchases({ status: "error", account: owner as Address, tokenKey: projectTokenKey, byToken: {} }); } });
    return () => { active = false; };
  }, [sdk, selected, projectTokenKey, owner, wallet.isConnected, launchPadAddress, i18n.locale, detailKey]);
  const purchaseSnapshotReady = projectPurchases.status === "ready" && projectPurchases.account?.toLowerCase() === owner.toLowerCase() && projectPurchases.tokenKey === projectTokenKey;
  const projectPurchase = purchaseSnapshotReady && project ? projectPurchases.byToken[project.tokenAddress.toLowerCase()] : undefined;
  const projectPurchaseReady = !!projectPurchase;
  const purchaseInfoStatus = projectPurchases.account?.toLowerCase() === owner.toLowerCase() && projectPurchases.tokenKey === projectTokenKey ? projectPurchases.status : "loading";
  const remainingStock = project ? project.stock > project.sold ? project.stock - project.sold : 0n : 0n;
  const remainingWalletLots = project && projectPurchase ? project.purchaseLimit === 0n ? remainingStock : project.purchaseLimit > projectPurchase.count ? project.purchaseLimit - projectPurchase.count : 0n : 0n;
  const maxPurchaseLots = remainingStock < remainingWalletLots ? remainingStock : remainingWalletLots;
  const lots = Number(quantity);
  const validLots = !!project && projectPurchaseReady && /^\d+$/.test(quantity) && Number.isSafeInteger(lots) && lots >= 1 && BigInt(lots) <= maxPurchaseLots;
  const paymentBalanceReady = !!project && !!projectQuoteBalance && projectQuoteBalance.account.toLowerCase() === owner.toLowerCase() && projectQuoteBalance.quoteAddress.toLowerCase() === project.quoteAddress.toLowerCase();
  // Tabs: 即将发射 = 待开始; 已完毕 = 待上线 or 已上线. Original ids retain list() indices.
  const rows = visibleProjects.filter(p => {
    const matchesStage = filter === "all" || filter === "latest" || filter === "live" && p.stage === "live" || filter === "soon" && p.stage === "soon" || filter === "ended" && (isSoldOut(p) || p.isFired);
    return matchesStage && `${p.projectTitle} ${p.name} ${p.symbol} ${p.tokenAddress}`.toLowerCase().includes(query.trim().toLowerCase());
  }).sort((a, b) => sort === "progressSort" ? projectPercent(b) - projectPercent(a) || b.id - a.id : filter === "all" || filter === "latest" ? b.id - a.id : a.id - b.id);
  const projectRowsKey = `${filter}:${query.trim().toLowerCase()}:${sort}`;
  const projectRowsLimit = projectRowsPage.key === projectRowsKey ? projectRowsPage.limit : PROJECT_ROWS_PAGE_SIZE;
  const displayedProjectRows = rows.slice(0, projectRowsLimit);
  async function connect() { setConnecting(true); setMessage(null); try { await wallet.connect(); } catch { setMessage("walletError"); } finally { setConnecting(false); } }
  function disconnect() { wallet.disconnect(); setPanel(null); setMessage(null); }
  // Menu selection stays inside the reviewed Mini App.
  function showPage(nextPage: AppPage) {
    setPage(nextPage);
    setSortOpen(false);
    setMobileMenuOpen(false);
    setPanel(null);
    setSelected(null);
    setMessage(null);
  }
  function openWallet() {
    if (!wallet.isConnected) { void connect(); return; }
    if (wallet.isWrongNetwork) { void wallet.switchChain().catch(() => setMessage("walletError")); return; }
    setPanel("wallet");
  }
  function openProject(p: Project) { setSelected(p.id); setQuantity("1"); setMessage(null); }
  async function refreshOperatedProject(current: Project, preparation: Awaited<ReturnType<FlapChainSdk["resolveContract"]>>, confirmedInfo?: LaunchPadListRow) {
    const tokenKey = current.tokenAddress.toLowerCase();
    const account = owner as Address;
    const sourceChain = sdk.context.chainId;
    projectVersions.current.set(tokenKey, ++projectUpdateVersion.current);
    try {
      const anchor = projectClockAnchor.current;
      const now = anchor ? anchor.seconds + Math.floor((performance.now() - anchor.sampledAt) / 1000) : projectNow;
      const updated = await readProjectUpdate(sdk, current, preparation, account, now, confirmedInfo);
      if (energySdkRef.current.context.chainId !== sourceChain || energySdkRef.current.wallet.address?.toLowerCase() !== account.toLowerCase()) return;
      setProjects(rows => rows.map(row => row.id === current.id && row.tokenAddress.toLowerCase() === tokenKey ? updated.project : row));
      setProjectPurchases(snapshot => snapshot.account?.toLowerCase() === account.toLowerCase() && snapshot.tokenKey === projectTokenKey
        ? { ...snapshot, status: "ready", byToken: { ...snapshot.byToken, [tokenKey]: updated.purchase } } : snapshot);
    } catch (cause) {
      // A failed read must not turn a confirmed transaction into a failed transaction.
      console.error("[SAUCE] Operated project refresh failed", current.tokenAddress, cause);
    }
  }
  async function subscribe() {
    if (!project || project.stage !== "live" || !project.capitalVerified || project.quoteDecimals === null || !wallet.isConnected || !validLots || !launchPadAddress || !owner || projectWriting) return;
    if (wallet.isWrongNetwork) { await wallet.switchChain(); return; }
    setProjectWritingAction("subscribe"); setMessage(null);
    try {
      if (!await readEffectiveUser(sdk, liveStake, owner as Address)) { setMessage("idoEffectiveRequired"); notifyAction("idoEffectiveRequired", "warning"); return; }
      const instance = await sdk.resolveContract("ido-preparation", [BigInt(project.id)]);
      const [indexPlusOne, latestInfo, ownPurchase, verified, chainTime] = await Promise.all([
        sdk.readContract<bigint>({ address: LAUNCHPAD_ADDRESS, abi: LAUNCHPAD_ABI, functionName: "preparationIndexPlusOne", args: [instance.address] }),
        sdk.readContract<LaunchPadListRow>({ contract: instance, abi: IDO_PREPARATION_ABI, functionName: "info" }),
        sdk.readContract<readonly [bigint, bigint, bigint, boolean]>({ contract: instance, abi: IDO_PREPARATION_ABI, functionName: "purchasedOf", args: [owner as Address] }),
        sdk.readContract<boolean>({ contract: instance, abi: IDO_PREPARATION_ABI, functionName: "isCapitalVerified" }),
        sdk.readContract<bigint>({ address: RELATION_ADDRESS, abi: RELATION_ABI, functionName: "timestemp" }),
      ]);
      if (!verified || chainTime < latestInfo.config.startTime || chainTime > latestInfo.config.endTime || indexPlusOne !== BigInt(project.id) + 1n || latestInfo.project.tokenAddress.toLowerCase() !== project.tokenAddress.toLowerCase() || latestInfo.state.isFired || latestInfo.state.totalSoldCount + BigInt(lots) > latestInfo.config.totalStock || (latestInfo.config.purchaseLimit > 0n && ownPurchase[2] + BigInt(lots) > latestInfo.config.purchaseLimit)) throw new Error("purchaseFailed");
      const isNative = project.quoteAddress.toLowerCase() === ZERO_ADDRESS.toLowerCase();
      const paymentToken = isNative ? null : await resolveLaunchQuoteToken(sdk, project.quoteAddress);
      const paymentBalance = isNative
        ? await sdk.getBalance(owner as Address)
        : await sdk.readContract<bigint>({ contract: paymentToken!, abi: erc20Abi, functionName: "balanceOf", args: [owner as Address] });
      setProjectQuoteBalance({ account: owner as Address, quoteAddress: project.quoteAddress, amount: paymentBalance });
      if (paymentBalance < project.price * BigInt(lots)) { setMessage("purchaseBalanceInsufficient"); notifyAction("purchaseBalanceInsufficient", "warning"); return; }
      const energyAmount = project.energy * BigInt(lots);
      if (energyAmount > 0n) {
        if (!energyTokenAddress) { setMessage("energyTokenUnavailable"); return; }
        const balance = await sdk.readContract<bigint>({ address: ENERGY_TOKEN_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [owner as Address] });
        setEnergyBalance(balance);
        if (balance < energyAmount) { setMessage("energyInsufficient"); notifyAction("energyInsufficient", "warning"); return; }
      }
      const cashAmount = project.price * BigInt(lots);
      const value = isNative ? cashAmount : 0n;
      if (paymentToken) {
        const allowance = await sdk.readContract<bigint>({ contract: paymentToken, abi: erc20Abi, functionName: "allowance", args: [owner as Address, launchPadAddress] });
        if (allowance < cashAmount) {
          // The genuine resolved handle carries the reviewed approval policy.
          // SDK simulation checks the fixed LaunchPad spender and maxApprovalWei.
          if (allowance > 0n) {
            const reset = await sdk.simulateContract({ contract: paymentToken, abi: erc20Abi, functionName: "approve", args: [launchPadAddress, 0n], account: owner as Address });
            if ((await sdk.waitForTx(await sdk.writeContract(reset.request))).status !== "success") throw new Error("Quote approval reset reverted");
          }
          const approval = await sdk.simulateContract({ contract: paymentToken, abi: erc20Abi, functionName: "approve", args: [launchPadAddress, cashAmount], account: owner as Address });
          const approvalHash = await sdk.writeContract(approval.request);
          const approvalReceipt = await sdk.waitForTx(approvalHash);
          if (approvalReceipt.status !== "success") throw new Error("Quote approval reverted");
          const updatedAllowance = await sdk.readContract<bigint>({ contract: paymentToken, abi: erc20Abi, functionName: "allowance", args: [owner as Address, launchPadAddress] });
          if (updatedAllowance < cashAmount) throw new Error("Quote approval insufficient");
        }
      }
      // Project.id retains the original list() index even after filtering/sorting.
      // amount is the full payment in base units; native payment additionally carries the same value.
      const prepared = await sdk.simulateContract({ address: LAUNCHPAD_ADDRESS, abi: LAUNCHPAD_ABI, functionName: "purchaseIDO", args: [BigInt(project.id), project.tokenAddress, BigInt(lots), cashAmount], account: owner as Address, value });
      const hash = await sdk.writeContract(prepared.request);
      const receipt = await sdk.waitForTx(hash);
      if (receipt.status !== "success") throw new Error("purchaseIDO reverted");
      setSelected(null);
      notifyAction("purchaseSuccess", "success");
      await refreshOperatedProject(project, instance);
    } catch (cause) { console.error("[SAUCE] Purchase IDO failed", cause); setMessage("purchaseFailed"); notifyAction("purchaseFailed", "error"); }
    finally { setProjectWritingAction(null); }
  }
  async function redeem(projectToken: Address) {
    if (!wallet.isConnected || !launchPadAddress || !owner || projectWriting) return;
    if (wallet.isWrongNetwork) { await wallet.switchChain(); return; }
    setProjectWritingAction("redeemIDO"); setMessage(null);
    try {
      const current = projects.find(item => item.tokenAddress.toLowerCase() === projectToken.toLowerCase());
      if (!current) throw new Error("Project is unavailable");
      const preparation = await sdk.resolveContract("ido-preparation", [BigInt(current.id)]);
      const prepared = await sdk.simulateContract({ contract: preparation, abi: IDO_PREPARATION_ABI, functionName: "redeemIDO", args: [], account: owner as Address });
      const hash = await sdk.writeContract(prepared.request);
      const receipt = await sdk.waitForTx(hash);
      if (receipt.status !== "success") throw new Error("redeemIDO reverted");
      notifyAction("refundSuccess", "success");
      setSelected(null);
      await refreshOperatedProject(current, preparation);
    } catch (cause) { console.error("[SAUCE] Redeem IDO failed", cause); setMessage("refundFailed"); notifyAction("refundFailed", "error"); }
    finally { setProjectWritingAction(null); }
  }
  async function launchProjectToken(projectToken: Address) {
    const current = visibleProjects.find(item => item.tokenAddress.toLowerCase() === projectToken.toLowerCase());
    if (!current || !isLaunchReady(current, projectNow) || !launchPadAddress || projectWriting) return;
    if (!wallet.isConnected || !owner) { await connect(); return; }
    if (wallet.isWrongNetwork) { await wallet.switchChain(); return; }
    setProjectWritingAction("launchToken"); setMessage(null);
    try {
      const preparation = await sdk.resolveContract("ido-preparation", [BigInt(current.id)]);
      const prepared = await sdk.simulateContract({ contract: preparation, abi: IDO_PREPARATION_ABI, functionName: "launchToken", args: [], account: owner as Address });
      const hash = await sdk.writeContract(prepared.request);
      const receipt = await sdk.waitForTx(hash);
      if (receipt.status !== "success") throw new Error("launchToken reverted");
      const refreshed = await sdk.readContract<LaunchPadListRow>({ contract: preparation, abi: IDO_PREPARATION_ABI, functionName: "info" });
      if (!refreshed.state.isFired) throw new Error("Launch not confirmed");
      setSelected(null);
      notifyAction("launchPlatformSuccess", "success");
      await refreshOperatedProject(current, preparation, refreshed);
    } catch (cause) {
      console.error("[SAUCE] LaunchPad launchToken failed", cause);
      setMessage("launchPlatformFailed");
      try { sdk.notify.error(t("launchPlatformFailed")); } catch { /* The inline error remains available. */ }
    } finally { setProjectWritingAction(null); }
  }
  async function claimProject(action: "claimIDO" | "refundCreatorBuy") {
    if (!project || !wallet.isConnected || !owner || projectWriting) return;
    if (wallet.isWrongNetwork) { await wallet.switchChain(); return; }
    setProjectWritingAction(action); setMessage(null);
    try {
      const preparation = await sdk.resolveContract("ido-preparation", [BigInt(project.id)]);
      const prepared = await sdk.simulateContract({ contract: preparation, abi: IDO_PREPARATION_ABI, functionName: action, args: [], account: owner as Address });
      const receipt = await sdk.waitForTx(await sdk.writeContract(prepared.request));
      if (receipt.status !== "success") throw new Error(action);
      notifyAction(action === "claimIDO" ? "idoClaimSuccess" : "creatorRefundSuccess", "success", action === "refundCreatorBuy" ? `${t("creatorRefundAmount")}: ${projectAmount(project.creatorBuyQuote, project.quoteDecimals)} ${project.quoteSymbol}` : undefined);
      setSelected(null);
      await refreshOperatedProject(project, preparation);
    } catch (cause) { console.error("[SAUCE] IDO claim/refund failed", cause); notifyAction("idoActionFailed", "error"); }
    finally { setProjectWritingAction(null); }
  }
  const status = (p: Project) => <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-2 py-1 text-[10px] ${p.isFired ? "border-[#f7594b]/40 bg-[#f7594b]/10 text-[#f7594b]" : p.stage === "live" ? "border-[#6f5d26] bg-[#292516] text-[#eac74e]" : p.stage === "soon" ? "border-[#344d60] bg-[#17222a] text-[#a4bdcf]" : "border-[#354c41] bg-[#1c2421] text-[#9ebaaa]"}`}><span className="bg-current rounded-full w-1 h-1" />{t(p.stage === "live" ? "subscribing" : p.stage === "soon" ? "waiting" : p.isFired ? "listedTrading" : p.failed ? "failed" : p.stock > 0n && p.sold >= p.stock ? "awaitingListing" : "pendingListing")}</span>;
  const progress = (p: Project) => {
    const percent = projectPercent(p);
    const node = <div className="min-w-0"><div className="flex justify-between items-center gap-2 mb-2 text-[11px] tabular-nums"><span>{projectAmount(p.sold * p.price, p.quoteDecimals)} <span className="text-[#9ba3af]">/ {projectAmount(p.stock * p.price, p.quoteDecimals)} {p.quoteSymbol}</span></span><span className="text-[#e5cf76]">{formatTruncated(percent, 2)}%</span></div><div role="progressbar" aria-label={`${p.name} ${t("progress")}`} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} className="bg-[#35382e] rounded-full h-1.5 overflow-hidden"><div className="bg-[#e9ce56] rounded-full h-full" style={{ width: `${percent}%` }} /></div><span className="block mt-1.5 text-[#9ba3af] text-[10px]">{t("soldStock")} {p.sold.toString()} / {p.stock.toString()} {t("launchLots")}</span></div>;
    return node;
  };
  return <div className="bg-[#0c0f11] w-full min-h-screen text-[#eeeef0] [&_button]:focus-visible:outline [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-offset-2 [&_button]:focus-visible:outline-[#ffda46]">
    <style>{`
 [data-sauce-featured-rail] { scrollbar-width: none; }
      [data-sauce-featured-rail]::-webkit-scrollbar { display: none; }

      [data-sauce-flow-frame]::before {
        content: "";
        position: absolute;
        z-index: 2;
        inset: 0 0 auto;
        height: 2px;
        pointer-events: none;
        background: linear-gradient(90deg, transparent, #d6a83e 25%, #fff2a7 50%, #e2ac39 75%, transparent);
        background-size: 30% 100%;
        background-repeat: no-repeat;
        filter: drop-shadow(0 2px 5px #e2ac3980);
        opacity: 0;
        animation-duration: 16s;
        animation-timing-function: linear;
        animation-iteration-count: infinite;
        animation-play-state: paused;
      }
      [data-sauce-flow-frame="featured"]::before { animation-name: sauce-flow-featured; }
      [data-sauce-flow-frame="board"]::before { animation-name: sauce-flow-board; }
      [data-sauce-flow-active="true"]::before { animation-play-state: running; }
      @keyframes sauce-flow-featured {
        0% { background-position: -50% 0; opacity: 0; }
        3% { opacity: 1; }
        24% { background-position: 150% 0; }
        26% { background-position: 150% 0; }
        47% { background-position: -50% 0; opacity: 1; }
        50%, 100% { background-position: -50% 0; opacity: 0; }
      }
      @keyframes sauce-flow-board {
        0%, 50% { background-position: -50% 0; opacity: 0; }
        53% { opacity: 1; }
        74% { background-position: 150% 0; }
        76% { background-position: 150% 0; }
        97% { background-position: -50% 0; opacity: 1; }
        100% { background-position: -50% 0; opacity: 0; }
      }
      /* Featured cards keep a quiet gold top edge, then reveal the warm hover light. */
      [data-sauce-featured-card] {
        position: relative;
        isolation: isolate;
        transition: border-color .24s ease, box-shadow .24s ease;
      }
      [data-sauce-featured-card]::before {
        content: "";
        position: absolute;
        z-index: 2;
        inset: 0 16px auto;
        height: 1px;
        background: linear-gradient(90deg, transparent, #c4a143 18%, #a98a37 78%, transparent);
        opacity: .72;
        pointer-events: none;
        transition: opacity .24s ease;
      }
      [data-sauce-featured-card]::after {
        content: "";
        position: absolute;
        z-index: 0;
        inset: 0;
        border-radius: inherit;
        background: radial-gradient(ellipse 95% 115% at 22% 8%, rgba(174, 133, 44, .23), rgba(122, 93, 32, .075) 52%, transparent 85%);
        opacity: 0;
        pointer-events: none;
        transition: opacity .3s ease;
      }
      [data-sauce-featured-card] > * { position: relative; z-index: 1; }
      [data-sauce-featured-card] h3 { transition: color .24s ease; }
      [data-sauce-featured-card]:is(:hover, :focus-within) {
        border-color: #d7b636;
        box-shadow: inset 0 1px #ecd053, 0 8px 28px #b48b171a;
      }
      [data-sauce-featured-card]:is(:hover, :focus-within)::before,
      [data-sauce-featured-card]:is(:hover, :focus-within)::after { opacity: 1; }
      [data-sauce-featured-card]:is(:hover, :focus-within) h3 { color: #ffe17b; }
      /* Shared hover treatment for IDO projects and staking asset orders. */
      [data-sauce-glow-row] {
        position: relative;
        isolation: isolate;
        transition: background .22s ease, box-shadow .22s ease;
      }
      [data-sauce-glow-row]::before {
        content: "";
        position: absolute;
        z-index: 1;
        inset: 0 0 auto;
        height: 2px;
        pointer-events: none;
        background: linear-gradient(90deg, transparent, #d8a735 25%, #fff2a9 50%, #d8a735 75%, transparent);
        background-size: 30% 100%;
        background-repeat: no-repeat;
        opacity: 0;
      }
      [data-sauce-glow-row]::after {
        content: "";
        position: absolute;
        z-index: 1;
        top: 10px;
        bottom: 10px;
        left: 0;
        width: 3px;
        border-radius: 2px;
        background: #ffda46;
        box-shadow: 0 0 14px #ffda4680;
        opacity: 0;
        pointer-events: none;
        transition: opacity .22s ease;
      }
      [data-sauce-glow-row]:is(:hover, :focus-within) {
        background: linear-gradient(90deg, #3b3521 0%, #25251e 31%, #1b1e1d 68%, #171d20 100%);
        box-shadow: inset 0 1px #8f7939, inset 0 -1px #665a37, 0 0 26px #d3a84015;
      }
      [data-sauce-glow-row]:is(:hover, :focus-within)::before {
        animation: sauce-project-edge-flash 1.05s ease-out 1;
      }
      [data-sauce-glow-row]:is(:hover, :focus-within)::after { opacity: 1; }
      @keyframes sauce-project-edge-flash {
        0% { background-position: -45% 0; opacity: 0; }
        12%, 78% { opacity: 1; }
        100% { background-position: 145% 0; opacity: 0; }
      }
      @keyframes sauce-mobile-menu-in {
        from { transform: translateX(100%); }
        to { transform: translateX(0); }
      }
      @media (prefers-reduced-motion: reduce) {
        [data-sauce-flow-frame]::before { animation: none; opacity: .45; background-position: 50% 0; }
        [data-sauce-glow-row]:is(:hover, :focus-within)::before { animation: none; opacity: .65; background-position: 50% 0; }
      }
    `}</style>
    <div className="pb-6">
      {/* The App owns its navigation; all four views remain inside this single package entry point. */}
      <header className="top-0 z-50 sticky border-white/10 bg-[#0c1114]/95 backdrop-blur-xl border-b w-full">
        <div className="flex justify-between items-center gap-2 md:gap-6 mx-auto px-4 sm:px-7 lg:px-10 py-3 md:py-4 w-full max-w-[1600px] min-h-[70px] md:min-h-[82px]">
          <button type="button" aria-label={t("homeAria")} onClick={() => showPage("home")} className="flex items-center gap-2 text-left shrink-0">
          <span className="font-extrabold text-xl tracking-tight">{t("brand")}<span className="text-[#ffda46]">.</span></span>
          <span className="lg:inline border-white/20 hidden pl-3 border-l text-[#a7aeb8] text-[9px] tracking-[.2em]">{t("launchpad")}</span>
        </button>
        <nav aria-label={t("mainNavigation")} className="md:flex items-stretch gap-4 lg:gap-7 hidden h-full">
          {menuPages.map(item => <button key={item} type="button" aria-current={page === item ? "page" : undefined} onClick={() => showPage(item)} className={`relative whitespace-nowrap px-1 text-sm ${page === item ? "font-semibold text-[#ffda46] after:absolute after:inset-x-0 after:bottom-[-17px] after:h-0.5 after:bg-[#ffda46]" : "text-[#9da4af] hover:text-white"}`}>{t(item)}</button>)}
        </nav>
        <div className="flex items-center gap-3 lg:gap-4 shrink-0">
          <span className={`hidden items-center gap-2 text-xs font-semibold md:flex ${wallet.isWrongNetwork ? "text-amber-300" : "text-white"}`}><span className={`h-2 w-2 rounded-full ${wallet.isWrongNetwork ? "bg-amber-300" : "bg-[#ffda46]"}`} />{t(wallet.isWrongNetwork ? "wrongNetwork" : "network")}</span>
          <Button type="button" variant="ghost" size="sm" aria-label={t("viewEnergy")} onClick={() => setPanel("energy")} className={`${page === "mine" ? "hidden" : "hidden md:inline-flex"} normal-case text-[#ffda46] hover:text-[#ffe77c]`}><Zap size={15} />{liveEnergyBalance}</Button>
          <Button type="button" variant="outline" size="sm" loading={connecting || wallet.isSwitchingChain} aria-label={t(wallet.isConnected ? wallet.isWrongNetwork ? "switchNetwork" : "walletDetails" : "connect")} onClick={openWallet} className="[--ui20-chamfer-border:#ffda46] hover:[--ui20-chamfer-border:#ffe77c] text-[#ffda46] hover:text-[#ffe77c] normal-case tracking-normal">
            <Wallet size={16} /><span className="sm:inline hidden">{wallet.isConnected ? wallet.isWrongNetwork ? t("switchNetwork") : shortAddress : t("connect")}</span><span className="sm:hidden">{wallet.isConnected ? wallet.isWrongNetwork ? t("switchShort") : shortAddress : t("connectShort")}</span>
          </Button>
          <button type="button" aria-label={t("mobileNavigation")} aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen(true)} className="inline-flex justify-center items-center border-[#4a5147] hover:border-[#a88d37] md:hidden bg-[#171d20] rounded-lg w-10 h-10 text-[#d9dfe5] hover:text-[#ffda46] transition-colors">
            <Menu size={20} />
          </button>
          </div>
        </div>
      </header>
      {mobileMenuOpen ? <>
        <button type="button" aria-label={t("close")} onClick={() => setMobileMenuOpen(false)} className="z-[60] fixed inset-0 md:hidden bg-black/65 backdrop-blur-[2px]" />
        <aside role="dialog" aria-modal="true" aria-label={t("mobileNavigation")} className="top-0 right-0 z-[70] fixed flex flex-col border-[#4a5147] md:hidden bg-[#13191c] shadow-[-20px_0_60px_#000a] border-l w-[min(82vw,320px)] h-[100dvh] [animation:sauce-mobile-menu-in_.22s_ease-out]">
          <div className="flex justify-between items-center border-white/10 px-5 border-b min-h-[70px]">
            <span className="font-extrabold text-xl tracking-tight">{t("brand")}<span className="text-[#ffda46]">.</span></span>
            <button type="button" aria-label={t("close")} onClick={() => setMobileMenuOpen(false)} className="inline-flex justify-center items-center border-[#3b454c] hover:border-[#a88d37] rounded-lg w-10 h-10 text-[#aeb8c1] hover:text-[#ffda46] transition-colors"><X size={19} /></button>
          </div>
          <nav aria-label={t("mobileNavigation")} className="flex flex-col gap-2 p-4 overflow-y-auto">
            {menuPages.map(item => {
              const Icon = item === "home" ? LayoutGrid : item === "create" ? Rocket : item === "staking" ? Coins : CircleUserRound;
              return <button key={item} type="button" aria-current={page === item ? "page" : undefined} onClick={() => showPage(item)} className={`flex items-center gap-4 rounded-xl px-4 min-h-[58px] text-sm transition-colors ${page === item ? "border border-[#74642d] bg-[#302d1d] font-semibold text-[#ffda46]" : "border border-transparent text-[#b4bec8] hover:border-[#4a5147] hover:bg-[#1d2427] hover:text-[#ffda46]"}`}><Icon size={21} /><span>{t(item === "create" ? "launcher" : item === "mine" ? "my" : item)}</span>{page === item ? <Check size={16} className="ml-auto" /> : null}</button>;
            })}
          </nav>
        </aside>
      </> : null}
      <div className="mx-auto px-4 sm:px-7 lg:px-10 max-w-[1600px]">
      {message === "walletError" ? <p role="alert" className="mt-3 text-red-300 text-sm">{t(message)}</p> : null}
      {/* Page: IDO home. Projects come from LaunchPad.list. */}
      {page === "home" ? <>
        <Banner>
          <Button type="button" variant="ghost" size="sm" aria-label={t("viewEnergy")} onClick={() => setPanel("energy")} className="top-2 right-2 z-20 absolute md:hidden bg-[#0c0f11]/75 px-2 text-[#ffda46] hover:text-[#ffe77c] normal-case"><Zap size={14} />{liveEnergyBalance}</Button>
          <div className="relative z-10 w-max max-md:w-full max-w-[50%] max-md:max-w-full">
            <h1 className="flex flex-col max-md:[text-shadow:0_3px_18px_#000c] font-extrabold text-[#f6f4ec] text-[clamp(42px,4.8vw,77px)] max-[359px]:text-[25px] max-md:text-[27px] leading-[1.03] max-md:leading-[1.02] tracking-[-.035em]">
              <span className="text-[1.17em] text-transparent max-md:text-[1.16em] tracking-[-.04em]" style={{ WebkitTextStroke: "1.5px #ffcf22" }}>{t("heroToken")}</span>
              <span className="mt-[5px] max-md:mt-[3px]">{t("heroAgent")}</span>
              <span className="mt-[9px] max-md:mt-[7px] text-[.91em] max-md:text-[.88em] tracking-[.025em]">{t("heroTitleBefore")}<span className="text-[#ffcf22]">{t("heroTitleAccent")}</span></span>
            </h1>
            <p className="mt-[23px] max-md:mt-2 font-semibold text-[#eeeae0] text-[clamp(14px,1.5vw,20px)] max-md:text-[11px] max-md:text-[#f1eee6] leading-[1.6] max-md:leading-[1.35] tracking-[.1em] max-md:tracking-[.04em]">{t("heroSub")}</p>
            <div className="flex flex-wrap items-center gap-6 max-md:gap-2 mt-6 max-md:mt-2 max-md:[&_button]:px-3 max-md:[&_button]:h-9 max-md:[&_button]:text-[11px]">
              <Button className={goldButton} onClick={() => showPage("create")}><Rocket size={18} />{t("heroLaunch")}<ArrowUpRight size={16} /></Button>
              <Button variant="ghost" className="text-[#d5d1c5] text-xs hover:text-[#ffe17a] normal-case" onClick={() => setPanel("guide")}>{t("guide")}<ArrowRight size={15} /></Button>
            </div>
            <p className="mt-5 max-md:mt-2 text-[#d3b75f] text-[11px] max-md:text-[9px] leading-[1.8] tracking-[.16em] max-md:tracking-[.1em]">{t("heroNote")}</p>
          </div>
        </Banner>
        <section ref={featuredFrame} data-sauce-flow-frame="featured" data-sauce-flow-active={flowVisible.featured} className="relative border-[#49402a] bg-[#131616] p-3 sm:p-4 border rounded-2xl overflow-hidden"><div className="flex justify-between items-center gap-2 mb-4"><h2 className="flex items-center gap-2 font-semibold text-sm"><Radio size={18} className="text-[#ffda46]" />{t("featured")}<span className="sm:inline hidden ml-2 font-normal text-[#9299a5] text-xs">{t("discover")}</span></h2><div className="flex gap-2">
          <button type="button" aria-label={t("previous")} onClick={() => rail.current?.scrollBy({ left: -310, behavior: "smooth" })} className="flex justify-center items-center border-[#353b43] hover:border-[#887537] bg-[#171b1e] hover:bg-[#242318] border rounded-lg w-[30px] max-sm:w-7 h-[30px] max-sm:h-7 text-[#b4bbc6] hover:text-[#ffda46] transition-colors"><ArrowLeft size={17} /></button>
          <button type="button" aria-label={t("next")} onClick={() => rail.current?.scrollBy({ left: 310, behavior: "smooth" })} className="flex justify-center items-center border-[#353b43] hover:border-[#887537] bg-[#171b1e] hover:bg-[#242318] border rounded-lg w-[30px] max-sm:w-7 h-[30px] max-sm:h-7 text-[#b4bbc6] hover:text-[#ffda46] transition-colors"><ArrowRight size={17} /></button>
        </div></div><div ref={rail} className="flex gap-3 [&::-webkit-scrollbar]:hidden snap-x pb-1 overflow-x-auto [scrollbar-width:none]">{featuredProjects.slice(0, 6).map(p => <article key={p.id} data-sauce-featured-card className="border-[#62522b] bg-[#191b19] p-4 snap-start border rounded-xl w-[275px] xl:w-[calc((100%-36px)/4)] text-left shrink-0"><button type="button" onClick={() => openProject(p)} className="flex items-center gap-3 w-full text-left" aria-label={`${t("view")} ${p.name}`}><ProjectImage sdk={sdk} project={p} /><div className="flex-1 min-w-0"><h3 className="font-semibold text-sm truncate">{p.name}</h3><div className="flex flex-wrap items-center gap-2 mt-1.5"><span className="text-[#969da7] text-[10px]">{p.symbol}</span>{status(p)}</div></div><ArrowUpRight size={16} className="text-[#9299a5] self-start" /></button><div className="flex justify-between items-center gap-2 my-4 text-xs"><span className="flex items-center gap-1 text-[#d4be64]"><Zap size={13} />{projectAmount(p.energy)} {t("energy")}</span><span>{projectAmount(p.price, p.quoteDecimals)} <span className="text-[#989d9c]">{p.quoteSymbol}</span></span></div>{progress(p)}</article>)}</div></section>
        {/* Account summary and participation shortcut stay on separate rows when phone width is tight. */}
        <section className="flex justify-end sm:justify-between items-center gap-2 sm:gap-4 py-2 sm:py-5 text-xs">
          <div className="sm:flex flex-wrap items-center gap-x-3 gap-y-1 hidden min-w-0">
            <Zap size={18} className="text-[#ffda46]" /><span className="text-[#a7aeb8]">{t("myEnergy")}</span><b>{liveEnergyBalance}</b>
          </div>
          <button type="button" disabled={connecting} aria-busy={connecting} onClick={() => wallet.isConnected ? setPanel("records") : void connect()} className="inline-flex justify-center items-center gap-2 hover:bg-[#25251b] disabled:opacity-50 px-2 py-2 rounded-lg min-h-10 font-semibold text-[#c9cbd0] hover:text-[#ffda46] active:text-[#ffe77c] whitespace-nowrap transition-colors group self-end sm:self-auto">
            <Wallet size={16} /><span>{t(wallet.isConnected ? "records" : "connect")}</span><ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
          </button>
        </section>
        <section ref={board} data-sauce-flow-frame="board" data-sauce-flow-active={flowVisible.board} className="relative border-[#30343a] bg-[#13171a] scroll-mt-4 border rounded-xl overflow-hidden">
          {/* Filters take the first row on phones; search and sort share the next row. */}
          <div className="items-center gap-2 sm:gap-3 grid grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[auto_minmax(0,1fr)_auto] p-3 sm:p-4">
            <div className="flex gap-1 col-span-2 lg:col-span-1 w-full lg:w-auto min-w-0 overflow-x-auto" role="group" aria-label={t("stage")}>{["all", "latest", "live", "soon", "ended"].map(key => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)} className={`min-h-11 shrink-0 rounded-lg px-3 text-xs ${filter === key ? "bg-[#302b17] text-[#ffda46]" : "text-[#a7aeb8] hover:bg-white/5"}`}>{t(key)}</button>)}</div>
            <div className="flex items-center gap-2 border-[#303236] focus-within:border-[#bca139] bg-[#11181d] px-2 border rounded-lg focus-within:ring-1 focus-within:ring-[#bca139]/50 min-w-0 h-11"><Search size={17} className="text-[#9299a5] shrink-0" /><Input aria-label={t("search")} placeholder={t("search")} value={query} onChange={e => setQuery(e.target.value)} className="border-0 bg-transparent shadow-none px-0 focus:border-transparent focus:ring-0 focus:ring-[#bca139]/50 min-w-0 font-normal text-[#f0f0f0] text-xs placeholder:text-[#8b96a4] caret-[#ffda46] [color-scheme:dark]" />{query ? <Button variant="ghost" size="icon" aria-label={t("clear")} onClick={() => setQuery("")}><X size={15} /></Button> : null}</div>
            {/* Render the options inside the app so the menu follows this theme on every browser. */}
            <div className="relative w-[132px] sm:w-[138px]" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setSortOpen(false); }} onKeyDown={event => { if (event.key === "Escape") { setSortOpen(false); sortButtonRef.current?.focus(); } }}>
              <button ref={sortButtonRef} type="button" aria-label={t("sort")} aria-expanded={sortOpen} onClick={() => setSortOpen(open => !open)} className={`flex items-center justify-between gap-2 border bg-[#11181d] px-3 rounded-lg w-full h-11 text-[11px] sm:text-xs transition-colors ${sortOpen ? "border-[#ffda46] text-[#ffda46]" : "border-[#303236] text-[#e8e8e8] hover:border-[#8e782f] hover:text-[#ffda46]"}`}>
                <span className="truncate">{t(sort)}</span><ChevronDown size={15} className={`shrink-0 transition-transform ${sortOpen ? "rotate-180" : ""}`} />
              </button>
              {sortOpen ? <>
                <button type="button" tabIndex={-1} aria-label={t("close")} onClick={() => setSortOpen(false)} className="z-20 fixed inset-0 cursor-default" />
                <div id="sauce-sort-options" role="group" aria-label={t("sort")} className="top-full right-0 z-30 absolute border-[#6e5c2a] bg-[#171a1a] shadow-[0_16px_36px_#000b] mt-2 p-1.5 border rounded-xl w-[168px]">
                  {(["recommended", "progressSort"] as const).map(key => <button key={key} type="button" aria-pressed={sort === key} onClick={() => { setSort(key); setSortOpen(false); }} className={`flex items-center justify-between gap-2 rounded-lg px-3 w-full min-h-10 text-left text-xs transition-colors ${sort === key ? "bg-[#302b17] text-[#ffda46]" : "text-[#d1d5d8] hover:bg-[#28291e] hover:text-[#ffda46]"}`}><span>{t(key)}</span>{sort === key ? <Check size={15} className="shrink-0" /> : null}</button>)}
                </div>
              </> : null}
            </div>
          </div>
          <div className="gap-x-4 xl:gap-x-6 border-white/10 hidden md:grid md:grid-cols-[minmax(235px,2fr)_70px_90px_minmax(120px,1.2fr)_98px] xl:grid-cols-[minmax(265px,2.5fr)_80px_90px_minmax(130px,1.25fr)_115px_115px] px-5 py-3 border-t text-[#9299a5] text-[11px]">
            {["project", "stage", "perLot", "progress", "remaining"].map(key => <span key={key} className={key === "remaining" ? "hidden xl:block" : ""}>{t(key)}</span>)}<span />
          </div>
          <div className="px-3 sm:px-4">
            {projectsLoading ? <p className="py-8 text-[#a7aeb8] text-center text-xs">{t("loadingProjects")}</p> : null}
            {projectsError ? <p role="alert" className="py-8 text-center text-red-300 text-xs">{t("projectLoadFailed")}</p> : null}
            {/* Project rows: restore the original desktop columns and compact two-column phone layout. */}
            {displayedProjectRows.map(p => (
              <article key={p.id} data-sauce-glow-row className="items-center gap-x-2 gap-y-4 md:gap-x-4 xl:gap-x-6 border-[#2d3135] grid grid-cols-[minmax(0,1fr)_105px] md:grid-cols-[minmax(235px,2fr)_70px_90px_minmax(120px,1.2fr)_98px] xl:grid-cols-[minmax(265px,2.5fr)_80px_90px_minmax(130px,1.25fr)_115px_115px] md:px-[7px] py-5 pr-0 pl-3 border-t md:min-h-[116px] text-xs">
                <button type="button" className="flex items-center gap-3 col-start-1 row-start-1 md:col-auto md:row-auto min-w-0 text-left" onClick={() => openProject(p)}>
                  <ProjectImage sdk={sdk} project={p} />
                  <div className="min-w-0">
                    <h3 className="font-semibold text-sm truncate">{p.projectTitle || t("purchaseInfoLoading")}</h3>
                    <p className="mt-1 text-[#a0a7af] text-[11px] break-all leading-relaxed" title={p.description}>{compactText(p.description)}</p>
                    <p className="mt-1 text-[#8b959f] text-[10px]">{t("tax")} {p.tax}</p>
                  </div>
                </button>
                <div className="justify-self-end md:justify-self-auto col-start-2 row-start-1 md:col-auto md:row-auto">{status(p)}</div>
                <div className="flex md:flex-col flex-wrap items-center md:items-start gap-x-3 gap-y-1 md:gap-2 col-start-1 row-start-2 md:col-auto md:row-auto min-w-0">
                  <b className="text-[13px] md:text-sm whitespace-nowrap">{projectAmount(p.price, p.quoteDecimals)} <span className="font-normal text-[#c2c7cf] text-[11px]">{p.quoteSymbol}</span></b>
                  <span className="flex items-center gap-1 text-[#d7bf62] text-[10px] whitespace-nowrap"><Zap size={12} />{projectAmount(p.energy)} {t("energy")}</span>
                </div>
                <div className="col-start-1 row-start-3 md:col-auto md:row-auto min-w-0">{progress(p)}</div>
                <div className="xl:flex flex-col gap-[7px] hidden min-w-0 tabular-nums">
                  <span className="text-[#929ca9] text-[11px] leading-[1.6] whitespace-nowrap">{t(hasProjectCountdown(p, projectNow) ? p.stage === "soon" ? "untilSubscriptionStart" : "untilSubscriptionEnd" : p.failed ? p.sold > 0n ? "failedRefundable" : "failed" : p.isFired ? "listedTrading" : isSoldOut(p) ? "saleEnded" : "pendingListing")}</span>
                  {hasProjectCountdown(p, projectNow) ? <b className="font-medium text-[13px] tracking-[.04em]"><Countdown seconds={Math.max(0, Number((p.stage === "soon" ? p.startTime : p.endTime) - BigInt(projectNow)))} /></b> : null}
                </div>
                {hasProjectCountdown(p, projectNow) ? <div className="flex items-center gap-2 md:hidden col-start-1 row-start-4 text-[#a7aeb8] text-[10px] tabular-nums"><span>{t(p.stage === "soon" ? "untilSubscriptionStart" : "untilSubscriptionEnd")}</span><b className="font-medium text-[#eeeef0]"><Countdown seconds={Math.max(0, Number((p.stage === "soon" ? p.startTime : p.endTime) - BigInt(projectNow)))} /></b></div> : null}
                <button type="button" disabled={isLaunchReady(p, projectNow) && projectWriting} className={`col-start-2 row-start-2 row-span-2 md:col-auto md:row-auto md:row-span-1 self-end md:self-auto flex items-center justify-center gap-1 border rounded-[7px] px-2 min-h-10 text-[11px] whitespace-nowrap transition-colors disabled:opacity-50 ${p.stage === "live" || isLaunchReady(p, projectNow) ? "border-[#6a5b29] bg-[#292718] text-[#ffdb58] hover:border-[#ffda46] hover:bg-[#ffda46] hover:text-[#1a180c]" : "border-[#4a4d4d] bg-transparent text-[#eeeef0] hover:border-[#ffda46] hover:text-[#ffda46]"}`} onClick={() => { if (isLaunchReady(p, projectNow)) { void launchProjectToken(p.tokenAddress); } else if (p.stage === "live" && !wallet.isConnected) { void connect(); } else { openProject(p); } }}>
                  {t(isLaunchReady(p, projectNow) ? "launchPlatform" : p.isFired ? "viewDetails" : p.stage === "live" ? "join" : p.stage === "soon" ? "view" : "result")}<ArrowUpRight size={15} />
                </button>
              </article>
            ))}
            {displayedProjectRows.length < rows.length ? <div className="flex justify-center border-[#2d3135] py-5 border-t"><button type="button" className="border-[#66582b] hover:border-[#ffda46] bg-[#211f15] px-5 rounded-lg min-h-11 text-[#d7c36b] text-xs hover:text-[#ffda46]" onClick={() => setProjectRowsPage({ key: projectRowsKey, limit: projectRowsLimit + PROJECT_ROWS_PAGE_SIZE })}>{t("stakeHistoryMore")}</button></div> : null}
            {!projectsLoading && !projectsError && !rows.length ? <div className="flex flex-col items-center gap-4 py-14 text-center"><Search size={28} className="text-[#ffda46]" /><h3>{t("empty")}</h3></div> : null}</div><div className="border-white/10 px-5 py-4 border-t text-[#939ba6] text-[10px]">{t("footer")}</div>
        </section><footer className="flex flex-wrap justify-between gap-3 py-6 text-[#969ea8] text-[10px]"><span>{t("brand")} {t("launchpad")}</span><span /><button className="flex items-center gap-1" onClick={() => setPanel("guide")}>{t("guide")}<ArrowUpRight size={13} /></button></footer>
      </> : page === "create" ? <CreateTokenPage
        t={t} values={launchValues} onChange={setLaunchValues} logoCid={launchLogoCid} onLogoCid={setLaunchLogoCid} creatorAddress={owner} onBack={() => showPage("home")}
        onCreated={() => showPage("home")}
        connected={wallet.isConnected} wrongNetwork={wallet.isWrongNetwork} launchSdk={sdk} tokenAddresses={paymentTokenAddresses} submission={launchSubmission} onSubmissionChange={setLaunchSubmission}
        onSwitch={() => { void wallet.switchChain().catch(() => setMessage("walletError")); }}
        uploadImage={file => sdk.uploadImage(file)} uploadText={text => sdk.uploadText(text)}
      /> : page === "staking" ? <StakingPage
        t={t}
        connected={wallet.isConnected} live={liveStake} energyBalance={energyBalance} onRefresh={token => { void refreshStakeToken(token); }} onRetry={() => setStakeRetry(value => value + 1)}
        onConnect={() => { void connect(); }}
        onBack={() => showPage("home")} onIDO={() => showPage("home")} onEnergy={() => setPanel("energy")} onAccount={() => showPage("mine")} onFeedback={notifyAction}
      /> : <AccountPage
        t={t} sdk={sdk} connected={wallet.isConnected} address={owner} energyBalance={energyBalance} live={liveStake}
        onConnect={() => { void connect(); }} onEnergy={() => setPanel("energy")}
        onRecords={() => setPanel("records")} onLaunches={() => setPanel("launches")}
      />}
    </div>
    {actionNotice ? <div role="status" aria-live="polite" className="top-1/2 left-1/2 z-[120] fixed w-max max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 pointer-events-none"><Alert tone={actionNotice.tone === "error" ? "danger" : actionNotice.tone} className="bg-[#101515] shadow-[0_12px_36px_#000b] px-5 py-3 text-sm">{t(actionNotice.key)}{actionNotice.detail ? ` · ${actionNotice.detail}` : ""}</Alert></div> : null}
    {project ? <Modal title={t("detail")} closeLabel={t("close")} copyFriendly onClose={() => setSelected(null)}>
      <div className="flex flex-wrap items-center gap-3"><ProjectImage sdk={sdk} project={project} /><div className="flex-1 min-w-0"><h3 className="font-semibold text-xl break-words">{project.projectTitle || t("purchaseInfoLoading")}</h3></div>{status(project)}</div>
      {project.description ? <p className="my-5 text-[#a7afb9] text-sm leading-relaxed [overflow-wrap:anywhere]">{project.description}</p> : null}
      <div className="flex items-center gap-2 mt-4 min-w-0"><p className="min-w-0 font-mono text-[#9299a5] text-xs break-all select-text">{project.tokenAddress}</p><CopyButton value={project.tokenAddress} className="text-[#ffda46] hover:text-[#ffe77c] shrink-0" /></div>
      <div className="my-5">{progress(project)}</div>
      <div className="gap-5 border-white/10 border-y grid grid-cols-2 my-5 py-5">{[["allocation", `${projectAmount(project.allocation)} ${project.symbol}`], ["energyCost", `${projectAmount(project.energy)} ${t("energy")}`], ["price", `${projectAmount(project.price, project.quoteDecimals)} ${project.quoteSymbol}`], ["tax", project.tax]].map(([label, value]) => <div key={label}><span className="text-[#9ba3af] text-xs">{t(label)}</span><b className="block mt-2 font-medium text-sm">{value}</b></div>)}</div>
      {project.stage !== "soon" ? <div className="flex justify-between gap-3 mb-4 text-sm"><span className="text-[#a7aeb8]">{t("participationLots")}</span><b>{projectPurchase ? projectPurchase.count.toString() : t(purchaseInfoStatus === "error" ? "purchaseInfoFailed" : wallet.isConnected ? "purchaseInfoLoading" : "purchaseInfoConnect")}</b></div> : null}
      {projectDetailReady !== detailKey ? <p className="text-[#a7aeb8] text-sm">{t("purchaseInfoLoading")}</p> : !project.capitalVerified ? <p className="text-[#a7aeb8] text-sm">{t("projectUnavailable")}</p> : project.stage === "live" ? <>
        <label className="flex flex-col gap-2 text-sm">{t("quantity")}<span className="text-[#a7aeb8] text-xs">{t("purchaseRemaining")} {projectPurchase ? maxPurchaseLots.toString() : "—"} {t("launchLots")}</span><Input type="number" min={1} max={maxPurchaseLots.toString()} step={1} value={quantity} onChange={e => { setQuantity(e.target.value); setMessage(null); }} className={`${launchInput} font-normal shadow-none`} /></label>
        <p className="mt-2 text-[#88929d] text-xs">{t("projectRemaining")} {remainingStock.toString()} {t("launchLots")} · {t("walletRemaining")} {projectPurchase ? remainingWalletLots.toString() : "—"} {t("launchLots")}</p>
        <div className="space-y-3 my-5 text-xs">{[["energyCost", validLots ? projectAmount(project.energy * BigInt(lots)) : "—"], ["cost", validLots ? `${projectAmount(project.price * BigInt(lots), project.quoteDecimals)} ${project.quoteSymbol}` : "—"], ["receive", validLots ? `${projectAmount(project.allocation * BigInt(lots))} ${project.symbol}` : "—"]].map(([key, value]) => <div key={key} className="flex justify-between gap-2"><span className="text-[#a7aeb8]">{t(key)}</span><b>{value}</b></div>)}</div>
        {projectPurchase && !validLots ? <p role="alert" className="mb-4 text-red-300 text-xs">{t("invalid")}</p> : null}
        {wallet.isConnected ? <><Button className={`w-full ${goldButton}`} loading={projectWritingAction === "subscribe"} disabled={!validLots || projectWriting || !paymentBalanceReady || !project.capitalVerified} onClick={() => void subscribe()}>{t("join")}<ArrowRight size={16} /></Button><div className="gap-2 grid grid-cols-2 mt-3 text-[#a7aeb8] text-[11px]"><span className="min-w-0 break-words">{t("myBalance")}: {displayedQuoteBalance} {project.quoteSymbol}</span><span className="text-right min-w-0 break-words">{t("myEnergy")}: {liveEnergyBalance}</span></div></> : null}
      </> : project.failed ? <div className="space-y-4">
        {projectPurchase && projectPurchase.count > 0n && !projectPurchase.isRedeemed ? <Button className={`w-full ${goldButton}`} loading={projectWritingAction === "redeemIDO"} disabled={projectWriting} onClick={() => void redeem(project.tokenAddress)}>{t("redeem")}</Button> : null}
        {project.creator?.toLowerCase() === owner.toLowerCase() && project.creatorBuyQuote > 0n && projectPurchase && !projectPurchase.creatorBuyRefunded ? <Button className={`w-full ${goldButton}`} loading={projectWritingAction === "refundCreatorBuy"} disabled={projectWriting} onClick={() => void claimProject("refundCreatorBuy")}>{t("refundCreatorBuy")}</Button> : null}
        {project.creator?.toLowerCase() === owner.toLowerCase() && project.creatorBuyQuote > 0n && projectPurchase?.creatorBuyRefunded ? <div className="flex justify-between items-baseline gap-3 text-sm"><span className="text-[#a7aeb8]">{t("creatorRefundAmount")}</span><b className="text-right min-w-0 break-words">{projectAmount(project.creatorBuyQuote, project.quoteDecimals)} {project.quoteSymbol}</b></div> : null}
        {projectPurchase?.isRedeemed ? <p className="text-[#a7aeb8] text-sm">{t("refundClaimed")}</p> : null}
      </div> : project.isFired && projectPurchase && projectPurchase.count > 0n ? projectPurchase.hasClaimed ? <div className="flex justify-between items-baseline gap-3 text-sm"><span className="text-[#a7aeb8]">{t("idoClaimed")}</span><b className="text-right min-w-0 break-words">{projectAmount(projectPurchase.count * project.allocation)} {project.symbol}</b></div> : <Button className={`w-full ${goldButton}`} loading={projectWritingAction === "claimIDO"} disabled={projectWriting} onClick={() => void claimProject("claimIDO")}>{t("claimIDO")}</Button> : isLaunchReady(project, projectNow) ? <Button className={`w-full ${goldButton}`} loading={projectWritingAction === "launchToken"} disabled={projectWriting} onClick={() => void launchProjectToken(project.tokenAddress)}>{t("launchPlatform")}</Button> : <div className="flex items-start gap-3 py-4 text-[#a7aeb8] text-sm leading-relaxed"><Clock size={20} className="text-[#ffda46] shrink-0" />{t(project.stage === "soon" ? "notStarted" : project.failed ? "failed" : project.isFired ? "completed" : isSoldOut(project) ? "awaitingListing" : "pendingListing")}</div>}
      {message === "walletError" || message === "idoEffectiveRequired" || message === "purchaseBalanceInsufficient" || message === "purchaseFailed" || message === "refundFailed" || message === "launchPlatformFailed" || message === "quoteApprovalRequired" || message === "energyTokenUnavailable" || message === "energyInsufficient" ? <p role="alert" className="mt-3 text-red-300 text-sm">{t(message)}</p> : null}
    </Modal> : null}
    {panel ? <Modal
      title={t(panel === "energy" ? "energyCenter" : panel === "wallet" ? "walletAccount" : panel === "launches" ? "myLaunches" : panel)}
      closeLabel={t("close")}
      copyFriendly={panel === "wallet"}
      onClose={() => { setPanel(null); setMessage(null); }}
    >
      {panel === "guide" ? <>
        <h3 className="mb-5 font-semibold text-xl">{t("guideTitle")}</h3>
        <ol className="space-y-5 pl-5 text-[#b4bdc8] text-sm leading-7 list-decimal">{["guide1", "guide2", "guide3", "guide4"].map(key => <li key={key}>{t(key)}</li>)}</ol>
        <p className="border-[#6f5d26] mt-6 p-3 border rounded-lg text-[#e5cf76] text-xs leading-relaxed">{t("guideDemo")}</p>
      </> : panel === "energy" ? <>
        <div className="flex items-center gap-3 border-[#49402a] bg-[#242418] p-5 border rounded-xl text-[#ffda46]"><Zap size={26} /><div><span className="text-[#c8c2a9] text-xs">{t("myEnergy")}</span><b className="block mt-1 text-3xl">{liveEnergyBalance}</b></div></div>
        {wallet.isConnected ? <>
          <p className="mt-4 text-[#a7aeb8] text-xs leading-relaxed">{t(activeEligible === null ? "stakeLoadingPools" : activeEligible ? "stakeActiveDesc" : "stakePausedNote")}</p>
        </> : null}
      </> : panel === "launches" ? <>

        <IdoHistory sdk={sdk} account={wallet.isConnected ? wallet.address ?? null : null} launchPad={launchPadAddress} projects={projects} projectsLoading={projectsLoading && !projectSnapshotReady.current} kind="launches" t={t} />
      </> : panel === "wallet" ? <>
        <p className="text-right mb-4 text-[#ffda46] text-xs">{t("walletStatusConnected")}</p>
        <div className="flex items-center gap-2 min-w-0"><p className="min-w-0 font-mono text-[#d5d7d5] text-sm break-all select-text">{wallet.address}</p><CopyButton value={wallet.address ?? ""} className="text-[#ffda46] hover:text-[#ffe77c] shrink-0" /></div>
        <p className="mt-5 text-[#a7aeb8] text-sm">{t("walletNetworkName")}</p>
        <Button type="button" variant="outline" onClick={disconnect} className="bg-[#0b0e0f] hover:bg-[#242318] mt-6 [--ui20-chamfer-border:#6f5d26] hover:[--ui20-chamfer-border:#ffda46] w-full text-[#eeeef0] hover:text-[#ffda46]">{t("walletDisconnect")}</Button>
      </> : <>
        <IdoHistory sdk={sdk} account={wallet.isConnected ? wallet.address ?? null : null} launchPad={launchPadAddress} projects={projects} projectsLoading={projectsLoading && !projectSnapshotReady.current} kind="records" t={t} />
      </>}
    </Modal> : null}
    </div>
  </div>;
}
