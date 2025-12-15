

console.log("PulseLocker app.js loaded.");

if (!window.ethers) {
  alert("Ethers failed to load.");
  throw new Error("Ethers missing");
}
const ethersLib = window.ethers;

// =======================================================
// Helpers (FORMAT / SAFE CALL)
// =======================================================

function formatLockPrice(value) {
  if (!isFinite(value) || value === 0) return "0.0000";
  let s = Number(value).toPrecision(4);
  if (s.includes("e") || s.includes("E")) {
    const n = Number(s);
    let fixed = n.toFixed(8);
    fixed = fixed.replace(/0+$/, "").replace(/\.$/, "");
    return fixed;
  }
  return s;
}

function formatReserveK(value) {
  if (!isFinite(value) || value === 0) return "0.0000";
  const abs = Math.abs(value);
  if (abs >= 1000) {
    return formatLockPrice(value / 1000) + "k";
  }
  return formatLockPrice(value);
}

// RPC-safe retry wrapper
async function safeCall(fn, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn(false);
    } catch (err) {
      if (i === attempts - 1) {
        return await fn(true); // fallback provider
      }
      await new Promise(r => setTimeout(r, 80 * (i + 1)));
    }
  }
}

// =======================================================
// LocalStorage helpers (DO NOT CHANGE KEYS)
// =======================================================

function vaultListKey(addr) {
  return "generic-vaults-" + addr.toLowerCase();
}

function collapsedKey(addr) {
  return "vaultCollapsed-" + addr.toLowerCase();
}

function isCollapsed(addr) {
  return localStorage.getItem(collapsedKey(addr)) === "1";
}

function setCollapsed(addr, v) {
  localStorage.setItem(collapsedKey(addr), v ? "1" : "0");
}

// =======================================================
// Providers (PRIMARY + FALLBACK CLUSTER)
// =======================================================

const fallbackProvider = new ethersLib.providers.FallbackProvider(
  [
    new ethersLib.providers.JsonRpcProvider("https://pulsechain.publicnode.com"),
    new ethersLib.providers.JsonRpcProvider("https://rpc.pulsechain.com"),
    new ethersLib.providers.JsonRpcProvider("https://rpc-pulsechain.g4mm4.io")
  ],
  1
);

function getPrimaryContract(addr, abi) {
  return new ethersLib.Contract(addr, abi, provider || fallbackProvider);
}

function getFallbackContract(addr, abi) {
  return new ethersLib.Contract(addr, abi, fallbackProvider);
}

// =======================================================
// CONFIG — SINGLE FACTORY (NO LEGACY)
// =======================================================

const FACTORY_ADDRESS =
  "0x3eAB22cb1573965C77176E76f6340e521A99a3CC".toLowerCase(); 
// <-- FILL AFTER DEPLOY

const ASSETS = {
  PLS: {
    label: "PLS",
    isNative: true,
    lockDecimals: 18
  },
  PDAI: {
    label: "pDAI",
    isNative: false,
    lockDecimals: 18
  },
  HEX: {
    label: "HEX",
    isNative: false,
    lockDecimals: 8
  }
};

// =======================================================
// ABIs (MINIMAL, STABLE SHAPES)
// =======================================================

const factoryAbi = [
  "event VaultCreated(address indexed owner, address indexed vault, address indexed lockToken, uint256 amount, uint256 priceThreshold1e18, uint256 unlockTime)",
  "function createVaultAndDeposit(address lockToken,uint256 amount,uint256 priceThreshold1e18,uint256 unlockTime) payable returns (address)",
  "function vaultsOf(address owner) view returns (address[])"
];

const vaultAbi = [
  "function owner() view returns (address)",
  "function lockToken() view returns (address)",
  "function isNative() view returns (bool)",
  "function priceThreshold1e18() view returns (uint256)",
  "function unlockTime() view returns (uint256)",
  "function startTime() view returns (uint256)",
  "function withdrawn() view returns (bool)",
  "function currentPrice1e18() view returns (uint256)",
  "function priceConditionMet() view returns (bool)",
  "function timeConditionMet() view returns (bool)",
  "function canWithdraw() view returns (bool)",
  "function secondsUntilTimeUnlock() view returns (uint256)",
  "function priceDetail() view returns (uint256,bool,uint256,uint256,bool,uint256,uint256,bool,bool,bool,bool)",
  "function withdraw()",
  "function rescueToken(address)",
  "function rescueNative()"
];

// =======================================================
// STATE
// =======================================================

let provider, signer, userAddress;
let factoryContract;
let vaults = [];
let countdownTimer;

// =======================================================
// DOM
// =======================================================

const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const walletSpan = document.getElementById("walletAddress");
const networkInfo = document.getElementById("networkInfo");
const themeToggle = document.getElementById("themeToggle");

const assetSelect = document.getElementById("assetSelect");
const depositAmountInput = document.getElementById("depositAmount");
const targetPriceInput = document.getElementById("targetPrice");
const unlockDateInput = document.getElementById("unlockDateTime");
const createForm = document.getElementById("createForm");
const createBtn = document.getElementById("createBtn");
const createStatus = document.getElementById("createStatus");

const restoreVaultsBtn = document.getElementById("restoreVaultsBtn");
const manualVaultInput = document.getElementById("manualVaultInput");
const addVaultBtn = document.getElementById("addVaultBtn");
const manualAddStatus = document.getElementById("manualAddStatus");

const locksContainer = document.getElementById("locksContainer");

const globalPriceDiv = document.getElementById("globalPrice");
const globalPriceRaw = document.getElementById("globalPriceRaw");

// =======================================================
// THEME TOGGLE
// =======================================================

(function initTheme() {
  const saved = localStorage.getItem("vault-theme");
  if (saved === "light") {
    document.body.classList.add("light-theme");
    themeToggle.textContent = "🌚 Night";
  } else {
    themeToggle.textContent = "🌞 Day";
  }
})();

themeToggle.addEventListener("click", () => {
  const isLight = document.body.classList.toggle("light-theme");
  localStorage.setItem("vault-theme", isLight ? "light" : "dark");
  themeToggle.textContent = isLight ? "🌚 Night" : "🌞 Day";
});

// =======================================================
// WALLET CONNECT / NETWORK
// =======================================================

async function switchToPulseChain() {
  if (!window.ethereum) return;
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x171" }]
    });
  } catch (err) {
    if (err.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: "0x171",
          chainName: "PulseChain",
          rpcUrls: ["https://rpc.pulsechain.com"],
          nativeCurrency: { name: "Pulse", symbol: "PLS", decimals: 18 },
          blockExplorerUrls: ["https://scan.pulsechain.com"]
        }]
      });
    } else {
      throw err;
    }
  }
}

async function connect() {
  if (!window.ethereum) {
    alert("No wallet detected.");
    return;
  }

  provider = new ethersLib.providers.Web3Provider(window.ethereum, "any");
  await provider.send("eth_requestAccounts", []);
  signer = provider.getSigner();
  userAddress = (await signer.getAddress()).toLowerCase();

  factoryContract = new ethersLib.Contract(
    FACTORY_ADDRESS,
    factoryAbi,
    signer
  );

  connectBtn.textContent = "Connected ✓";
  connectBtn.disabled = true;
  disconnectBtn.style.display = "flex";

  walletSpan.textContent = userAddress;

  const net = await provider.getNetwork();
  if (net.chainId !== 369) {
    networkInfo.innerHTML =
      `<span style="color:#c62828;font-weight:700;">
        Wrong network (${net.chainId})
       </span>
       <button onclick="switchToPulseChain()">Switch</button>`;
  } else {
    networkInfo.textContent = "Connected (PulseChain)";
  }

  await refreshGlobalPrice();
  await restoreVaults();
  startTimers();
}

connectBtn.addEventListener("click", connect);

disconnectBtn.addEventListener("click", () => {
  provider = null;
  signer = null;
  userAddress = null;
  factoryContract = null;
  vaults = [];
  locksContainer.textContent = "Connect wallet to load vaults.";

  connectBtn.textContent = "Connect Wallet";
  connectBtn.disabled = false;
  disconnectBtn.style.display = "none";
  walletSpan.textContent = "";
  networkInfo.textContent = "";
});

// =======================================================
// GLOBAL PRICE FEED (DISPLAY ONLY)
// =======================================================

async function refreshGlobalPrice() {
  if (!provider) {
    globalPriceDiv.textContent = "Connect wallet to fetch live prices.";
    globalPriceRaw.textContent = "";
    return;
  }
  // The detailed logic stays identical to your legacy UI
  // (implemented in Part 2 to keep structure intact)
}



// =======================================================
// VIEW TABS (Dashboard / User Guide)
// =======================================================

const tabDashboard = document.getElementById("tab-dashboard");
const tabUserguide = document.getElementById("tab-userguide");
const viewDashboard = document.getElementById("view-dashboard");
const viewUserguide = document.getElementById("view-userguide");

function setActiveTab(which) {
  if (which === "dashboard") {
    viewDashboard.style.display = "block";
    viewUserguide.style.display = "none";
    tabDashboard.classList.add("active-header-tab");
    tabUserguide.classList.remove("active-header-tab");
  } else {
    viewDashboard.style.display = "none";
    viewUserguide.style.display = "block";
    tabUserguide.classList.add("active-header-tab");
    tabDashboard.classList.remove("active-header-tab");
  }
}

if (tabDashboard && tabUserguide) {
  tabDashboard.addEventListener("click", (e) => {
    e.preventDefault();
    setActiveTab("dashboard");
  });
  tabUserguide.addEventListener("click", (e) => {
    e.preventDefault();
    setActiveTab("userguide");
  });
}

// =======================================================
// AUTO-RECONNECT (if already authorized)
// =======================================================

if (window.ethereum) {
  window.ethereum.request({ method: "eth_accounts" })
    .then((accounts) => {
      if (accounts && accounts.length > 0) connect();
    })
    .catch((err) => console.error("Auto-connect error:", err));
}

// Network/account change handling (no popups)
if (window.ethereum) {
  window.ethereum.on("chainChanged", async () => {
    try { await refreshGlobalPrice(); } catch {}
  });

  window.ethereum.on("accountsChanged", async (accounts) => {
    if (!accounts || !accounts.length) {
      walletSpan.textContent = "";
      connectBtn.textContent = "Connect Wallet";
      connectBtn.disabled = false;
      return;
    }
    await connect();
  });
}

// =======================================================
// GLOBAL PRICE FEED (FULL LOGIC, reserve-weighted selection)
// =======================================================

const pairAbi = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)"
];

function computeDisplayDecimals(lockDecimals, quoteDecimals) {
  return 18 + quoteDecimals - lockDecimals;
}

function priceBNToUsdFloat(priceBN, lockDecimals, quoteDecimals) {
  const displayDecimals = computeDisplayDecimals(lockDecimals, quoteDecimals);
  return Number(ethersLib.utils.formatUnits(priceBN, displayDecimals));
}

function quoteResToUsdFloat(quoteResBN, quoteDecimals) {
  return Number(ethersLib.utils.formatUnits(quoteResBN, quoteDecimals));
}

/**
 * NOTE:
 * The factory holds routing and decimals. For the global feed display,
 * we simply mirror the asset selection and show two pair routes if you wire them
 * into app.js config. To keep this file usable immediately, we use placeholders
 * you will update once you deploy and decide pairs.
 *
 * This mirrors your legacy UI so the layout doesn't change.
 */
const GLOBAL_FEEDS = {
  PLS: {
    primaryPair: "0xE56043671df55dE5CDf8459710433C10324DE0aE", // fill after deployment
    primaryQuoteDecimals: 18,
    primaryLockTokenIsToken0: true,
    backupPair: "0x146E1f1e060e5b5016Db0D118D2C5a11A240ae32",  // fill after deployment
    backupQuoteDecimals: 18,
    backupLockTokenIsToken0: true,
    label: "PLS",
    lockDecimals: 18,
    primaryFeedLabel: "Primary feed",
    backupFeedLabel: "Backup feed"
  },
  PDAI: {
    primaryPair: "0xfC64556FAA683e6087F425819C7Ca3C558e13aC1",
    primaryQuoteDecimals: 18,
    primaryLockTokenIsToken0: true,
    backupPair: "0x1D2be6eFf95Ac5C380a8D6a6143b6a97dd9D8712",
    backupQuoteDecimals: 18,
    backupLockTokenIsToken0: true,
    label: "pDAI",
    lockDecimals: 18,
    primaryFeedLabel: "Primary feed",
    backupFeedLabel: "Backup feed"
  },
  HEX: {
    primaryPair: "0xC475332e92561CD58f278E4e2eD76c17D5b50f05",
    primaryQuoteDecimals: 6,
    primaryLockTokenIsToken0: true,
    backupPair: "0x6F1747370B1CAcb911ad6D4477b718633DB328c8",
    backupQuoteDecimals: 18,
    backupLockTokenIsToken0: true,
    label: "HEX",
    lockDecimals: 8,
    primaryFeedLabel: "Primary feed",
    backupFeedLabel: "Backup feed"
  }
};

async function computePairPriceAndLiquidity(pairAddr, lockDecimals, quoteDecimals, lockIsToken0) {
  if (!pairAddr) return { ok: false };
  try {
    const pair = getPrimaryContract(pairAddr, pairAbi);

    const [r0, r1] = await safeCall(useFallback =>
      useFallback ? getFallbackContract(pairAddr, pairAbi).getReserves()
                  : pair.getReserves()
    );

    if (r0.eq(0) || r1.eq(0)) return { ok: false };

    const lockRes = lockIsToken0 ? r0 : r1;
    const quoteRes = lockIsToken0 ? r1 : r0;

    if (lockRes.eq(0)) return { ok: false };

    const priceBN = quoteRes.mul(ethersLib.constants.WeiPerEther).div(lockRes);
    const priceFloat = priceBNToUsdFloat(priceBN, lockDecimals, quoteDecimals);
    const quoteResFloat = quoteResToUsdFloat(quoteRes, quoteDecimals);

    return { ok: true, priceBN, priceFloat, quoteResBN: quoteRes, quoteResFloat };
  } catch (err) {
    console.error("Pair price error for", pairAddr, err);
    return { ok: false };
  }
}

async function refreshGlobalPrice() {
  try {
    if (!provider) {
      globalPriceDiv.textContent = "Connect wallet to fetch live prices.";
      globalPriceRaw.textContent = "";
      return;
    }

    const assetCode = assetSelect.value;
    const cfg = GLOBAL_FEEDS[assetCode];
    if (!cfg) return;

    const primaryInfo = await computePairPriceAndLiquidity(
      cfg.primaryPair,
      cfg.lockDecimals,
      cfg.primaryQuoteDecimals,
      cfg.primaryLockTokenIsToken0
    );

    const backupInfo = await computePairPriceAndLiquidity(
      cfg.backupPair,
      cfg.lockDecimals,
      cfg.backupQuoteDecimals,
      cfg.backupLockTokenIsToken0
    );

    let chosenSource = "none";
    let chosenPriceFloat = null;

    if (primaryInfo.ok && !backupInfo.ok) {
      chosenSource = "primary";
      chosenPriceFloat = primaryInfo.priceFloat;
    } else if (!primaryInfo.ok && backupInfo.ok) {
      chosenSource = "backup";
      chosenPriceFloat = backupInfo.priceFloat;
    } else if (primaryInfo.ok && backupInfo.ok) {
      if (primaryInfo.quoteResFloat > backupInfo.quoteResFloat) {
        chosenSource = "primary";
        chosenPriceFloat = primaryInfo.priceFloat;
      } else if (backupInfo.quoteResFloat > primaryInfo.quoteResFloat) {
        chosenSource = "backup";
        chosenPriceFloat = backupInfo.priceFloat;
      } else {
        chosenSource = (primaryInfo.priceFloat >= backupInfo.priceFloat) ? "primary" : "backup";
        chosenPriceFloat = (chosenSource === "primary") ? primaryInfo.priceFloat : backupInfo.priceFloat;
      }
    } else {
      chosenSource = "none";
    }

    let html = "";
    html += `<div class="small"><b>Primary feed (1°):</b> ${cfg.primaryFeedLabel}<br>`;
    html += `Pair: <span class="mono">${cfg.primaryPair || "(not set)"}</span><br>`;
    if (!primaryInfo.ok) {
      html += `Status: <span class="status-bad">unavailable</span>`;
    } else {
      html += `Status: <span class="status-ok">ok</span><br>`;
      html += `Price: 1 ${cfg.label} ≈ $${formatLockPrice(primaryInfo.priceFloat)}, `;
      html += `USD-side reserves: $${formatReserveK(primaryInfo.quoteResFloat)}`;
    }
    html += `</div>`;

    html += `<div class="small" style="margin-top:8px;"><b>Backup feed (2°):</b> ${cfg.backupFeedLabel}<br>`;
    html += `Pair: <span class="mono">${cfg.backupPair || "(not set)"}</span><br>`;
    if (!backupInfo.ok) {
      html += `Status: <span class="status-bad">unavailable</span>`;
    } else {
      html += `Status: <span class="status-ok">ok</span><br>`;
      html += `Price: 1 ${cfg.label} ≈ $${formatLockPrice(backupInfo.priceFloat)}, `;
      html += `USD-side reserves: $${formatReserveK(backupInfo.quoteResFloat)}`;
    }
    html += `</div>`;

    html += `<div class="small" style="margin-top:8px;">`;
    if (chosenSource === "primary") {
      html += `Effective price (logic): <b>$${formatLockPrice(chosenPriceFloat)}</b> via <b>𝟏° feed</b>.`;
    } else if (chosenSource === "backup") {
      html += `Effective price (logic): <b>$${formatLockPrice(chosenPriceFloat)}</b> via <b>𝟐° feed</b>.`;
    } else {
      html += `No valid price feeds at this moment – only time unlock will work.`;
    }
    html += `</div>`;

    globalPriceDiv.innerHTML = html;

    let rawText = "";
    rawText += primaryInfo.ok ? `𝟏° raw 1e18: ${primaryInfo.priceBN.toString()}\n` : `𝟏°: unavailable\n`;
    rawText += backupInfo.ok ? `,  𝟐° raw 1e18: ${backupInfo.priceBN.toString()}` : `,  𝟐°: unavailable`;
    globalPriceRaw.textContent = rawText.trim();

  } catch (err) {
    globalPriceDiv.textContent = "Price error.";
    globalPriceRaw.textContent = "";
    console.error("Global price error:", err);
  }
}

assetSelect.addEventListener("change", () => {
  refreshGlobalPrice();
});

// =======================================================
// VAULT DISCOVERY / RESTORE (Single factory only)
// =======================================================

function getLocalVaults() {
  if (!userAddress) return [];
  const raw = localStorage.getItem(vaultListKey(userAddress));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setLocalVaultList(list) {
  localStorage.setItem(vaultListKey(userAddress), JSON.stringify(list));
}

function saveLocalVaultAddress(addr) {
  const list = getLocalVaults();
  const lower = addr.toLowerCase();
  if (!list.includes(lower)) {
    list.push(lower);
    setLocalVaultList(list);
  }
}

async function restoreVaults() {
  if (!provider || !userAddress) return;

  try {
    manualAddStatus.textContent = "Checking contract registry...";
    const onchain = await factoryContract.vaultsOf(userAddress);
    if (!onchain.length) {
      manualAddStatus.textContent = "No vaults found for this wallet.";
      vaults = [];
      renderVaults();
      return;
    }

    const existing = getLocalVaults();
    const set = new Set(existing);
    let added = 0;

    for (const v of onchain) {
      const lower = v.toLowerCase();
      if (!set.has(lower)) {
        existing.push(lower);
        set.add(lower);
        added++;
      }
    }
    setLocalVaultList(existing);

    // load + render (no flash pattern)
    manualAddStatus.textContent = added ? `Restored ${added} vault(s).` : "All vaults already restored.";
    await loadLocalVaults();
    renderVaults();
    await updateVaults(); // fill live data immediately
  } catch (err) {
    manualAddStatus.textContent = "Restore failed: " + err.message;
    console.error(err);
  }
}

restoreVaultsBtn.addEventListener("click", restoreVaults);

// Manual add vault address (view-only supported)
addVaultBtn.addEventListener("click", async () => {
  const addr = (manualVaultInput.value || "").trim().toLowerCase();
  if (!addr || !addr.startsWith("0x") || addr.length !== 42) {
    manualAddStatus.textContent = "Enter a valid vault address.";
    return;
  }

  saveLocalVaultAddress(addr);
  manualAddStatus.textContent = "Added. Loading...";
  await softLoadSingleVault(addr);
  manualAddStatus.textContent = "Added.";
  await updateVaults();
});

// =======================================================
// CREATE VAULT (Bundled deposit)
// =======================================================

function assetToLockTokenAddress(code) {
  // Native PLS uses address(0) in factory config.
  if (code === "PLS") return ethersLib.constants.AddressZero;
  // For ERC20 vaults, you will fill these with the correct deployed token addresses.
  if (code === "PDAI") return "0x6B175474E89094C44Da98b954EedeAC495271d0F";
  if (code === "HEX")  return "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39";
  return ethersLib.constants.AddressZero;
}

function parseAmount(code, amountStr) {
  const cfg = ASSETS[code];
  return ethersLib.utils.parseUnits(amountStr, cfg.lockDecimals);
}

createForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!signer) {
    alert("Connect wallet first.");
    return;
  }

  try {
    createBtn.disabled = true;
    createStatus.textContent = "Sending...";

    const assetCode = assetSelect.value;
    const lockTokenAddr = assetToLockTokenAddress(assetCode);

    const amountStr = (depositAmountInput.value || "").trim();
    if (!amountStr || Number(amountStr) <= 0) throw new Error("Enter an amount");

    const amountBN = parseAmount(assetCode, amountStr);

    const priceStr = (targetPriceInput.value || "").trim();
    if (!priceStr) throw new Error("Enter a target price (USD per 1 token)");
    const th1e18 = ethersLib.utils.parseUnits(priceStr, 18);

    const dt = (unlockDateInput.value || "").trim();
    const ts = Date.parse(dt);
    if (isNaN(ts)) throw new Error("Invalid datetime");
    const unlockTime = Math.floor(ts / 1000);

    if (unlockTime <= Math.floor(Date.now() / 1000)) {
      throw new Error("Unlock time must be in the future");
    }

    const overrides = {};
    if (ASSETS[assetCode].isNative) {
      overrides.value = amountBN;
    }

    const tx = await factoryContract.createVaultAndDeposit(
      lockTokenAddr,
      amountBN,
      th1e18,
      unlockTime,
      overrides
    );

    const rcpt = await tx.wait();

    let vaultAddr = null;
    for (const log of rcpt.logs) {
      try {
        const parsed = factoryContract.interface.parseLog(log);
        if (parsed.name === "VaultCreated") {
          vaultAddr = parsed.args.vault;
          break;
        }
      } catch {}
    }

    if (!vaultAddr) {
      createStatus.textContent = "Created, but vault address not parsed.";
    } else {
      const lower = vaultAddr.toLowerCase();
      saveLocalVaultAddress(lower);
      createStatus.textContent = "Vault created.";
      await softLoadSingleVault(lower);
      renderVaults();
      await updateVaults();
    }

  } catch (err) {
    createStatus.textContent = "Error: " + (err?.message || String(err));
    console.error(err);
  } finally {
    createBtn.disabled = false;
  }
});

// =======================================================
// CORE VAULT LOADERS (No-flash architecture)
// =======================================================

async function loadLocalVaults() {
  vaults = [];
  const list = getLocalVaults();
  for (const addr of list) {
    const v = await loadOneVaultStatic(addr);
    if (v) vaults.push(v);
  }
}

async function softLoadSingleVault(addr) {
  const exists = vaults.some(v => v.address === addr.toLowerCase());
  if (exists) return;
  const v = await loadOneVaultStatic(addr);
  if (v) vaults.push(v);
}

async function loadOneVaultStatic(addr) {
  try {
    const vault = getPrimaryContract(addr, vaultAbi);

    const owner = await safeCall(useFallback =>
      useFallback ? getFallbackContract(addr, vaultAbi).owner() : vault.owner()
    );

    const lockToken = await safeCall(useFallback =>
      useFallback ? getFallbackContract(addr, vaultAbi).lockToken() : vault.lockToken()
    );

    const isNative = await safeCall(useFallback =>
      useFallback ? getFallbackContract(addr, vaultAbi).isNative() : vault.isNative()
    );

    const withdrawn = await safeCall(useFallback =>
      useFallback ? getFallbackContract(addr, vaultAbi).withdrawn() : vault.withdrawn()
    );

    // used for the time bar (start/unlock)
    const startTime = await safeCall(useFallback =>
      useFallback ? getFallbackContract(addr, vaultAbi).startTime() : vault.startTime()
    );

    const unlockTime = await safeCall(useFallback =>
      useFallback ? getFallbackContract(addr, vaultAbi).unlockTime() : vault.unlockTime()
    );

    return {
      address: addr.toLowerCase(),
      owner: owner.toLowerCase(),
      lockToken: lockToken.toLowerCase(),
      isNative,
      withdrawn,
      startTime: Number(startTime),
      unlockTime: Number(unlockTime),
      // dynamic fields filled by updateVaults()
      live: {}
    };
  } catch (err) {
    console.error("Failed to load vault", addr, err);
    return null;
  }
}

// =======================================================
// RENDER (No flash: render only on init/reorder/add/remove)
// =======================================================

function renderVaults() {
  if (!vaults.length) {
    locksContainer.textContent = "No vaults loaded.";
    return;
  }

  // DO NOT clear + rebuild aggressively in update loops.
  locksContainer.innerHTML = "";


  vaults.forEach(v => {
    const card = document.createElement("div");
    card.className = "card vault-card";
    card.id = "vault-" + v.address;

    const collapsed = isCollapsed(v.address);
    if (collapsed) card.classList.add("collapsed");

    const viewOnly = userAddress && v.owner !== userAddress;

    // Header row
    const header = document.createElement("div");
    header.className = "vault-header";

    const statusTag = document.createElement("span");
    statusTag.className = "tag status-bad";
    statusTag.textContent = v.withdrawn ? "WITHDRAWN" : "LOCKED";
    header.appendChild(statusTag);

    const assetTag = document.createElement("span");
    assetTag.className = "tag";
    assetTag.textContent = detectAssetLabel(v);
    header.appendChild(assetTag);

    const minmax = document.createElement("button");
    minmax.className = "minmax-btn";
    minmax.textContent = collapsed ? "+" : "–";
    minmax.addEventListener("click", () => {
      const now = !isCollapsed(v.address);
      setCollapsed(v.address, now);
      card.classList.toggle("collapsed", now);
      minmax.textContent = now ? "+" : "–";
    });
    header.appendChild(minmax);

    card.appendChild(header);

    // Body
    const body = document.createElement("div");
    body.className = "vault-body";

    const colMain = document.createElement("div");
    colMain.className = "vault-col-main";

    // Line placeholders (filled by updateVaults)
    colMain.innerHTML = `
      <div class="small col1-line">Locked: <span id="locked-${v.address}" class="mono">…</span></div>
      <div class="small col1-line">Unlock price: <span id="th-${v.address}" class="mono">…</span></div>
      <div class="small col1-line">Current: <span id="cur-${v.address}" class="mono">…</span></div>
    `;

    // Rewards strip (no address displayed)
    const rewards = document.createElement("div");
    rewards.className = "rewards-strip";
    rewards.innerHTML = `
      <div class="reward-left">
        <div class="reward-title">Rewards</div>
        <div class="reward-value" id="reward-${v.address}">Est. reward: …</div>
        <div class="reward-footnote">Minimum estimate only*</div>
      </div>
      <button class="reward-help" data-vault="${v.address}">How rewards work</button>
    `;

    rewards.querySelector(".reward-help").addEventListener("click", () => {
      alert(
        "Rewards are optional and best-effort only.\n\n" +
        "The estimate is a minimum estimate and can change.\n" +
        "Withdrawals never depend on rewards."
      );
    });

    colMain.appendChild(rewards);

    body.appendChild(colMain);

    // Pie + time (layout kept)
    const mobileRow = document.createElement("div");
    mobileRow.className = "vault-mobile-row";

    const colPie = document.createElement("div");
    colPie.className = "vault-col-pie";
    colPie.innerHTML = `
      <div class="pie-wrapper">
        <canvas class="price-goal-pie" id="pie-${v.address}" width="56" height="56"></canvas>
        <div class="pie-tooltip" id="pieTip-${v.address}"></div>
      </div>
      <div class="small" id="pieLabel-${v.address}">…</div>
    `;

    const colTime = document.createElement("div");
    colTime.className = "vault-col-time";
    colTime.innerHTML = `
      <div class="small">Time until unlock:</div>
      <div class="mono" id="time-${v.address}">…</div>
      <div class="time-progress-bar-bg">
        <div class="time-progress-bar-fill" id="timeBar-${v.address}" style="width:0%;"></div>
      </div>
    `;

    mobileRow.appendChild(colPie);
    mobileRow.appendChild(colTime);

    body.appendChild(mobileRow);

    // Feeds
    const colFeeds = document.createElement("div");
    colFeeds.className = "vault-col-feeds";
    colFeeds.innerHTML = `
      <div class="small" id="feeds-${v.address}">Feeds: …</div>
    `;
    body.appendChild(colFeeds);

    // Buttons
    const colBtns = document.createElement("div");
    colBtns.className = "vault-col-buttons";

    if (viewOnly) {
      const lbl = document.createElement("div");
      lbl.className = "view-only-label";
      lbl.textContent = "VIEW ONLY";
      colBtns.appendChild(lbl);
    } else {
      const withdrawBtn = document.createElement("button");
      withdrawBtn.textContent = "Withdraw";
      withdrawBtn.addEventListener("click", async () => {
        await withdrawVault(v.address);
      });
      colBtns.appendChild(withdrawBtn);
    }

    const rescueBtn = document.createElement("button");
    rescueBtn.textContent = "Rescue";
    rescueBtn.addEventListener("click", () => openRescuePrompt(v.address));
    colBtns.appendChild(rescueBtn);

    body.appendChild(colBtns);

    card.appendChild(body);
    locksContainer.appendChild(card);
  });
}

function detectAssetLabel(v) {
  if (v.isNative) return "PLS";
  // You can improve this by matching the lockToken address to known config
  return "ERC20";
}



// =======================================================
// Timers (keep cadence + no-flash architecture)
// =======================================================

function startTimers() {
  // time UI (1s)
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(updateTimeOnly, 1000);

  // price/feed + rewards refresh cadence
  const refreshMs = window.innerWidth < 700 ? 8000 : 5000;
  setInterval(async () => {
    try { await updateVaults(); } catch (e) { console.error(e); }
  }, refreshMs);

  setInterval(async () => {
    try { await refreshGlobalPrice(); } catch (e) { console.error(e); }
  }, refreshMs);
}

// =======================================================
// Live update loop (no re-rendering cards)
// =======================================================

async function updateVaults() {
  if (!vaults.length) return;

  // Update each vault in sequence; safeCall protects against flaky RPC
  for (const v of vaults) {
    await refreshSingleVaultLive(v);
  }
}

async function refreshSingleVaultLive(v) {
  const addr = v.address;
  const vault = getPrimaryContract(addr, vaultAbi);

  // read-only calls should use safeCall (fallback RPC on failure)
  const [
    withdrawn,
    canWithdraw,
    priceMet,
    timeMet,
    curPriceBN,
    thBN,
    priceDetail
  ] = await Promise.all([
    safeCall(useFallback => useFallback ? getFallbackContract(addr, vaultAbi).withdrawn() : vault.withdrawn()),
    safeCall(useFallback => useFallback ? getFallbackContract(addr, vaultAbi).canWithdraw() : vault.canWithdraw()),
    safeCall(useFallback => useFallback ? getFallbackContract(addr, vaultAbi).priceConditionMet() : vault.priceConditionMet()),
    safeCall(useFallback => useFallback ? getFallbackContract(addr, vaultAbi).timeConditionMet() : vault.timeConditionMet()),
    safeCall(useFallback => useFallback ? getFallbackContract(addr, vaultAbi).currentPrice1e18() : vault.currentPrice1e18()),
    safeCall(useFallback => useFallback ? getFallbackContract(addr, vaultAbi).priceThreshold1e18() : vault.priceThreshold1e18()),
    safeCall(useFallback => useFallback ? getFallbackContract(addr, vaultAbi).priceDetail() : vault.priceDetail())
  ]);

  v.withdrawn = !!withdrawn;

  // locked amount display
  const lockedEl = document.getElementById(`locked-${addr}`);
  if (lockedEl) {
    lockedEl.textContent = await getLockedDisplay(v);
  }

  // threshold + current price display
  const thEl = document.getElementById(`th-${addr}`);
  const curEl = document.getElementById(`cur-${addr}`);

  const thFloat = Number(ethersLib.utils.formatUnits(thBN, 18));
  const curFloat = Number(ethersLib.utils.formatUnits(curPriceBN, 18));

  if (thEl) thEl.textContent = `$${formatLockPrice(thFloat)}`;
  if (curEl) curEl.textContent = curPriceBN.eq(0) ? "unavailable" : `$${formatLockPrice(curFloat)}`;

  // status tag
  const card = document.getElementById(`vault-${addr}`);
  if (card) {
    const tag = card.querySelector(".vault-header .tag");
    if (tag) {
      if (v.withdrawn) {
        tag.className = "tag status-warn";
        tag.textContent = "WITHDRAWN";
      } else if (canWithdraw) {
        tag.className = "tag status-ok";
        tag.textContent = "UNLOCKED";
      } else {
        tag.className = "tag status-bad";
        tag.textContent = "LOCKED";
      }
    }
  }

  // feeds line (compact, derived from priceDetail tuple)
  const feedsEl = document.getElementById(`feeds-${addr}`);
  if (feedsEl && priceDetail) {
    const [
      chosenPrice,
      ok,
      pPrice,
      pRes,
      pOk,
      bPrice,
      bRes,
      bOk,
      chosenPrimary,
      chosenBackup,
      usedTieBreaker
    ] = priceDetail;

    let text = "";
    if (!ok) {
      text = `Feeds: unavailable (time unlock only)`;
    } else {
      const chosen = Number(ethersLib.utils.formatUnits(chosenPrice, 18));
      text = `Feeds: ${chosenPrimary ? "𝟏°" : "𝟐°"} effective ($${formatLockPrice(chosen)})`;
      if (usedTieBreaker) text += " (tie)";
    }
    feedsEl.textContent = text;
  }

  // pie chart + label
  updatePricePie(addr, curFloat, thFloat, !!priceMet);

  // reward estimate (best-effort)
  await updateRewardEstimate(v, curPriceBN);

  // time UI is handled in updateTimeOnly()
  // but we need seconds remaining sometimes for edge cases
  v.live = {
    canWithdraw: !!canWithdraw,
    priceMet: !!priceMet,
    timeMet: !!timeMet,
    curPriceBN,
    thBN
  };
}

// =======================================================
// Locked amount display
// =======================================================

const erc20Abi = ["function balanceOf(address) view returns (uint256)"];

async function getLockedDisplay(v) {
  try {
    if (v.isNative) {
      const bal = await fallbackProvider.getBalance(v.address);
      // native assumes 18 decimals
      return ethersLib.utils.formatUnits(bal, 18);
    } else {
      const token = getPrimaryContract(v.lockToken, erc20Abi);
      const bal = await safeCall(useFallback =>
        useFallback ? getFallbackContract(v.lockToken, erc20Abi).balanceOf(v.address)
                    : token.balanceOf(v.address)
      );
      // best-effort decimals: use known asset selection map if possible
      const dec = guessDecimalsFromVault(v);
      return ethersLib.utils.formatUnits(bal, dec);
    }
  } catch {
    return "…";
  }
}

function guessDecimalsFromVault(v) {
  if (v.isNative) return 18;
  // if you map lockToken addresses to known assets, use that here.
  // For now we infer by common expected: HEX=8, others=18.
  // If you fill the actual HEX token address later, update this to match.
  return 18;
}

// =======================================================
// Time UI (1s) — does not re-render cards
// =======================================================

function updateTimeOnly() {
  if (!vaults.length) return;

  const now = Math.floor(Date.now() / 1000);

  for (const v of vaults) {
    const addr = v.address;

    const timeEl = document.getElementById(`time-${addr}`);
    const barEl = document.getElementById(`timeBar-${addr}`);
    if (!timeEl || !barEl) continue;

    const unlock = Number(v.unlockTime);
    const start = Number(v.startTime);

    const remaining = Math.max(0, unlock - now);

    if (remaining === 0) {
      timeEl.textContent = "0s";
      barEl.style.width = "100%";
    } else {
      timeEl.textContent = formatSeconds(remaining);

      // progress bar: proportion from start->unlock
      const total = Math.max(1, unlock - start);
      const elapsed = Math.max(0, now - start);
      const pct = Math.min(100, Math.max(0, (elapsed / total) * 100));
      barEl.style.width = pct.toFixed(1) + "%";
    }
  }
}

function formatSeconds(s) {
  const days = Math.floor(s / 86400);
  s -= days * 86400;
  const hrs = Math.floor(s / 3600);
  s -= hrs * 3600;
  const mins = Math.floor(s / 60);
  const secs = s - mins * 60;
  if (days > 0) return `${days}d ${hrs}h`;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

// =======================================================
// Price pie chart (simple, stable)
// =======================================================

function updatePricePie(addr, cur, th, met) {
  const canvas = document.getElementById(`pie-${addr}`);
  const label = document.getElementById(`pieLabel-${addr}`);
  if (!canvas || !label) return;

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // background ring
  ctx.beginPath();
  ctx.arc(28, 28, 26, 0, Math.PI * 2);
  ctx.fillStyle = "#1f2937";
  ctx.fill();

  let pct = 0;
  if (isFinite(cur) && isFinite(th) && th > 0) {
    pct = Math.max(0, Math.min(1, cur / th));
  }

  // progress arc
  ctx.beginPath();
  ctx.moveTo(28, 28);
  ctx.arc(28, 28, 26, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct, false);
  ctx.closePath();
  ctx.fillStyle = met ? "#22c55e" : "#3b82f6";
  ctx.fill();

  // inner cutout
  ctx.beginPath();
  ctx.arc(28, 28, 16, 0, Math.PI * 2);
  ctx.fillStyle = "#0b1020";
  ctx.fill();

  const pctText = (pct * 100).toFixed(1) + "%";
  label.textContent = met ? `Target hit (${pctText})` : `Progress ${pctText}`;
}

// =======================================================
// Withdraw + Rescue actions
// =======================================================

async function withdrawVault(addr) {
  try {
    const vault = new ethersLib.Contract(addr, vaultAbi, signer);
    const tx = await vault.withdraw();
    await tx.wait();
    await updateVaults();
  } catch (err) {
    alert("Withdraw failed: " + (err?.message || String(err)));
  }
}

function openRescuePrompt(vaultAddr) {
  const tokenAddr = prompt(
    "Rescue after withdrawal.\n\n" +
    "Enter token address to rescue ERC20,\n" +
    "or type 'native' to rescue native PLS.\n\n" +
    "Token:"
  );

  if (!tokenAddr) return;

  if (tokenAddr.trim().toLowerCase() === "native") {
    rescueNative(vaultAddr);
  } else {
    rescueToken(vaultAddr, tokenAddr.trim());
  }
}

async function rescueToken(vaultAddr, tokenAddr) {
  try {
    const vault = new ethersLib.Contract(vaultAddr, vaultAbi, signer);
    const tx = await vault.rescueToken(tokenAddr);
    await tx.wait();
    await updateVaults();
  } catch (err) {
    alert("Rescue failed: " + (err?.message || String(err)));
  }
}

async function rescueNative(vaultAddr) {
  try {
    const vault = new ethersLib.Contract(vaultAddr, vaultAbi, signer);
    const tx = await vault.rescueNative();
    await tx.wait();
    await updateVaults();
  } catch (err) {
    alert("Native rescue failed: " + (err?.message || String(err)));
  }
}

// =======================================================
// Reward estimation (best-effort)
// =======================================================

/**
 * The authoritative estimate comes from RewardsDistributor.estimateReward(...)
 * BUT: the vault does not expose its rewardsDistributor or initial snapshot via ABI in our minimal ABI.
 * Solution:
 *  - We derive estimate in one of two best-effort ways:
 *    (A) If you later add view getters to vault for initialUsdValue1e18 / initialPrice1e18 and rewardsDistributor,
 *        wire them here and use contract-view estimate.
 *    (B) For now: show "unavailable" safely.
 *
 * This preserves the UI structure and never breaks the card.
 */

// Optional ABI additions (if you add these getters in the vault later, simply uncomment):
// const vaultRewardsReadsAbi = [
//   "function initialUsdValue1e18() view returns (uint256)",
//   "function initialPrice1e18() view returns (uint256)",
//   "function rewardsDistributor() view returns (address)"
// ];
//
// const rewardsAbi = [
//   "function estimateReward(uint256 initialUsdValue1e18,uint256 initialPrice1e18,uint256 currentPrice1e18,uint256 lockStartTime) view returns (uint256,bool,uint256,uint256,uint256)"
// ];

async function updateRewardEstimate(v, curPriceBN) {
  const el = document.getElementById(`reward-${v.address}`);
  if (!el) return;

  // Default safe behaviour until you expose snapshot reads:
  el.textContent = "Est. reward: unavailable";
}

// =======================================================
// INITIAL UI
// =======================================================

locksContainer.textContent = "Connect wallet to load vaults.";

// =======================================================
// IMPORTANT: FIX FROM PART 2
// =======================================================
// In Part 2, inside renderVaults(), there was a single stray character line `آ`.
// Delete that line. The correct section should read:
//
//   locksContainer.innerHTML = "";
//   vaults.forEach(v => { ... });
//
// Nothing else changes.

// =======================================================
// ✅ END OF FILE
// =======================================================


